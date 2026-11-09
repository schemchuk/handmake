/**
 * Shared Meta (Facebook/Instagram/Threads) Graph API client (T26b). The
 * network adapters stay thin — they own endpoint paths and payload shapes;
 * this module owns transport behaviour: query-token auth, JSON bodies, the
 * 429 per-call retry, the once-per-deliver expired-token (190) refresh and
 * the never-log-tokens rule.
 *
 * Tokens are secrets: they are never logged and never included in error
 * messages (the request URL carries query params, so errors name the
 * endpoint only, never the full URL).
 */

export interface MetaGraphOptions {
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
}

const DEFAULT_API_BASE = 'https://graph.facebook.com/v21.0';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Internal: a 429, to be retried per call. */
export class MetaRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = 'MetaRateLimitError';
  }
}

/** Internal: an expired/invalid access token (error code 190), refreshable once per deliver. */
export class MetaTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaTokenExpiredError';
  }
}

/**
 * A Graph API failure. Adapters re-throw it under their own public error
 * class with the message unchanged, so network-specific error classes stay
 * stable while transport behaviour lives here.
 */
export class MetaGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaGraphError';
  }
}

/** Mutable per-deliver auth state: a refresh swaps the token mid-deliver. */
export interface MetaAuthState {
  token: string;
}

/** Per-deliver state shared by every op retry of one deliver. */
export interface MetaDeliverSession {
  /** The expired-token refresh runs at most once per deliver. */
  refreshUsed: boolean;
}

/** Retries one Graph API call: per-attempt on 429, the first 190 once per deliver. */
export type MetaCallRetry = <T>(send: () => Promise<T>) => Promise<T>;

interface GraphErrorBody {
  error?: {
    code?: unknown;
    error_subcode?: unknown;
    message?: unknown;
    type?: unknown;
  };
}

export class MetaGraphClient {
  readonly #fetch: typeof fetch;
  readonly #apiBase: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxAttempts: number;
  readonly #rateLimitBackoffMs: number;

  constructor(
    /** Network name for error messages, e.g. "Instagram" / "Facebook". */
    private readonly network: string,
    { fetchImpl, apiBase, sleep, maxAttempts, rateLimitBackoffMs }: MetaGraphOptions = {},
  ) {
    this.#fetch = fetchImpl ?? fetch;
    this.#apiBase = apiBase ?? DEFAULT_API_BASE;
    this.#sleep = sleep ?? DEFAULT_SLEEP;
    this.#maxAttempts = maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#rateLimitBackoffMs = rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
  }

  newSession(): MetaDeliverSession {
    return { refreshUsed: false };
  }

  /**
   * One op's retry closure: a 429 re-sends only that call (bounded by
   * maxAttempts, counted per op, so a burst across ops never eats another
   * op's retries); the first expired-token 190 of the deliver swaps
   * `auth.token` via onRefresh and retries the failed call. Deliberately
   * ONLY 429 and the first 190 are retried: a network error after the
   * network accepted a write is NOT retried (the ledger-driven re-run
   * covers it; unpublished Meta writes expire unused).
   */
  opRetry(
    auth: MetaAuthState,
    session: MetaDeliverSession,
    onRefresh: () => Promise<string>,
  ): MetaCallRetry {
    let attempts = 0;
    return async <T>(send: () => Promise<T>): Promise<T> => {
      for (;;) {
        try {
          return await send();
        } catch (error) {
          if (error instanceof MetaTokenExpiredError && !session.refreshUsed) {
            session.refreshUsed = true;
            auth.token = await onRefresh();
            continue;
          }
          attempts += 1;
          if (error instanceof MetaRateLimitError && attempts < this.#maxAttempts) {
            await this.#sleep(error.retryAfterMs);
            continue;
          }
          throw error;
        }
      }
    };
  }

  /**
   * One Graph API call. Throws MetaRateLimitError on 429,
   * MetaTokenExpiredError on an expired-token 190, and MetaGraphError
   * otherwise.
   */
  async call(
    auth: MetaAuthState,
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
      throw new MetaGraphError(
        `${this.network} ${path} request failed: ${(cause as Error).message}`,
      );
    }

    let parsed: GraphErrorBody & Record<string, unknown>;
    try {
      parsed = (await response.json()) as GraphErrorBody & Record<string, unknown>;
    } catch {
      if (!response.ok) {
        throw new MetaGraphError(`${this.network} ${path} failed: HTTP ${response.status}`);
      }
      throw new MetaGraphError(`${this.network} ${path} returned malformed JSON`);
    }

    const error = parsed.error;
    if (!response.ok || error !== undefined) {
      const code = typeof error?.code === 'number' ? error.code : undefined;
      const subcode = typeof error?.error_subcode === 'number' ? error.error_subcode : undefined;
      const message = typeof error?.message === 'string' ? error.message : undefined;
      if (response.status === 429 || code === 4 || code === 80004) {
        throw new MetaRateLimitError(
          `${this.network} ${path} rate limited: ${message ?? 'Too Many Requests'}`,
          this.#rateLimitBackoffMs,
        );
      }
      if (code === 190 && (subcode === 463 || subcode === 467 || isExpiredTokenMessage(message))) {
        throw new MetaTokenExpiredError(`${this.network} ${path}: access token expired`);
      }
      throw new MetaGraphError(
        `${this.network} ${path} failed: ${message ?? `HTTP ${response.status}`}`,
      );
    }
    return parsed;
  }

  /**
   * Maps a Graph API `paging.next` URL to a path+query for `call()` (T49b).
   * A full next URL repeats the version segment — following it raw would
   * request /v21.0/v21.0/... — so the apiBase path prefix is stripped; a
   * foreign origin is rejected. `access_token` is dropped from the query:
   * the followed request re-authenticates from `auth.token`, and a token
   * must never ride along in a URL that an error message may name.
   * Throws MetaGraphError on an unparsable or foreign URL.
   */
  nextPath(nextUrl: string): string {
    let parsed: URL;
    let base: URL;
    try {
      parsed = new URL(nextUrl);
    } catch {
      throw new MetaGraphError(`${this.network} paging.next URL is not a valid URL`);
    }
    try {
      base = new URL(this.#apiBase);
    } catch {
      throw new MetaGraphError(`${this.network} paging.next URL cannot be resolved`);
    }
    if (parsed.origin !== base.origin) {
      throw new MetaGraphError(`${this.network} paging.next URL has an unexpected origin`);
    }
    const basePath = base.pathname.replace(/\/$/, '');
    let path = parsed.pathname;
    if (path.startsWith(`${basePath}/`)) {
      path = path.slice(basePath.length);
    }
    parsed.searchParams.delete('access_token');
    return `${path}${parsed.search}`;
  }
}

/**
 * Public HTTPS photo URLs aligned with `photoIndexes` (Meta fetches the
 * media itself). Missing entries and non-https URLs are rejected before
 * anything is created at the network.
 */
export function metaPhotoUrls(
  network: string,
  op: { photoIndexes: number[] },
  ctx: { photoUrls?: string[] },
): string[] {
  return op.photoIndexes.map((photoIndex) => {
    const url = ctx.photoUrls?.[photoIndex];
    if (typeof url !== 'string' || url.length === 0) {
      throw new MetaGraphError(`${network} op references missing photo URL at index ${photoIndex}`);
    }
    if (!isHttpsUrl(url)) {
      throw new MetaGraphError(
        `${network} photo URL at index ${photoIndex} must be a public https URL`,
      );
    }
    return url;
  });
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
