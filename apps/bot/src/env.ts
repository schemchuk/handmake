/** Worker bindings and secrets (architecture section 5). Secret VALUES live in
 * the Worker secrets store only; wrangler.toml and the repo hold names. */

export interface Env {
  /** Optional private binding; no production bucket is provisioned by T44e2. */
  SHOW_MEDIA?: R2Bucket;
  /** Optional operator user-to-tenant map; absent means recovery is denied. */
  TELEGRAM_SHOW_OPERATOR_IDS?: string;
  /** Dedicated HMAC secret for show transport; absence disables the endpoint. */
  SHOW_TRANSPORT_SECRET?: string;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /** JSON object mapping Telegram user ID (string) to tenant ID, e.g.
   * `{"123456789":"faden-und-stimmung"}`. Parsed by createTenantLookup. */
  TELEGRAM_ALLOWED_USER_IDS: string;
  /** Anthropic API key for the draft translator (ADR 004). Secret value. */
  ANTHROPIC_API_KEY: string;
  /** Fine-grained GitHub token for repository_dispatch (H4/H5). Secret value. */
  GITHUB_DISPATCH_TOKEN: string;
  /** "owner/repo" the dispatch targets; a plain var from wrangler.toml. */
  GITHUB_REPO: string;
  /** "true" sends bot dispatches to the live channel; anything else (and
   * until Volodymyr's go in the T17 E2E) keeps them on the test channel. */
  PUBLISH_LIVE: string;
  /** HMAC key for the publisher's POST /callbacks/published (H7). Secret value:
   * must match the GitHub secret of the same name that signs the callback. */
  PUBLISH_CALLBACK_SECRET: string;
  /** Optional Meta credentials; missing owner/token pairs disable collection. */
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
}
