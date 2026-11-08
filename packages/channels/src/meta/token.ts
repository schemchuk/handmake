/**
 * Shared Meta (Facebook/Instagram/Threads) token helpers (T26a2). The Graph
 * API side of every Meta network adapter goes through here so the token
 * lifecycle lives in exactly one place; network adapters stay thin.
 *
 * Tokens are secrets: they are never logged and never included in error
 * messages (the request URL carries query params, so errors name the
 * endpoint only, never the full URL).
 */

export interface ExchangeLongLivedTokenOptions {
  appId: string;
  appSecret: string;
  /** The current (short- or long-lived) user access token to exchange. */
  accessToken: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `https://graph.facebook.com/v21.0`. */
  apiBase?: string;
}

export class MetaTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaTokenError';
  }
}

const DEFAULT_API_BASE = 'https://graph.facebook.com/v21.0';

interface TokenResponse {
  access_token?: unknown;
  error?: { message?: unknown };
}

/**
 * Exchanges a user access token for a long-lived one via the documented
 * `fb_exchange_token` grant (T26a2). Used by the Instagram adapter to retry
 * an expired-token delivery error at most once per deliver; T26b/T26c reuse
 * this helper. The new token is returned to the caller; persisting it back
 * into the secrets store is the operator's job — nothing here writes secrets.
 */
export async function exchangeLongLivedToken({
  appId,
  appSecret,
  accessToken,
  fetchImpl,
  apiBase,
}: ExchangeLongLivedTokenOptions): Promise<string> {
  const fetch_ = fetchImpl ?? fetch;
  const base = apiBase ?? DEFAULT_API_BASE;
  const query = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: accessToken,
  });
  let response: Response;
  try {
    response = await fetch_(`${base}/oauth/access_token?${query}`);
  } catch (cause) {
    throw new MetaTokenError(`Meta token exchange request failed: ${(cause as Error).message}`);
  }
  let parsed: TokenResponse;
  try {
    parsed = (await response.json()) as TokenResponse;
  } catch {
    throw new MetaTokenError(
      response.ok
        ? 'Meta token exchange returned malformed JSON'
        : `Meta token exchange failed: HTTP ${response.status}`,
    );
  }
  if (!response.ok || typeof parsed.access_token !== 'string' || !parsed.access_token) {
    const detail =
      typeof parsed.error?.message === 'string'
        ? `: ${parsed.error.message}`
        : ` (HTTP ${response.status})`;
    throw new MetaTokenError(`Meta token exchange failed${detail}`);
  }
  return parsed.access_token;
}
