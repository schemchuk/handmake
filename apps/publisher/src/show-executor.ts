import { showTransportOperations } from '@handmake/core';
import { showFailureOutcome } from './show-outcome';
import { createHmac, randomUUID, createHash } from 'node:crypto';
import type {
  ShowGenerator,
  ShowImageRequest,
  ShowVideoRequest,
  ShowResultStore,
  ShowSourceImage,
} from '@handmake/core';
import { describeShowVerification, showReceiptSchema, showErrorDiagnostic } from '@handmake/core';
import { createShowMarkingGate } from './marking';

type Grant =
  { kind: 'image'; request: ShowImageRequest } | { kind: 'video'; request: ShowVideoRequest };
type Result = NonNullable<Awaited<ReturnType<ShowResultStore['get']>>>['result'];
export type ShowJob = { tenantId: string; showId: string; jobId: string; version: number };
const part = /^[A-Za-z0-9_-]{1,128}$/;
const limit = 20_000_000;

class ShowIncompleteCompletion extends Error {}

/** Private, signed transport. No automatic retries of mutations or provider submissions. */
export function createShowClient(options: {
  origin: string;
  secret: string;
  job: ShowJob;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const origin = new URL(options.origin);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !options.secret ||
    ![options.job.tenantId, options.job.showId, options.job.jobId].every((p) => part.test(p)) ||
    !Number.isSafeInteger(options.job.version) ||
    options.job.version < 0
  )
    throw new Error('invalid show transport configuration');
  let version = options.job.version;
  async function call(
    operation: string,
    attempt = 'next',
    bytes: Uint8Array = new Uint8Array(),
    receipt = '',
  ) {
    if (!part.test(attempt) || bytes.length > limit) throw new Error('invalid show request');
    const { tenantId, showId, jobId } = options.job;
    const url = new URL(
      `/internal/shows/${tenantId}/${showId}/${jobId}/${version}/${attempt}/${operation}`,
      origin,
    );
    const time = String((options.now ?? Date.now)()),
      nonce = randomUUID();
    const message = [
      'POST',
      url.pathname,
      time,
      nonce,
      receipt,
      createHash('sha256').update(bytes).digest('hex'),
    ].join('\n');
    let httpStatus: number | undefined;
    try {
      const response = await (options.fetch ?? fetch)(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(90_000),
        body: bytes,
        headers: {
          'x-show-time': time,
          'x-show-nonce': nonce,
          'x-show-receipt': receipt,
          'x-show-signature': createHmac('sha256', options.secret).update(message).digest('hex'),
        },
      });
      httpStatus = response.status;
      if (!response.ok && (operation !== 'finish' || response.status !== 409)) {
        await response.body?.cancel();
        throw new Error();
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(value);
        }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      if (!response.ok) {
        // Only this explicit rejection proves completion was refused before notification.
        // Other 409 responses include ambiguous delivery failures after the finish claim.
        if (JSON.parse(new TextDecoder().decode(body)).error === 'unfinished job')
          throw new ShowIncompleteCompletion();
        throw new Error();
      }
      if (operation.endsWith('-get') || operation.startsWith('source-')) return { body, response };
      const parsed = JSON.parse(new TextDecoder().decode(body));
      if (!Number.isSafeInteger(parsed.version) || parsed.version < version) throw new Error();
      version = parsed.version;
      return parsed;
    } catch (error) {
      console.error('Show transport request rejected', {
        // Operations originate in this module; never log the signed URL or body.
        operation: showTransportOperations.includes(operation) ? operation : 'unknown',
        ...showErrorDiagnostic(error),
        ...(httpStatus ? { httpStatus } : {}),
      });
      if (error instanceof ShowIncompleteCompletion)
        throw new ShowIncompleteCompletion('show transport rejected; resume from durable state');
      throw new Error('show transport rejected; resume from durable state');
    }
  }
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const store = (kind: 'raw' | 'marked'): ShowResultStore => ({
    async get(tenant, show, attempt) {
      if (tenant !== options.job.tenantId || show !== options.job.showId)
        throw new Error('show scope mismatch');
      if (!(await call('stored', attempt)).value[kind]) return undefined;
      const { body, response } = await call(`${kind}-get`, attempt);
      const { ref, attemptId, ...receipt } = showReceiptSchema.parse(
        JSON.parse(response.headers.get('x-show-receipt') ?? ''),
      );
      if (attemptId !== attempt || ref !== `show-${kind}:v1:${tenant}:${show}:${attempt}`)
        throw new Error('show receipt mismatch');
      return { ref, result: { ...receipt, bytes: body } };
    },
    async put(tenant, show, attempt, result) {
      if (tenant !== options.job.tenantId || show !== options.job.showId)
        throw new Error('show scope mismatch');
      const { bytes, ...receipt } = result;
      await call(
        `${kind}-put`,
        attempt,
        bytes,
        JSON.stringify({
          ...receipt,
          attemptId: attempt,
          ref: `show-${kind}:v1:${tenant}:${show}:${attempt}`,
        }),
      );
    },
  });
  return {
    job: options.job,
    call,
    raw: store('raw'),
    marked: store('marked'),
    journal: {
      async reserve(
        scope: { tenantId: string; showId: string; attemptId: string },
        fingerprint: string,
      ) {
        if (scope.tenantId !== options.job.tenantId || scope.showId !== options.job.showId)
          throw new Error('show scope mismatch');
        return (await call('reserve', scope.attemptId, json({ fingerprint }))).value as {
          created: boolean;
          fingerprint: string;
          requestId?: string;
        };
      },
      async record(
        scope: { tenantId: string; showId: string; attemptId: string },
        requestId: string,
      ) {
        if (scope.tenantId !== options.job.tenantId || scope.showId !== options.job.showId)
          throw new Error('show scope mismatch');
        await call('record', scope.attemptId, json({ requestId }));
      },
    },
    async grant(attempt: string): Promise<Grant> {
      const grant = (await call('grant', attempt)).value;
      const source = async (input: { sourceId: string; mimeType: ShowSourceImage['mimeType'] }) => {
        if (!/^source-[0-3]$/.test(input.sourceId)) throw new Error('invalid show source');
        const { body, response } = await call(input.sourceId, attempt);
        if (response.headers.get('content-type') !== input.mimeType)
          throw new Error('show source mismatch');
        return { bytes: body, mimeType: input.mimeType };
      };
      const request = grant.request;
      if (
        request.tenantId !== options.job.tenantId ||
        request.showId !== options.job.showId ||
        request.attemptId !== attempt
      )
        throw new Error('show grant mismatch');
      if (grant.kind === 'video')
        return { kind: 'video', request: { ...request, image: await source(request.image) } };
      if (grant.kind !== 'image') throw new Error('invalid show grant');
      const originals: ShowSourceImage[] = [];
      for (const original of request.originals) originals.push(await source(original));
      return {
        kind: 'image',
        request: {
          ...request,
          originals,
          ...(request.persona
            ? {
                persona: { ...request.persona, reference: await source(request.persona.reference) },
              }
            : {}),
        },
      };
    },
  };
}

/** One workflow owns a job; concurrent duplicates are fenced by Worker + durable journal. */
export async function executeShow(
  client: ReturnType<typeof createShowClient>,
  generator: ShowGenerator & {
    resume?: (ticket: {
      requestId: string;
      providerModel: string;
      promptVersion: string;
      costEur: number;
      video: boolean;
    }) => Promise<Result>;
  },
) {
  const gate = createShowMarkingGate(client.raw, client.marked);
  const { tenantId, showId } = client.job;
  const prepare = async (attempt: string) => {
    const output = await gate.prepare(tenantId, showId, attempt);
    const raw = await client.raw.get(tenantId, showId, attempt);
    if (!raw) throw new Error('verified raw result missing');
    const evidence = await describeShowVerification(tenantId, showId, attempt, raw, output);
    await client.call('verified-put', attempt, new TextEncoder().encode(JSON.stringify(evidence)));
  };
  let recovery = false;
  try {
    // A show has at most five images and one video. Never spin on rejected checkpoints.
    for (let step = 0; step < 7; step++) {
      const status = await client.call('status');
      recovery = status.recovery === true;
      for (const output of Object.values(status.outputs) as { attemptId: string }[])
        await prepare(output.attemptId);
      let attempt: string | undefined = status.pending?.attemptId;
      if (!attempt) {
        if (status.recovery) {
          await client
            .call('finish', 'next', new TextEncoder().encode(JSON.stringify({ outcome: 'ready' })))
            .catch(() => undefined);
          return;
        }
        const authorized = await client.call('authorize');
        if (!authorized.value) {
          await client
            .call('finish', 'next', new TextEncoder().encode(JSON.stringify({ outcome: 'ready' })))
            .catch((error) => {
              // A rejected completion must reach the failure reporter; delivery may fail
              // after the Worker has already accepted and claimed the notification.
              if (error instanceof ShowIncompleteCompletion) throw error;
            });
          return;
        }
        attempt = authorized.value.request.attemptId;
      }
      if (!attempt) throw new Error('show grant unavailable');
      let stored = await client.raw.get(tenantId, showId, attempt);
      if (!stored) {
        let result: Result;
        if (status.recovery) {
          if (!generator.resume) throw new Error('GET recovery unavailable');
          result = await generator.resume((await client.call('recovery', attempt)).value);
        } else {
          const grant = await client.grant(attempt);
          result =
            grant.kind === 'image'
              ? await generator.generateImage(grant.request)
              : await generator.generateVideo(grant.request);
        }
        await client.raw.put(tenantId, showId, attempt, result);
        stored = await client.raw.get(tenantId, showId, attempt);
        if (!stored) throw new Error('show result unavailable');
      }
      // Accounting happens even when marking fails; the next run marks the retained raw result.
      if (!(await client.call('checkpoint', attempt)).value)
        throw new Error('show checkpoint rejected; inspect durable state');
      await prepare(attempt);
      if (status.recovery) {
        const latest = await client.call('status');
        await client
          .call(
            'finish',
            'next',
            new TextEncoder().encode(
              JSON.stringify({ outcome: latest.pending ? 'failed' : 'ready' }),
            ),
          )
          .catch(() => undefined);
        return;
      }
    }
    throw new Error('show step bound exceeded');
  } catch (error) {
    if (recovery) await client.call('backfill-release').catch(() => undefined);
    await client
      .call(
        'finish',
        'next',
        new TextEncoder().encode(JSON.stringify({ outcome: showFailureOutcome(error) })),
      )
      .catch(() => undefined);
    throw error;
  }
}
