import { Bot } from 'grammy';

import type { TenantLookup } from './allow-list';
import type { AppContext } from './context';

export interface BotTexts {
  /** /start reply for allow-listed users. */
  startText: string;
  /** Reply for everyone else; nothing is stored for them (A6). */
  refusalText: string;
}

export interface CreateBotOptions extends BotTexts {
  token: string;
  db: D1Database;
  resolveTenant: TenantLookup;
}

export function createBot(options: CreateBotOptions): Bot<AppContext> {
  const bot = new Bot<AppContext>(options.token);

  // Allow-list gate: runs before every handler. Unknown senders get the
  // refusal and the middleware chain stops — no tenant, no DB access.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    const tenantId = userId === undefined ? undefined : options.resolveTenant(userId);
    if (tenantId === undefined) {
      if (ctx.chat) {
        await ctx.reply(options.refusalText);
      }
      return;
    }
    ctx.tenantId = tenantId;
    ctx.db = options.db;
    await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(options.startText);
  });

  return bot;
}
