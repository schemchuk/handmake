import type {
  ChannelAdapter,
  DeliverContext,
  DeliverProgress,
  Post,
  RemoteId,
  SendOperation,
  Show,
  ShowRenderContext,
} from '@handmake/core';

import { exchangeLongLivedToken } from '../meta/token';
import {
  instagramCapabilities,
  parseInstagramChannelSettings,
  renderInstagram,
  renderInstagramShow,
} from './render';

export interface InstagramAdapterOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `https://graph.facebook.com/v21.0`. */
  apiBase?: string;
  /** Injectable for tests; defaults to a real `setTimeout` sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-call 429 attempts; default 3 (the Graph API gives no retry_after). */
  maxAttempts?: number;
  /** Sleep after a 429 before the next attempt; default 60_000 ms. */
  rateLimitBackoffMs?: number;
  /** Sleep between container-status polls; default 2000 ms. */
  statusPollIntervalMs?: number;
  /** Max container-status polls before failing the op; default 30. */
  statusPollMaxAttempts?: number;
}

const DEFAULT_API_BASE = 'https://graph.facebook.com/v21.0';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const DEFAULT_STATUS_POLL_MAX_ATTEMPTS = 30;

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Secret names the adapter resolves through `DeliverContext.secrets`. */
export const instagramUserIdSecret = 'INSTAGRAM_USER_ID';
export const instagramAccessTokenSecret = 'INSTAGRAM_ACCESS_TOKEN';
/** Feed `exchangeLongLivedToken` for the once-per-deliver expired-token retry. */
export const metaAppIdSecret = 'META_APP_ID';
export const metaAppSecretSecret = 'META_APP_SECRET';

export class InstagramAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramAdapterError';
  }
}

/** Internal: a 429, to be retried per call. */
class InstagramRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'InstagramRateLimitError';
  }
}

/** Internal: an expired/invalid access token (error code 190), refreshable once per deliver. */
class InstagramTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramTokenExpiredError';
  }
}

interface GraphErrorBody {
  error?: {
    code?: unknown;
    error_subcode?: unknown;
    message?: unknown;
    type?: unknown;
  };
}

/** Mutable per-deliver auth state: the refresh swaps the token mid-deliver. */
interface AuthState {
  userId: string;
  token: string;
}

/** Retries one Graph API call: per-attempt on 429, the first 190 once per deliver. */
type CallRetry = <T>(send: () => Promise<T>) => Promise<T>;

type MediaGroupOp = Extract<SendOperation, { kind: 'mediaGroup' }>;

/**
 * Instagram ChannelAdapter (T26a2, F33): `render` delegates to
 * renderInstagram; `deliver` talks to the Graph API content-publishing
 * flow — media container(s) → status polling → media_publish. A 1-photo
 * op becomes a single image container; 2-10 photos become carousel
 * children plus one carousel container (video/Reels stays a later task;
 * only `mediaGroup` ops are deliverable). Instagram has no native
 * idempotency keys, so the ledger-driven resume (`progress.startAt` /
 * `progress.knownIds`, persisted by the caller between ops via
 * `onDelivered`) IS the idempotency mechanism, exactly like Telegram:
 * a remote id is recorded only after media_publish accepted the op, and
 * a re-run resumes after the recorded prefix.
 *
 * Meta pulls the photos from public URLs (`DeliverContext.photoUrls`,
 * aligned with `photoIndexes`), so no bytes are uploaded here; the
 * publisher builds raw-GitHub URLs in T26a3. Secrets are resolved by the
 * fixed names INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN; on an
 * expired-token error (code 190) the adapter exchanges the token via the
 * shared `exchangeLongLivedToken` (META_APP_ID / META_APP_SECRET) at most
 * once per deliver and retries the failed call. That in-flight refresh is
 * only a last resort: Meta's fb_exchange_token refuses an already-expired
 * token, so the reliable rotation is external — exchange the still-valid
 * stored token before its ~60-day expiry and update the
 * INSTAGRAM_ACCESS_TOKEN secret (operator runbook:
 * docs/instagram-runbook.md). The refreshed token is never persisted back
 * into the secrets store. A 429 burns one attempt per retry, at the level
 * of the individual call, like Telegram; nothing else is retried
 * in-process (the ledger re-run covers it). Tokens never appear in logs
 * or error messages: the request URL carries the access_token, so errors
 * name the endpoint only.
 */
export class InstagramAdapter implements ChannelAdapter {
  readonly key = 'instagram';
  readonly capabilities = instagramCapabilities;

  readonly #fetch: typeof fetch;
  readonly #apiBase: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxAttempts: number;
  readonly #rateLimitBackoffMs: number;
  readonly #statusPollIntervalMs: number;
  readonly #statusPollMaxAttempts: number;

  constructor({
    fetchImpl,
    apiBase,
    sleep,
    maxAttempts,
    rateLimitBackoffMs,
    statusPollIntervalMs,
    statusPollMaxAttempts,
  }: InstagramAdapterOptions = {}) {
    this.#fetch = fetchImpl ?? fetch;
    this.#apiBase = apiBase ?? DEFAULT_API_BASE;
    this.#sleep = sleep ?? DEFAULT_SLEEP;
    this.#maxAttempts = maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#rateLimitBackoffMs = rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
    this.#statusPollIntervalMs = statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS;
    this.#statusPollMaxAttempts = statusPollMaxAttempts ?? DEFAULT_STATUS_POLL_MAX_ATTEMPTS;
  }

  render(post: Post, settings: unknown): SendOperation[] {
    return renderInstagram(post, settings);
  }

  renderShow(show: Show, context: ShowRenderContext): SendOperation[] {
    return renderInstagramShow(show, context);
  }

  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    parseInstagramChannelSettings(ctx.settings);
    const userId = await ctx.secrets.resolve(instagramUserIdSecret);
    if (userId.length === 0) {
      throw new InstagramAdapterError(
        `secret "${instagramUserIdSecret}" resolved to an empty user id`,
      );
    }
    const token = await ctx.secrets.resolve(instagramAccessTokenSecret);
    if (token.length === 0) {
      throw new InstagramAdapterError(
        `secret "${instagramAccessTokenSecret}" resolved to an empty access token`,
      );
    }
    const auth: AuthState = { userId, token };

    const start = progress?.startAt ?? 0;
    const known = progress?.knownIds ?? [];
    // Ledger invariant: knownIds is the exact delivered prefix.
    if (!Number.isInteger(start) || start < 0 || start > ops.length || known.length !== start) {
      throw new InstagramAdapterError(
        `invalid progress: startAt ${start} with ${known.length} known ids for ${ops.length} ops`,
      );
    }

    // Check every remaining op AND build its photo URLs before creating any
    // container, so a bad op fails the deliver without orphan containers;
    // the validated pairs are reused for sending (each op is checked once).
    const pending: Array<{ op: MediaGroupOp; urls: string[] }> = [];
    for (let index = start; index < ops.length; index++) {
      const op = ops[index]!;
      this.#assertOp(op);
      pending.push({ op, urls: this.#photoUrls(op, ctx) });
    }

    const ids: RemoteId[] = [...known];
    const tokenRefresh = { used: false };
    for (const [i, { op, urls }] of pending.entries()) {
      const remoteId = await this.#sendWithRetry(op, urls, auth, ctx, tokenRefresh);
      ids.push(remoteId);
      // Awaited BEFORE the next send, so the caller persists the ledger
      // between ops and the at-least-once window is a single op.
      await progress?.onDelivered(start + i, remoteId);
    }
    return ids;
  }

  #assertOp(op: SendOperation): asserts op is MediaGroupOp {
    if (op.kind !== 'mediaGroup') {
      throw new InstagramAdapterError(`Instagram supports only mediaGroup ops, got "${op.kind}"`);
    }
    if (op.replyToOp !== undefined) {
      throw new InstagramAdapterError('replyToOp is not supported by Instagram');
    }
    if (op.photoIndexes.length === 0) {
      throw new InstagramAdapterError('mediaGroup op has no photos to send');
    }
    if (op.photoIndexes.length > 10) {
      throw new InstagramAdapterError('mediaGroup op has more than 10 photos to send');
    }
  }

  /**
   * Public HTTPS photo URLs aligned with `photoIndexes` (Meta fetches the
   * media itself). Missing entries and non-https URLs are rejected before
   * anything is created at the network.
   */
  #photoUrls(op: MediaGroupOp, ctx: DeliverContext): string[] {
    return op.photoIndexes.map((photoIndex) => {
      const url = ctx.photoUrls?.[photoIndex];
      if (typeof url !== 'string' || url.length === 0) {
        throw new InstagramAdapterError(`op references missing photo URL at index ${photoIndex}`);
      }
      if (!isHttpsUrl(url)) {
        throw new InstagramAdapterError(
          `photo URL at index ${photoIndex} must be a public https URL`,
        );
      }
      return url;
    });
  }

  /**
   * One op, with every Graph API call retried AT THE CALL LEVEL: a 429 (or
   * the first expired-token 190) on one call re-sends only that call, so a
   * carousel hit late keeps the child containers it already created instead
   * of recreating the whole op (PR #94 review note). Deliberately ONLY 429
   * and the first 190 are retried: a network error after Meta accepted a
   * container is NOT retried (the ledger-driven re-run covers it; orphan
   * containers expire unused).
   */
  async #sendWithRetry(
    op: MediaGroupOp,
    urls: string[],
    auth: AuthState,
    ctx: DeliverContext,
    tokenRefresh: { used: boolean },
  ): Promise<RemoteId> {
    const call: CallRetry = async (send) => {
      let attempts = 0;
      for (;;) {
        try {
          return await send();
        } catch (error) {
          if (error instanceof InstagramTokenExpiredError && !tokenRefresh.used) {
            tokenRefresh.used = true;
            auth.token = await this.#refreshToken(auth, ctx);
            continue;
          }
          attempts += 1;
          if (error instanceof InstagramRateLimitError && attempts < this.#maxAttempts) {
            await this.#sleep(error.retryAfterMs);
            continue;
          }
          throw error;
        }
      }
    };

    let containerId: string;
    if (urls.length === 1) {
      containerId = await call(() =>
        this.#createContainer(auth, {
          image_url: urls[0]!,
          ...(op.caption !== undefined && { caption: op.caption }),
        }),
      );
    } else {
      const children: string[] = [];
      for (const imageUrl of urls) {
        children.push(
          await call(() =>
            this.#createContainer(auth, { image_url: imageUrl, is_carousel_item: true }),
          ),
        );
      }
      containerId = await call(() =>
        this.#createContainer(auth, {
          // Meta's docs describe a comma-separated string; the JSON array is
          // what the pre-live mocks exercise. Verify on the first live
          // carousel and switch to `children.join(',')` if Meta rejects it
          // (PR #94 review note; docs/instagram-runbook.md).
          children,
          ...(op.caption !== undefined && { caption: op.caption }),
        }),
      );
    }
    await this.#awaitContainer(auth, containerId, call);
    const published = (await call(() =>
      this.#call(auth, 'POST', `/${auth.userId}/media_publish`, {
        creation_id: containerId,
      }),
    )) as { id?: unknown };
    if (typeof published.id !== 'string' || !published.id) {
      throw new InstagramAdapterError('Instagram media_publish returned a malformed result');
    }
    return published.id;
  }

  async #createContainer(auth: AuthState, params: Record<string, unknown>): Promise<string> {
    const result = (await this.#call(auth, 'POST', `/${auth.userId}/media`, params)) as {
      id?: unknown;
    };
    if (typeof result.id !== 'string' || !result.id) {
      throw new InstagramAdapterError(
        'Instagram media container creation returned a malformed result',
      );
    }
    return result.id;
  }

  /**
   * Instagram processes a container asynchronously; media_publish requires
   * status FINISHED. EXPIRED/ERROR fail the op; anything else polls until
   * `statusPollMaxAttempts`. Each status poll is retried like any call.
   */
  async #awaitContainer(auth: AuthState, containerId: string, call: CallRetry): Promise<void> {
    for (let poll = 0; ; poll++) {
      const result = (await call(() =>
        this.#call(auth, 'GET', `/${containerId}?fields=status_code`),
      )) as { status_code?: unknown };
      const status = result.status_code;
      if (status === 'FINISHED') return;
      if (status === 'EXPIRED' || status === 'ERROR') {
        throw new InstagramAdapterError(`Instagram media container ${status.toLowerCase()}`);
      }
      if (poll + 1 >= this.#statusPollMaxAttempts) {
        throw new InstagramAdapterError(
          `Instagram media container did not finish after ${this.#statusPollMaxAttempts} status polls`,
        );
      }
      await this.#sleep(this.#statusPollIntervalMs);
    }
  }

  /**
   * One token exchange attempt. fb_exchange_token refuses an already-expired
   * token, so this is a mid-deliver last resort, not the rotation path — the
   * operator refreshes the stored secret before expiry (docs/instagram-runbook.md).
   */
  async #refreshToken(auth: AuthState, ctx: DeliverContext): Promise<string> {
    const appId = await ctx.secrets.resolve(metaAppIdSecret);
    const appSecret = await ctx.secrets.resolve(metaAppSecretSecret);
    if (!appId || !appSecret) {
      throw new InstagramAdapterError(
        'Instagram token expired and META_APP_ID/META_APP_SECRET are not configured',
      );
    }
    try {
      return await exchangeLongLivedToken({
        appId,
        appSecret,
        accessToken: auth.token,
        fetchImpl: this.#fetch,
        apiBase: this.#apiBase,
      });
    } catch (cause) {
      throw new InstagramAdapterError(
        `Instagram token refresh failed: ${(cause as Error).message}`,
      );
    }
  }

  /**
   * One Graph API call. Throws InstagramRateLimitError on 429,
   * InstagramTokenExpiredError on an expired-token 190, and
   * InstagramAdapterError otherwise. The request URL embeds the token, so
   * it is never included in error messages.
   */
  async #call(
    auth: AuthState,
    method: 'GET' | 'POST',
    pathAndQuery: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const [path, queryString] = pathAndQuery.split('?');
    const query = new URLSearchParams(queryString);
    query.set('access_token', auth.token);
    const url = `${this.#apiBase}${path}?${query}`;
    const init: RequestInit = { method };
    if (method === 'POST') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(params ?? {});
    }

    let response: Response;
    try {
      response = await this.#fetch(url, init);
    } catch (cause) {
      throw new InstagramAdapterError(
        `Instagram ${path} request failed: ${(cause as Error).message}`,
      );
    }

    let parsed: GraphErrorBody & Record<string, unknown>;
    try {
      parsed = (await response.json()) as GraphErrorBody & Record<string, unknown>;
    } catch {
      if (!response.ok) {
        throw new InstagramAdapterError(`Instagram ${path} failed: HTTP ${response.status}`);
      }
      throw new InstagramAdapterError(`Instagram ${path} returned malformed JSON`);
    }

    const error = parsed.error;
    if (!response.ok || error !== undefined) {
      const code = typeof error?.code === 'number' ? error.code : undefined;
      const subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : undefined;
      const message = typeof error?.message === 'string' ? error.message : undefined;
      if (response.status === 429 || code === 4 || code === 80004) {
        throw new InstagramRateLimitError(
          `Instagram ${path} rate limited: ${message ?? 'Too Many Requests'}`,
          this.#rateLimitBackoffMs,
        );
      }
      if (code === 190 && (subcode === 463 || subcode === 467 || isExpiredTokenMessage(message))) {
        throw new InstagramTokenExpiredError(`Instagram ${path}: access token expired`);
      }
      throw new InstagramAdapterError(
        `Instagram ${path} failed: ${message ?? `HTTP ${response.status}`}`,
      );
    }
    return parsed;
  }
}

export function createInstagramAdapter(options: InstagramAdapterOptions = {}): InstagramAdapter {
  return new InstagramAdapter(options);
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function isExpiredTokenMessage(message: string | undefined): boolean {
  return (
    typeof message === 'string' &&
    (message.includes('expired') || message.includes('Session has expired'))
  );
}
