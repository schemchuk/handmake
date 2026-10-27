/** Worker bindings and secrets (architecture section 5). Secret VALUES live in
 * the Worker secrets store only; wrangler.toml and the repo hold names. */

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /** JSON object mapping Telegram user ID (string) to tenant ID, e.g.
   * `{"123456789":"faden-und-stimmung"}`. Parsed by createTenantLookup. */
  TELEGRAM_ALLOWED_USER_IDS: string;
}
