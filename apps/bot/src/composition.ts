import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';

import { createTenantLookup } from './allow-list';
import { createBot } from './bot';
import type { BotTexts } from './bot';
import type { AppContext } from './context';
import type { Env } from './env';

/** Header Telegram sends when the webhook was registered with a secret token. */
export const secretTokenHeader = 'x-telegram-bot-api-secret-token';

export interface App {
  handle(request: Request): Promise<Response>;
  /** Exposed for tests; production uses only `handle`. */
  bot: Bot<AppContext>;
}

/** Composition root: wires secrets/bindings to the bot (ADR 007). */
export function createApp(env: Env, texts: BotTexts): App {
  const bot = createBot({
    token: env.TELEGRAM_BOT_TOKEN,
    db: env.DB,
    resolveTenant: createTenantLookup(env.TELEGRAM_ALLOWED_USER_IDS),
    ...texts,
  });
  const handleUpdate = webhookCallback(bot, 'cloudflare-mod');

  return {
    bot,
    async handle(request) {
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405 });
      }
      // Fail closed: a missing or empty configured secret rejects everything.
      const expected = env.TELEGRAM_WEBHOOK_SECRET;
      const provided = request.headers.get(secretTokenHeader);
      if (!expected || provided !== expected) {
        return new Response('unauthorized', { status: 401 });
      }
      return handleUpdate(request);
    },
  };
}
