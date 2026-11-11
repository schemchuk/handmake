import { contestWeek, deterministicUlid } from '@handmake/core';
import type { Draft, EntryNames, SubmissionSource } from '@handmake/core';
import type { Bot } from 'grammy';

import type { AllowList } from './allow-list';
import { announcementWindowMs, latestOccurrenceInWindow } from './announcements';
import type { AppContext } from './context';
import type { PollOpeningStore } from './poll-opening-store';
import { buildTenantPreview } from './preview';
import type { TenantConfigSource } from './tenant-config-source';
import type { BotTexts } from './texts';

export interface PollCronOptions {
  openings: PollOpeningStore;
  source: SubmissionSource;
  bot: Bot<AppContext>;
  tenantConfigs: TenantConfigSource;
  allowList: AllowList;
  texts: BotTexts;
  lookupNames: (tenant: string, ids: string[]) => Promise<EntryNames>;
  publishesLive: boolean;
}

/** Opening creates a ready draft, never a publication or a paid translation. */
export async function runPollCron(now: Date, options: PollCronOptions): Promise<void> {
  const tenants = new Map<string, number[]>();
  for (const [author, tenant] of options.allowList) {
    tenants.set(tenant, [...(tenants.get(tenant) ?? []), author]);
  }
  for (const [tenantId, authors] of tenants) {
    try {
      const config = await options.tenantConfigs.load(tenantId);
      if (config.id !== tenantId) throw new Error('tenant config mismatch');
      if (!config.featureFlags.wotwPoll) continue;
      const opening = latestOccurrenceInWindow(
        config.workOfWeek.opens,
        now,
        announcementWindowMs,
        config.meetingSchedule.timezone,
      );
      if (!opening) continue;
      // Shift the Berlin calendar key, not the opening instant: a week crossing
      // DST is not always 168 hours. Monday opens voting on last week's entries.
      const previousMonday = new Date(`${contestWeek(opening)}T12:00:00Z`);
      previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
      const week = previousMonday.toISOString().slice(0, 10);
      const draftId = await deterministicUlid(`${tenantId}:wotw-poll:${week}`, opening.getTime());
      if (await options.openings.has(tenantId, week)) continue;
      const entries = await options.source.listSubmissions(tenantId, week);
      if (entries.length < 2) {
        if (await options.openings.createIfAbsent(tenantId, week, String(authors[0]))) {
          await notify(authors, options.texts.pollTooFewEntriesText, options);
        }
        continue;
      }
      if (entries.length > 10 || entries.some((e) => e.tenantId !== tenantId || e.week !== week)) {
        throw new Error('Invalid contest candidates');
      }
      const captions = entries.map((entry, i) => `${i + 1}. {entry:${entry.entryId}}`).join('\n');
      const draft: Draft = {
        tenantId,
        draftId,
        kind: 'post',
        type: 'wotw-poll',
        state: 'ready',
        extras: {
          week,
          entryRefs: entries.map((entry) => entry.entryId),
          poll: {
            question: options.texts.pollQuestionText,
            options: entries.map((_, i) => `No ${i + 1}`),
          },
        },
        texts: {
          uk: `${options.texts.pollDraftUkText}\n\n${captions}`,
          de: `${options.texts.pollDraftDeText}\n\n${captions}`,
        },
        photoRefs: entries.map((entry) => entry.photoRef),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      // Names are a transient projection. Persist only placeholders and entry/media refs.
      const preview = await buildTenantPreview(
        draft,
        options.texts,
        { load: async () => config },
        options.publishesLive,
        options.lookupNames,
      );
      if (!(await options.openings.createIfAbsent(tenantId, week, String(authors[0]), draft)))
        continue;
      for (const author of authors) {
        await options.bot.api
          .sendMessage(String(author), preview.text, {
            ...(preview.keyboard ? { reply_markup: preview.keyboard } : {}),
          })
          .catch(() => undefined);
      }
    } catch {
      // Neither adapter diagnostics nor names may reach logs.
      console.error(`poll cron failed for tenant ${tenantId}`);
    }
  }
}

async function notify(authors: number[], text: string, options: PollCronOptions): Promise<void> {
  for (const author of authors) {
    await options.bot.api.sendMessage(String(author), text).catch(() => undefined);
  }
}
