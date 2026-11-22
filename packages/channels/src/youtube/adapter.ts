import type {
  ChannelAdapter,
  DeliverContext,
  DeliverProgress,
  RemoteId,
  SendOperation,
} from '@handmake/core';
import {
  parseYoutubeSettings,
  renderYoutube,
  youtubeCapabilities,
  youtubeDescriptionLimit,
  youtubeTitle,
} from './render';

export const youtubeClientIdSecret = 'YOUTUBE_CLIENT_ID';
export const youtubeClientSecretSecret = 'YOUTUBE_CLIENT_SECRET';
export const youtubeRefreshTokenSecret = 'YOUTUBE_REFRESH_TOKEN';
export const youtubeSecretNames = [
  youtubeClientIdSecret,
  youtubeClientSecretSecret,
  youtubeRefreshTokenSecret,
] as const;

const tokenUrl = 'https://oauth2.googleapis.com/token';
const uploadUrl =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
/** "People & Blogs": the closest fit for a maker's own channel. */
const categoryId = '26';

/** Messages are fixed text: upstream bodies and upload URLs never reach logs. */
export class YoutubeAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YoutubeAdapterError';
  }
}

export interface YoutubeAdapterOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts per request (token, upload start, each status check); default 3, like T71. */
  maxAttempts?: number;
  /** Delay between attempts; default 3000 ms. */
  retryDelayMs?: number;
  /** Chunks sent after a dropped connection before giving up; default 5. */
  maxResumes?: number;
}

class Transient extends Error {}
interface UploadedVideo {
  id: string;
  privacy?: string;
}

/**
 * F43 Shorts upload over the YouTube Data API v3 resumable protocol. One
 * op = one video; the ledger prefix skips a delivered upload. A dropped
 * transfer resumes in the same upload session, which YouTube completes at
 * most once, so retries inside one session never create a second video.
 */
export class YoutubeAdapter implements ChannelAdapter {
  readonly key = 'youtube';
  readonly capabilities = youtubeCapabilities;
  readonly render = renderYoutube;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  readonly #maxResumes: number;

  constructor(options: YoutubeAdapterOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#retryDelayMs = options.retryDelayMs ?? 3000;
    this.#maxResumes = options.maxResumes ?? 5;
  }

  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    const { language } = parseYoutubeSettings(ctx.settings);
    const start = progress?.startAt ?? 0;
    const ids = [...(progress?.knownIds ?? [])];
    if (!Number.isInteger(start) || start < 0 || start > ops.length || ids.length !== start)
      throw new YoutubeAdapterError('invalid YouTube delivery progress');
    const pending = ops.slice(start).map((op) => {
      if (op.kind !== 'video' || op.replyToOp !== undefined || !op.caption)
        throw new YoutubeAdapterError('YouTube supports only independent video ops with a caption');
      if (new TextEncoder().encode(op.caption).length > youtubeDescriptionLimit)
        throw new YoutubeAdapterError('YouTube description is too long');
      return { title: youtubeTitle(op.caption), description: op.caption };
    });
    if (!pending.length) return ids;
    const video = ctx.video;
    if (!video?.length) throw new YoutubeAdapterError('YouTube needs the work video');
    const token = await this.#accessToken(ctx);
    for (const [index, metadata] of pending.entries()) {
      const session = await this.#retry(() =>
        this.#startUpload(token, video.length, metadata, language),
      );
      const { id, privacy } = await this.#upload(session, video);
      ids.push(id);
      // Record the id first: a retry must never upload the same work again.
      await progress?.onDelivered(start + index, id);
      // Google keeps uploads from an unaudited API project private, whatever we ask for.
      if (privacy !== undefined && privacy !== 'public')
        throw new YoutubeAdapterError(
          `YouTube kept the video ${privacy}; the API project needs the YouTube audit`,
        );
    }
    return ids;
  }

  async #accessToken(ctx: DeliverContext): Promise<string> {
    const [clientId, clientSecret, refreshToken] = await Promise.all(
      youtubeSecretNames.map((name) => ctx.secrets.resolve(name)),
    );
    if (!clientId?.trim() || !clientSecret?.trim() || !refreshToken?.trim())
      throw new YoutubeAdapterError('YouTube secrets are empty');
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await this.#retry(() =>
      this.#request(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
    );
    const json = (await response.json().catch(() => undefined)) as
      { access_token?: unknown; error?: unknown } | undefined;
    if (response.status === 400 || response.status === 401) {
      throw new YoutubeAdapterError(
        json?.error === 'invalid_grant'
          ? 'YouTube refresh token revoked or expired; run scripts/youtube-auth.ts again'
          : 'YouTube OAuth client rejected; check YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET',
      );
    }
    if (!response.ok || typeof json?.access_token !== 'string' || !json.access_token)
      throw new YoutubeAdapterError(`YouTube token refresh failed (HTTP ${response.status})`);
    return json.access_token;
  }

  async #startUpload(
    token: string,
    length: number,
    metadata: { title: string; description: string },
    language: string,
  ): Promise<string> {
    const response = await this.#request(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(length),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: { ...metadata, categoryId, defaultLanguage: language },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    });
    if (!response.ok) await this.#fail(response, 'upload start');
    const location = response.headers.get('location');
    let url: URL | undefined;
    try {
      url = new URL(location ?? '');
    } catch {
      /* Invalid URL. */
    }
    // Never send the video or the token anywhere but Google's upload host.
    if (url?.protocol !== 'https:' || url.hostname !== 'www.googleapis.com')
      throw new YoutubeAdapterError('YouTube returned an unexpected upload session URL');
    return url.toString();
  }

  /** Sends the rest of the file; after a dropped connection asks how much arrived. */
  async #upload(session: string, video: Uint8Array): Promise<UploadedVideo> {
    const total = video.length;
    let offset = 0;
    for (let resume = 0; ; resume++) {
      let response: Response | undefined;
      try {
        response = await this.#request(session, {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${offset}-${total - 1}/${total}`,
          },
          body: video.subarray(offset),
        });
      } catch (error) {
        if (!(error instanceof Transient)) throw error;
      }
      if (response && (response.status === 200 || response.status === 201))
        return this.#videoId(response);
      if (response && response.status !== 308 && response.status < 500)
        await this.#fail(response, 'upload');
      if (resume + 1 >= this.#maxResumes)
        throw new YoutubeAdapterError('YouTube upload kept failing; retry the publication');
      await this.#sleep(this.#retryDelayMs);
      const status = await this.#retry(async () => {
        const result = await this.#request(session, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes */${total}` },
        });
        if (result.status >= 500) throw new Transient();
        return result;
      });
      // The previous chunk may have completed after all.
      if (status.status === 200 || status.status === 201) return this.#videoId(status);
      if (status.status !== 308) await this.#fail(status, 'upload status');
      const range = /^bytes=0-(\d+)$/.exec(status.headers.get('range') ?? '');
      offset = range ? Number(range[1]) + 1 : 0;
      if (offset > total) throw new YoutubeAdapterError('YouTube reported an invalid upload range');
    }
  }

  async #videoId(response: Response): Promise<UploadedVideo> {
    const json = (await response.json().catch(() => undefined)) as
      { id?: unknown; status?: { privacyStatus?: unknown } } | undefined;
    if (typeof json?.id !== 'string' || !/^[\w-]{6,20}$/.test(json.id))
      throw new YoutubeAdapterError('YouTube returned a malformed video id');
    const privacy = json.status?.privacyStatus;
    return {
      id: json.id,
      ...(typeof privacy === 'string' && /^\w{1,16}$/.test(privacy) && { privacy }),
    };
  }

  /** Readable, bounded failure: only Google's error reason keyword is kept. */
  async #fail(response: Response, step: string): Promise<never> {
    const json = (await response.json().catch(() => undefined)) as
      { error?: { errors?: Array<{ reason?: unknown }> } } | undefined;
    const reason = json?.error?.errors?.[0]?.reason;
    const detail = typeof reason === 'string' && /^\w{1,64}$/.test(reason) ? `, ${reason}` : '';
    if (response.status === 401)
      throw new YoutubeAdapterError(`YouTube ${step} unauthorized (HTTP 401${detail})`);
    throw new YoutubeAdapterError(`YouTube ${step} failed (HTTP ${response.status}${detail})`);
  }

  /** Network errors, 429 and 5xx are transient; the caller decides how to retry. */
  async #request(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      // 'manual', not 'error': fetch treats YouTube's "308 Resume Incomplete" as a
      // redirect and 'error' would reject it. Nothing is ever followed.
      response = await this.#fetch(url, { ...init, redirect: 'manual' });
    } catch {
      throw new Transient();
    }
    if (
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400 && response.status !== 308)
    )
      throw new YoutubeAdapterError(
        `YouTube answered with an unexpected redirect (HTTP ${response.status})`,
      );
    if (response.status === 429 || (response.status >= 500 && init.method !== 'PUT'))
      throw new Transient();
    return response;
  }

  async #retry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof Transient)) throw error;
        if (attempt >= this.#maxAttempts)
          throw new YoutubeAdapterError('YouTube is unreachable or rate limited; retry later');
      }
      await this.#sleep(this.#retryDelayMs);
    }
  }
}

export const createYoutubeAdapter = (options: YoutubeAdapterOptions = {}): YoutubeAdapter =>
  new YoutubeAdapter(options);
