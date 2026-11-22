import { isUlid } from '@handmake/core';
import type { Bot } from 'grammy';

import type { AppContext } from './context';
import type { StoredDraft } from './draft-store';
import { formatSlot } from './release-queue';
import type { TenantConfigSource } from './tenant-config-source';
import type { BotTexts } from './texts';

/**
 * F42 queue view (T76b): `/queue` lists the queued works by slot; each has
 * «Зараз» (publish now, its slot freed, later works keep theirs) and
 * «У чернетку» (back to ready, slot freed). Buttons carry the row version, so
 * a stale keyboard never moves a newer state.
 */
export interface QueueSessionOptions {
  texts: BotTexts;
  tenantConfigs?: TenantConfigSource;
  /** The publish button's dispatch for a freshly claimed draft (bot.ts). */
  publishNow: (ctx: AppContext, claimed: StoredDraft) => Promise<void>;
}

const titleLength = 80;

function titleOf(stored: StoredDraft): string {
  const text = stored.draft.texts['uk'] ?? stored.draft.texts['de'] ?? '';
  const line = text.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.length > titleLength ? `${line.slice(0, titleLength - 1)}…` : line;
}

export function registerQueueSession(bot: Bot<AppContext>, options: QueueSessionOptions): void {
  const { texts } = options;

  const timeZoneOf = async (tenantId: string) =>
    (await options.tenantConfigs?.load(tenantId))?.meetingSchedule.timezone ?? 'Europe/Berlin';

  bot.command('queue', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const queued = await ctx.drafts.listScheduled(ctx.tenantId);
    if (!queued.length) {
      await ctx.reply(texts.queueEmptyListText);
      return;
    }
    const timeZone = await timeZoneOf(ctx.tenantId);
    await ctx.reply(texts.queueListText);
    for (const stored of queued) {
      const id = stored.draft.draftId;
      await ctx.reply(
        texts.queueItemText(formatSlot(new Date(stored.publishAt!), timeZone), titleOf(stored)),
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: texts.queueNowButton, callback_data: `queue:${id}:now:${stored.version}` },
                {
                  text: texts.queueBackButton,
                  callback_data: `queue:${id}:back:${stored.version}`,
                },
              ],
            ],
          },
        },
      );
    }
  });

  bot.on('callback_query:data', async (ctx, next) => {
    if (!ctx.callbackQuery.data.startsWith('queue:')) return next();
    await ctx.answerCallbackQuery();
    const [, id, action, rawVersion] = ctx.callbackQuery.data.split(':');
    const version = Number(rawVersion);
    if (!id || !isUlid(id) || !Number.isInteger(version)) {
      await ctx.reply(texts.queueStaleText);
      return;
    }
    const now = new Date();
    if (action === 'now') {
      const chat = ctx.chat?.id;
      const claimed = await ctx.drafts.claimScheduledNow(
        ctx.tenantId,
        id,
        version,
        now,
        chat === undefined ? undefined : String(chat),
      );
      if (!claimed) {
        await ctx.reply(texts.queueStaleText);
        return;
      }
      await options.publishNow(ctx, claimed);
      return;
    }
    if (action === 'back') {
      const moved = await ctx.drafts.unschedule(ctx.tenantId, id, now, version);
      await ctx.reply(moved ? texts.queueBackDoneText : texts.queueStaleText);
      return;
    }
    await ctx.reply(texts.queueStaleText);
  });
}
