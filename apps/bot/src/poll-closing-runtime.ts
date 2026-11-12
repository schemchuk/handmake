import { contestWeek } from '@handmake/core';
import type { ChannelAdapter, DeliverContext, EntryNames, TenantConfig } from '@handmake/core';
import type { Bot } from 'grammy';
import type { AllowList } from './allow-list';
import { announcementWindowMs, latestOccurrenceInWindow } from './announcements';
import type { AppContext } from './context';
import type { D1DraftStore } from './draft-store';
import { closeContestPoll } from './poll-closing';
import { createPollClosingStore } from './poll-closing-store';
import { createPollResultStore } from './poll-result';
import type { ContestVoteSource } from './contest-votes';
import { buildTenantPreview } from './preview';
import type { TenantConfigSource } from './tenant-config-source';
import type { BotTexts } from './texts';

export interface PollClosingRuntimeOptions {
  db: D1Database;
  drafts: D1DraftStore;
  tenantConfigs: TenantConfigSource;
  texts: BotTexts;
  lookupNames: (tenant: string, ids: string[]) => Promise<EntryNames>;
  publishesLive: boolean;
}

/** Resolve the ballot's entry week from the opening preceding this closing.
 * Calendar subtraction avoids assuming a DST week is exactly 168 hours. */
export function closingEntryWeek(config: TenantConfig, now: Date): string | undefined {
  const closing = latestOccurrenceInWindow(
    config.workOfWeek.closes,
    now,
    announcementWindowMs,
    config.meetingSchedule.timezone,
  );
  if (!closing) return undefined;
  const opening = latestOccurrenceInWindow(
    config.workOfWeek.opens,
    closing,
    8 * 24 * 60 * 60_000,
    config.meetingSchedule.timezone,
  );
  if (!opening) return undefined;
  const monday = new Date(`${contestWeek(opening)}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - 7);
  return monday.toISOString().slice(0, 10);
}

async function resultPreview(tenant: string, draftId: string, options: PollClosingRuntimeOptions) {
  const stored = await options.drafts.get(tenant, draftId);
  if (!stored || stored.draft.state !== 'ready') return undefined;
  return buildTenantPreview(
    stored.draft,
    options.texts,
    options.tenantConfigs,
    options.publishesLive,
    options.lookupNames,
  );
}

/** Registered after the bot's allow-list gate; claim is scoped again by tenant/week. */
export function registerPollResultCallbacks(
  bot: Bot<AppContext>,
  options?: PollClosingRuntimeOptions,
) {
  bot.callbackQuery(/^wotw:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!options || ctx.chat?.type !== 'private' || ctx.chat.id !== ctx.from.id) return;
    const match = /^wotw:(\d{4}-\d{2}-\d{2}):([0-9a-f-]{36}):(\d)$/.exec(ctx.callbackQuery.data);
    if (!match) return;
    const [, week, claim, index] = match;
    const config = await options.tenantConfigs.load(ctx.tenantId);
    if (config.id !== ctx.tenantId || !config.featureFlags.wotwPoll) return;
    const closing = await createPollClosingStore(options.db).get(ctx.tenantId, week!);
    if (!closing?.tally || closing.claim !== claim) return;
    const entryId = closing.poll.entryRefs[Number(index)];
    if (!entryId) return;
    const outcome = await createPollResultStore(options.db).create({
      tenant: ctx.tenantId,
      week: week!,
      claim: claim!,
      entryId,
      chatId: String(ctx.chat.id),
      now: new Date(),
    });
    // Retried buttons may recover a lost preview, always for the immutable winner.
    if (!outcome.result) return;
    const preview = await resultPreview(ctx.tenantId, outcome.result.draftId, options);
    if (preview)
      await ctx
        .reply(preview.text, {
          ...(preview.keyboard ? { reply_markup: preview.keyboard } : {}),
        })
        .catch(() => undefined);
  });
}

export async function runPollClosingCron(
  now: Date,
  options: PollClosingRuntimeOptions & {
    bot: Bot<AppContext>;
    allowList: AllowList;
    adapter: ChannelAdapter;
    context: (config: TenantConfig) => DeliverContext;
    sources: (config: TenantConfig) => readonly ContestVoteSource[];
  },
): Promise<void> {
  const tenants = new Map<string, number[]>();
  for (const [author, tenant] of options.allowList)
    tenants.set(tenant, [...(tenants.get(tenant) ?? []), author]);
  for (const [tenant, authors] of tenants) {
    try {
      const config = await options.tenantConfigs.load(tenant);
      if (config.id !== tenant) throw new Error('tenant config mismatch');
      if (!config.featureFlags.wotwPoll) continue;
      const weeks = new Set<string>();
      const scheduled = closingEntryWeek(config, now);
      if (scheduled) weeks.add(scheduled);
      // An interrupted claim must recover even after the scheduling window closes.
      const pending = await options.db
        .prepare(
          `SELECT week FROM poll_closings c WHERE tenant_id = ? AND NOT EXISTS
          (SELECT 1 FROM poll_results r WHERE r.tenant_id = c.tenant_id AND r.week = c.week)`,
        )
        .bind(tenant)
        .all<{ week: string }>();
      for (const row of pending.results) weeks.add(row.week);
      for (const week of weeks) {
        try {
          await closeContestPoll(
            options.db,
            tenant,
            week,
            options.adapter,
            options.context(config),
            now.getTime(),
            options.sources(config),
          );
          const closing = await createPollClosingStore(options.db).get(tenant, week);
          if (!closing?.tally) continue;
          const results = createPollResultStore(options.db);
          const decision = await results.decision(tenant, week);
          if (!decision) continue;
          const outcome = await results.create({
            tenant,
            week,
            claim: closing.claim,
            chatId: String(authors[0]),
            now,
          });
          if (outcome.result) {
            // Repeated ticks may resend a ready preview after a notification failure.
            // Published/discarded/cleaned drafts cannot be recreated by this path.
            const preview = await resultPreview(tenant, outcome.result.draftId, options);
            if (preview)
              for (const author of authors)
                await options.bot.api
                  .sendMessage(String(author), preview.text, {
                    ...(preview.keyboard ? { reply_markup: preview.keyboard } : {}),
                  })
                  .catch(() => undefined);
            continue;
          }
          const tally = decision.tally;
          const totals =
            tally.status === 'counted'
              ? `Усього голосів: ${tally.total}\n${tally.counts.map((n, i) => `No ${i + 1}: ${n}`).join('\n')}`
              : 'Результат голосування недоступний.';
          const sources = Object.entries(tally.sources ?? {})
            .map(
              ([key, value]) =>
                `${key}: ${value.status === 'counted' ? value.total : value.status}`,
            )
            .join('\n');
          const keyboard = {
            inline_keyboard: decision.allowed.map((id) => {
              const index = closing.poll.entryRefs.indexOf(id);
              return [
                {
                  text: `No ${index + 1}`,
                  callback_data: `wotw:${week}:${closing.claim}:${index}`,
                },
              ];
            }),
          };
          for (const author of authors)
            await options.bot.api
              .sendMessage(String(author), `${totals}\n${sources}\nОберіть роботу тижня:`, {
                reply_markup: keyboard,
              })
              .catch(() => undefined);
        } catch {
          console.error(`poll closing failed for tenant ${tenant}`);
        }
      }
    } catch {
      console.error(`poll closing cron failed for tenant ${tenant}`);
    }
  }
}
