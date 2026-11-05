import { z } from 'zod';
import type {
  ShowCallResult,
  ShowConfig,
  ShowGenerator,
  ShowImageRequest,
  ShowSourceImage,
  ShowVideoRequest,
} from '@handmake/core';
import {
  FalShowError,
  falQueueOrigin,
  hasMediaHeader,
  maxFalMediaBytes,
  mediaUrl,
  readLimited,
} from './fal-http';
import { showImagePrompt, showVideoPrompt } from './show-prompts';

const requestIdSchema = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
const ticketSchema = z.object({ request_id: requestIdSchema });
const statusSchema = z.object({ status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']) });
const fileSchema = z.object({ url: z.string(), content_type: z.string().optional() });
type Scope = { tenantId: string; showId: string; attemptId: string };

/** Must be durable and atomic. Never expire reservations automatically or reuse an attempt id.
 * reserve binds a scope to its fingerprint, returning created=true to only one caller.
 * record is immutable/idempotent; a reservation without an id requires operator reconciliation.
 * T44d2 supplies persistence; no in-memory production fallback is provided here.
 */
export interface FalAttemptJournal {
  reserve(
    scope: Scope,
    fingerprint: string,
  ): Promise<{ created: boolean; fingerprint: string; requestId?: string }>;
  record(scope: Scope, requestId: string): Promise<void>;
}
export interface FalShowGeneratorOptions {
  apiKey: string;
  journal: FalAttemptJournal;
  config: (tenantId: string) => ShowConfig;
  /** Explicit gate after model terms verification; not wired to production in T44d1. */
  allowPaidCalls?: boolean;
  verifiedModels?: readonly string[];
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxPolls?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** fal queue adapter for edit/image-to-video schemas. Rates are configured EUR ESTIMATES,
 * never invoice amounts. Uses no SDK retries and disables fal queue retries/fallback.
 */
export class FalShowGenerator implements ShowGenerator {
  readonly #options: FalShowGeneratorOptions;
  constructor(options: FalShowGeneratorOptions) {
    this.#options = options;
    for (const n of [
      options.timeoutMs ?? 30_000,
      options.maxPolls ?? 30,
      options.pollIntervalMs ?? 2_000,
    ])
      if (!Number.isSafeInteger(n) || n <= 0) throw new FalShowError('invalid-input');
  }

  async generateImage(
    request: ShowImageRequest,
  ): Promise<ShowCallResult<ShowSourceImage['mimeType']>> {
    try {
      if (
        !request.originals.length ||
        request.originals.length + (request.persona ? 1 : 0) > 14 ||
        request.originals.reduce(
          (total, image) => total + image.bytes.length,
          request.persona?.reference.bytes.length ?? 0,
        ) > maxFalMediaBytes ||
        (request.template !== 'interior' && !request.persona)
      )
        throw new Error('invalid references');
      if (request.persona && (!request.persona.model.adult || !request.persona.model.fictional))
        throw new Error('invalid persona');
      const input = {
        prompt: showImagePrompt(request),
        image_urls: [
          ...request.originals.map(dataUri),
          ...(request.persona ? [dataUri(request.persona.reference)] : []),
        ],
        num_images: 1,
        output_format: 'png',
        resolution: '1K',
      };
      return (await this.#generate(request, input, false)) as ShowCallResult<
        ShowSourceImage['mimeType']
      >;
    } catch (error) {
      throw safeError(error);
    }
  }

  async generateVideo(request: ShowVideoRequest): Promise<ShowCallResult<'video/mp4'>> {
    try {
      if (request.durationSeconds !== 5) throw new Error('unsupported duration');
      return (await this.#generate(
        request,
        {
          prompt: showVideoPrompt(request.promptVersion),
          image_url: dataUri(request.image),
          duration: '5',
        },
        true,
      )) as ShowCallResult<'video/mp4'>;
    } catch (error) {
      throw safeError(error);
    }
  }

  async #generate(request: ShowImageRequest | ShowVideoRequest, input: object, video: boolean) {
    const o = this.#options;
    if (!o.allowPaidCalls || !o.verifiedModels?.includes(request.providerModel))
      throw new FalShowError('disabled');
    const config = o.config(request.tenantId);
    const price = video ? config.video.eurPerSecond * 5 : config.image.eurPerImage;
    if (
      !o.apiKey.trim() ||
      !request.tenantId ||
      !request.showId ||
      !request.attemptId ||
      request.providerModel !== (video ? config.video.model : config.image.model) ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(request.providerModel) ||
      request.providerModel.split('/').some((p) => p === '.' || p === '..') ||
      !Number.isFinite(price) ||
      price <= 0
    )
      throw new FalShowError('invalid-input');
    const scope = {
      tenantId: request.tenantId,
      showId: request.showId,
      attemptId: request.attemptId,
    };
    const fingerprint = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(
            JSON.stringify([request.providerModel, request.promptVersion, price, input]),
          ),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    let requestId: string | undefined;
    try {
      const reservation = await o.journal.reserve(scope, fingerprint);
      if (reservation.fingerprint !== fingerprint) throw new FalShowError('reconcile');
      requestId = reservation.requestId && requestIdSchema.parse(reservation.requestId);
      if (reservation.created) {
        if (requestId) throw new FalShowError('reconcile', requestId);
        const submitted = await this.#json(`${falQueueOrigin}/${request.providerModel}`, {
          method: 'POST',
          body: JSON.stringify(input),
        });
        requestId = ticketSchema.parse(submitted).request_id;
        await o.journal.record(scope, requestId);
      }
      if (!requestId) throw new FalShowError('reconcile');
      return await this.resume({
        requestId,
        providerModel: request.providerModel,
        promptVersion: request.promptVersion,
        costEur: price,
        video,
      });
    } catch (error) {
      if (error instanceof FalShowError)
        throw new FalShowError(error.code, requestId ?? error.requestId, error.httpStatus);
      throw new FalShowError('reconcile', requestId);
    }
  }

  /** Resume an immutable journal ticket using GETs only; source media is unnecessary. */
  async resume(request: {
    requestId: string;
    providerModel: string;
    promptVersion: string;
    costEur: number;
    video: boolean;
  }) {
    const o = this.#options;
    const requestId = requestIdSchema.parse(request.requestId);
    const video = request.video;
    if (
      !o.apiKey.trim() ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(request.providerModel) ||
      request.providerModel.split('/').some((p) => p === '.' || p === '..') ||
      !Number.isFinite(request.costEur) ||
      request.costEur < 0
    )
      throw new FalShowError('invalid-input');
    try {
      // Queue request routes use owner/app, excluding the model's endpoint path.
      // Ignore response URLs entirely: credentials only ever reach this constructed origin.
      const base = `${falQueueOrigin}/${request.providerModel.split('/').slice(0, 2).join('/')}/requests/${requestId}`;
      for (let poll = 0; poll < (o.maxPolls ?? 30); poll++) {
        const status = statusSchema.parse(await this.#json(`${base}/status`));
        if (status.status === 'COMPLETED') {
          const output = await this.#json(base);
          const file = video
            ? z.object({ video: fileSchema }).parse(output).video
            : z.object({ images: z.array(fileSchema).length(1) }).parse(output).images[0]!;
          let bytes: Uint8Array;
          let mimeType: string;
          try {
            const downloaded = await this.#http(mediaUrl(file.url), {}, false, async (response) => {
              const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
              if (
                !mime ||
                (file.content_type && file.content_type !== mime) ||
                !(video
                  ? mime === 'video/mp4'
                  : ['image/png', 'image/jpeg', 'image/webp'].includes(mime))
              )
                throw new Error('invalid mime');
              return { bytes: await readLimited(response, maxFalMediaBytes), mimeType: mime };
            });
            ({ bytes, mimeType } = downloaded);
            if (!hasMediaHeader(bytes, mimeType)) throw new Error('invalid media');
          } catch (error) {
            throw new FalShowError(
              'invalid-media',
              requestId,
              error instanceof FalShowError ? error.httpStatus : undefined,
            );
          }
          return {
            callId: `fal:${requestId}`,
            model: request.providerModel,
            promptVersion: request.promptVersion,
            costEur: request.costEur,
            bytes,
            mimeType: mimeType as ShowSourceImage['mimeType'] | 'video/mp4',
          };
        }
        if (poll + 1 < (o.maxPolls ?? 30))
          await (o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
            o.pollIntervalMs ?? 2_000,
          );
      }
      throw new FalShowError('timeout', requestId);
    } catch (error) {
      throw error instanceof FalShowError ? error : new FalShowError('reconcile', requestId);
    }
  }

  #json(url: string, init: RequestInit = {}): Promise<unknown> {
    return this.#http(url, init, true, async (response) =>
      JSON.parse(new TextDecoder().decode(await readLimited(response, 1_000_000))),
    );
  }

  async #http<T>(
    url: string,
    init: RequestInit,
    authenticated: boolean,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs ?? 30_000);
    try {
      const response = await (this.#options.fetch ?? globalThis.fetch)(url, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: authenticated
          ? {
              Authorization: `Key ${this.#options.apiKey}`,
              'Content-Type': 'application/json',
              'X-Fal-No-Retry': '1',
              'x-app-fal-disable-fallback': 'true',
            }
          : {},
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new FalShowError('provider', undefined, response.status);
      }
      return await consume(response);
    } finally {
      controller.abort();
      clearTimeout(timer);
    }
  }
}

function dataUri(image: ShowSourceImage): string {
  if (
    !image.bytes.length ||
    image.bytes.length > maxFalMediaBytes ||
    !hasMediaHeader(image.bytes, image.mimeType)
  )
    throw new Error('invalid source image');
  let binary = '';
  for (let offset = 0; offset < image.bytes.length; offset += 32_768)
    binary += String.fromCharCode(...image.bytes.subarray(offset, offset + 32_768));
  return `data:${image.mimeType};base64,${btoa(binary)}`;
}
function safeError(error: unknown): FalShowError {
  return error instanceof FalShowError ? error : new FalShowError('invalid-input');
}
