import { channelDelay, channelLabel } from '@handmake/core';
import type { ChannelDelay, PublishJob, PublishRunner, TenantConfig } from '@handmake/core';

import { addDays, wallDay, zonedTimeToUtc } from './announcements';
import type { D1DraftStore } from './draft-store';
import { queueBusyMs, queueLostRunMs, queueRetryMs } from './draft-store';
import type { TenantConfigSource } from './tenant-config-source';
import type { BotTexts } from './texts';

/**
 * F42 delayed channels (T77). A work's first dispatch names only the
 * channels without a delay; each delayed one waits in `channel_followups`
 * and the release-queue cron dispatches it later with the stored job and
 * `channels: [<channel>]`. A follow-up goes out only after its draft is
 * `published` (the first run reported back), and it shares the queue's
 * one-run-at-a-time rule, since every publish run shares one concurrency
 * group.
 */

/** Dispatches of one follow-up before it is given up. */
export const maxFollowupAttempts = 3;

/** When a delayed channel is due: `minutes` after `base`, or the wall time
 * on the local day after `base` (DST-safe via zonedTimeToUtc). */
export function channelDueAt(delay: ChannelDelay, base: Date, timeZone: string): Date {
  if ('minutes' in delay) return new Date(base.getTime() + delay.minutes * 60_000);
  const [hours, minutes] = delay.nextDayAt.split(':').map(Number);
  const day = addDays(wallDay(base, timeZone), 1);
  return zonedTimeToUtc(
    new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours!, minutes!)),
    timeZone,
  );
}

export interface PlannedFollowup {
  channel: string;
  dueAt: Date;
}

/** Splits a work job into the first dispatch and its delayed channels.
 * Posts and shows, and works without a delayed channel, stay unchanged. */
export function planFollowups(
  job: PublishJob,
  config: TenantConfig,
  now: Date,
): { job: PublishJob; followups: PlannedFollowup[] } {
  if (job.kind !== 'work') return { job, followups: [] };
  const timeZone = config.meetingSchedule.timezone;
  const followups = job.work.channels.flatMap((channel) => {
    const delay = channelDelay(config, channel);
    return delay ? [{ channel, dueAt: channelDueAt(delay, now, timeZone) }] : [];
  });
  if (!followups.length) return { job, followups };
  const delayed = new Set(followups.map((followup) => followup.channel));
  return {
    job: { ...job, channels: job.work.channels.filter((channel) => !delayed.has(channel)) },
    followups,
  };
}

export interface FollowupRow {
  tenantId: string;
  draftId: string;
  channel: string;
  job: PublishJob;
  dueAt: string;
  state: 'pending' | 'dispatched' | 'done' | 'failed';
  attempts: number;
  dispatchedAt?: string;
}

export interface FollowupStore {
  /** Stores the delayed channels of a dispatch. A row already dispatched or
   * done keeps its state; a pending or failed one starts over. */
  schedule(
    tenantId: string,
    draftId: string,
    job: PublishJob,
    followups: readonly PlannedFollowup[],
    now: Date,
  ): Promise<void>;
  /** A follow-up run dispatched within the busy window, without callback. */
  inFlight(now: Date): Promise<boolean>;
  /** The earliest due row whose draft is published, or a lost run. */
  nextDue(now: Date): Promise<FollowupRow | undefined>;
  /** Atomically marks the row (as read) dispatched; one more attempt. */
  claim(row: FollowupRow, now: Date): Promise<FollowupRow | undefined>;
  /** A failed dispatch: pending again, due after about one tick. */
  retryLater(row: FollowupRow, now: Date): Promise<void>;
  /** Gives the row (as read) up; true only for the caller that did. */
  giveUp(row: FollowupRow, now: Date): Promise<boolean>;
  /** The publish callback reported these channels done. */
  markDone(
    tenantId: string,
    draftId: string,
    channels: readonly string[],
    now: Date,
  ): Promise<void>;
}

interface FollowupDbRow {
  tenant_id: string;
  draft_id: string;
  channel: string;
  job: string;
  due_at: string;
  state: FollowupRow['state'];
  attempts: number;
  dispatched_at: string | null;
}

const columns = 'tenant_id, draft_id, channel, job, due_at, state, attempts, dispatched_at';
const joinedColumns = columns
  .split(', ')
  .map((column) => `f.${column}`)
  .join(', ');

function toRow(row: FollowupDbRow): FollowupRow {
  return {
    tenantId: row.tenant_id,
    draftId: row.draft_id,
    channel: row.channel,
    job: JSON.parse(row.job) as PublishJob,
    dueAt: row.due_at,
    state: row.state,
    attempts: row.attempts,
    ...(row.dispatched_at ? { dispatchedAt: row.dispatched_at } : {}),
  };
}

/** Matches the row exactly as it was read: a racing writer wins. */
const asRead = `tenant_id = ? AND draft_id = ? AND channel = ? AND state = ? AND attempts = ?`;
const asReadArgs = (row: FollowupRow) => [
  row.tenantId,
  row.draftId,
  row.channel,
  row.state,
  row.attempts,
];

export function createD1FollowupStore(db: D1Database): FollowupStore {
  return {
    async schedule(tenantId, draftId, job, followups, now) {
      if (!followups.length) return;
      await db.batch(
        followups.map((followup) =>
          db
            .prepare(
              `INSERT INTO channel_followups
               (tenant_id, draft_id, channel, job, due_at, state, attempts, dispatched_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?)
               ON CONFLICT (tenant_id, draft_id, channel) DO UPDATE SET
                 job = excluded.job, due_at = excluded.due_at, state = 'pending', attempts = 0,
                 dispatched_at = NULL, updated_at = excluded.updated_at
               WHERE channel_followups.state IN ('pending', 'failed')`,
            )
            .bind(
              tenantId,
              draftId,
              followup.channel,
              JSON.stringify(job),
              followup.dueAt.toISOString(),
              now.toISOString(),
            ),
        ),
      );
    },

    async inFlight(now) {
      const row = await db
        .prepare(
          `SELECT 1 AS busy FROM channel_followups
           WHERE state = 'dispatched' AND dispatched_at >= ? LIMIT 1`,
        )
        .bind(new Date(now.getTime() - queueBusyMs).toISOString())
        .first();
      return !!row;
    },

    async nextDue(now) {
      const row = await db
        .prepare(
          `SELECT ${joinedColumns} FROM channel_followups f
           JOIN drafts d ON d.tenant_id = f.tenant_id AND d.id = f.draft_id
           WHERE d.status = 'published' AND (
             (f.state = 'pending' AND f.due_at <= ?)
             OR (f.state = 'dispatched' AND f.dispatched_at < ?))
           ORDER BY f.due_at, f.draft_id, f.channel LIMIT 1`,
        )
        .bind(now.toISOString(), new Date(now.getTime() - queueLostRunMs).toISOString())
        .first<FollowupDbRow>();
      return row ? toRow(row) : undefined;
    },

    async claim(row, now) {
      const claimed = await db
        .prepare(
          `UPDATE channel_followups
           SET state = 'dispatched', dispatched_at = ?, attempts = attempts + 1, updated_at = ?
           WHERE ${asRead}
           RETURNING ${columns}`,
        )
        .bind(now.toISOString(), now.toISOString(), ...asReadArgs(row))
        .first<FollowupDbRow>();
      return claimed ? toRow(claimed) : undefined;
    },

    async retryLater(row, now) {
      await db
        .prepare(
          `UPDATE channel_followups
           SET state = 'pending', due_at = ?, dispatched_at = NULL, updated_at = ?
           WHERE ${asRead}`,
        )
        .bind(
          new Date(now.getTime() + queueRetryMs).toISOString(),
          now.toISOString(),
          ...asReadArgs(row),
        )
        .run();
    },

    async giveUp(row, now) {
      const result = await db
        .prepare(`UPDATE channel_followups SET state = 'failed', updated_at = ? WHERE ${asRead}`)
        .bind(now.toISOString(), ...asReadArgs(row))
        .run();
      return result.meta.changes > 0;
    },

    async markDone(tenantId, draftId, channels, now) {
      if (!channels.length) return;
      await db
        .prepare(
          `UPDATE channel_followups SET state = 'done', updated_at = ?
           WHERE tenant_id = ? AND draft_id = ? AND state != 'done'
             AND channel IN (${channels.map(() => '?').join(', ')})`,
        )
        .bind(now.toISOString(), tenantId, draftId, ...channels)
        .run();
    },
  };
}

/**
 * The job to dispatch for an approved draft: a work with delayed channels
 * loses them here and they are stored as follow-ups first. Without a store
 * or config, or when storing fails, everything goes out at once: the
 * author asked to publish, and a missed delay is better than a lost channel.
 */
export async function prepareDispatch(
  job: PublishJob,
  deps: { tenantConfigs?: TenantConfigSource; followups?: FollowupStore },
  now: Date,
): Promise<PublishJob> {
  if (job.kind !== 'work' || !deps.tenantConfigs || !deps.followups) return job;
  try {
    const plan = planFollowups(job, await deps.tenantConfigs.load(job.tenantId), now);
    if (!plan.followups.length) return job;
    await deps.followups.schedule(job.tenantId, job.postId, job, plan.followups, now);
    return plan.job;
  } catch (error) {
    console.error(
      `delayed channels unavailable for ${job.postId}; publishing every channel now:`,
      (error as Error).message,
    );
    return job;
  }
}

export interface FollowupCronOptions {
  drafts: D1DraftStore;
  followups: FollowupStore;
  runner: PublishRunner;
  notify: (chatId: string, text: string) => Promise<unknown>;
  texts: BotTexts;
}

/**
 * Dispatches at most one due follow-up, and none while any publish run is
 * in flight (a queued draft publishing, or another follow-up). Called from
 * the release-queue cron under its lock, only on a tick that dispatched
 * nothing else.
 */
export async function dispatchFollowup(now: Date, options: FollowupCronOptions): Promise<void> {
  const { followups } = options;
  if ((await followups.inFlight(now)) || (await options.drafts.publishBusy(now))) return;
  const row = await followups.nextDue(now);
  if (!row) return;
  if (row.attempts >= maxFollowupAttempts) {
    if (await followups.giveUp(row, now)) await tellGaveUp(row, options);
    return;
  }
  const claimed = await followups.claim(row, now);
  if (!claimed) return;
  try {
    await options.runner.run({ ...claimed.job, channels: [claimed.channel] });
  } catch (error) {
    console.error(
      `follow-up dispatch failed for ${claimed.draftId}/${claimed.channel}:`,
      (error as Error).message,
    );
    if (claimed.attempts < maxFollowupAttempts) await followups.retryLater(claimed, now);
    else if (await followups.giveUp(claimed, now)) await tellGaveUp(claimed, options);
  }
}

async function tellGaveUp(row: FollowupRow, options: FollowupCronOptions): Promise<void> {
  try {
    const stored = await options.drafts.get(row.tenantId, row.draftId);
    const approvalChat = stored?.draft.extras['approvalChatId'];
    const chatId =
      typeof approvalChat === 'string'
        ? approvalChat
        : await options.drafts.chatIdOf(row.tenantId, row.draftId);
    if (chatId)
      await options.notify(chatId, options.texts.followupFailedText(channelLabel(row.channel)));
  } catch (error) {
    console.error('follow-up give-up notice failed:', (error as Error).message);
  }
}
