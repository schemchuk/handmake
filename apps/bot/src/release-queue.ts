import type { PublishJob, PublishRunner, ReleaseQueueConfig, TenantConfig } from '@handmake/core';

import type { AllowList } from './allow-list';
import { addDays, meetingDayKey, wallDay, zonedTimeToUtc } from './announcements';
import type { D1DraftStore, StoredDraft } from './draft-store';
import type { TenantConfigSource } from './tenant-config-source';
import type { BotTexts } from './texts';

/**
 * F42 release queue (T76a). A queued work waits in D1 as `scheduled` with a
 * slot (`publish_at`); this module computes slots and dispatches due drafts
 * from the 15-minute cron. Slots are local wall times in the tenant timezone
 * (DST-safe via zonedTimeToUtc) and sit on quarter hours, so the cron tick at
 * the slot picks the draft up.
 */

/** Failed dispatch ticks before a queued draft goes back to `ready`. */
export const maxQueueAttempts = 3;

/** How far ahead a slot is searched; far beyond any realistic queue. */
const horizonDays = 366;

const weekdays = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
const ukWeekdays = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];

/** The slot time on a local day (UTC fields of `day` carry Y/M/D). */
function slotOn(day: Date, config: ReleaseQueueConfig, timeZone: string): Date {
  const weekday = weekdays[day.getUTCDay()]!;
  const [hours, minutes] = (config.overrides[weekday] ?? config.time).split(':').map(Number);
  return zonedTimeToUtc(
    new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours!, minutes!)),
    timeZone,
  );
}

/**
 * The first free slot: one per local day, today's only while it is at least
 * `leadMinutes` away. `taken` are the slots of drafts already queued.
 */
export function nextFreeSlot(
  now: Date,
  taken: readonly Date[],
  config: ReleaseQueueConfig,
  timeZone: string,
): Date {
  const takenDays = new Set(taken.map((slot) => meetingDayKey(slot, timeZone)));
  const earliest = now.getTime() + config.leadMinutes * 60_000;
  const today = wallDay(now, timeZone);
  for (let offset = 0; offset < horizonDays; offset++) {
    const slot = slotOn(addDays(today, offset), config, timeZone);
    if (slot.getTime() < earliest) continue;
    if (takenDays.has(meetingDayKey(slot, timeZone))) continue;
    return slot;
  }
  throw new Error('release queue has no free slot within a year');
}

/** «середа, 25.11 о 18:30» in the tenant timezone. */
export function formatSlot(slot: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(slot)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ukWeekdays[weekdays.indexOf(parts['weekday']!.toLowerCase() as never)]!;
  return `${weekday}, ${parts['day']}.${parts['month']} о ${parts['hour']}:${parts['minute']}`;
}

/** Whether drafts of this kind go through the queue for the tenant. */
export function queuesKind(config: TenantConfig, kind: StoredDraft['draft']['kind']): boolean {
  return !!config.releaseQueue?.kinds.some((queued) => queued === kind);
}

export interface ReleaseQueueCronOptions {
  drafts: D1DraftStore;
  runner: PublishRunner;
  /** The same job the publish button builds (bot.ts publishJobOf). */
  buildJob: (draft: StoredDraft['draft']) => PublishJob;
  tenantConfigs: TenantConfigSource;
  allowList: AllowList;
  /** Sends a plain message to the author's chat. */
  notify: (chatId: string, text: string) => Promise<unknown>;
  texts: BotTexts;
}

/**
 * Dispatches every due queued draft. Queued drafts are dispatched even when
 * the tenant later drops `releaseQueue`, so nothing gets stuck. The claim
 * (`scheduled` → `publishing`) is atomic, so overlapping ticks dispatch once.
 * One failing tenant or draft never stops the others.
 */
export async function runReleaseQueueCron(
  now: Date,
  options: ReleaseQueueCronOptions,
): Promise<void> {
  for (const tenantId of new Set(options.allowList.values())) {
    try {
      const queued = await options.drafts.listScheduled(tenantId);
      const due = queued.filter((stored) => Date.parse(stored.publishAt ?? '') <= now.getTime());
      if (!due.length) continue;
      const timeZone = (await options.tenantConfigs.load(tenantId)).meetingSchedule.timezone;
      for (const stored of due) await dispatchDue(now, tenantId, stored, timeZone, options);
    } catch (error) {
      console.error(`release queue cron failed for tenant ${tenantId}:`, (error as Error).message);
    }
  }
}

async function dispatchDue(
  now: Date,
  tenantId: string,
  stored: StoredDraft,
  timeZone: string,
  options: ReleaseQueueCronOptions,
): Promise<void> {
  const draftId = stored.draft.draftId;
  const claimed = await options.drafts.claimDue(tenantId, draftId, now);
  if (!claimed) return;
  // A job that cannot be built never becomes valid by waiting: give up at
  // once. A failed dispatch is retried on the next ticks.
  let attempts = 1;
  try {
    const job = options.buildJob(claimed.draft);
    attempts = maxQueueAttempts;
    await options.runner.run(job);
    return;
  } catch (error) {
    console.error(`release queue dispatch failed for ${draftId}:`, (error as Error).message);
  }
  const outcome = await options.drafts.requeueAfterFailure(tenantId, draftId, now, attempts);
  if (outcome !== 'gave-up') return;
  const chatId =
    (claimed.draft.extras['approvalChatId'] as string | undefined) ??
    (await options.drafts.chatIdOf(tenantId, draftId));
  if (!chatId) return;
  const slot = formatSlot(new Date(stored.publishAt!), timeZone);
  await options
    .notify(chatId, options.texts.queueGaveUpText.replace('{slot}', slot))
    .catch(() => undefined);
}
