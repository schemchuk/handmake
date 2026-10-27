/**
 * Registers the Worker's URL as the bot webhook, together with the secret
 * token both sides then require on every call.
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *     pnpm --filter @handmake/bot webhook:set https://handmake-bot.<you>.workers.dev
 *
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment
 * (see .env.example). Secret values are never printed.
 */
declare const process: { env: Record<string, string | undefined>; argv: string[] };

export {};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`webhook:set: missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

const url = process.argv[2];
if (!url) {
  throw new Error('webhook:set: pass the Worker URL, e.g. https://handmake-bot.<you>.workers.dev');
}

const token = requiredEnv('TELEGRAM_BOT_TOKEN');
const secret = requiredEnv('TELEGRAM_WEBHOOK_SECRET');

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  }),
});

const result = (await response.json()) as { ok: boolean; description?: string };
if (!response.ok || !result.ok) {
  throw new Error(`setWebhook failed: ${result.description ?? `HTTP ${response.status}`}`);
}

console.log(`webhook set: ${url}`);
