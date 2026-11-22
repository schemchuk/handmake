import { createDraft, signCallbackBody } from '@handmake/core';
import type { Draft, PublishJob, TenantConfig } from '@handmake/core';
import { describe, expect, it, vi } from 'vitest';

import {
  channelDueAt,
  createD1FollowupStore,
  maxFollowupAttempts,
  planFollowups,
  prepareDispatch,
} from '../src/channel-followups';
import type { FollowupStore } from '../src/channel-followups';
import { createD1DraftStore, queueLostRunMs } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import type { Env } from '../src/env';
import { handlePublishedCallback } from '../src/published-callback';
import { runReleaseQueueCron } from '../src/release-queue';
import { botTexts } from '../src/texts';
import { makeD1 } from './helpers';

const tz = 'Europe/Berlin';
const tenant = 'faden-und-stimmung';
const minute = 60_000;
/** Monday 2026-11-23, 18:30 CET. */
const mondaySlot = new Date('2026-11-23T17:30:00.000Z');

const config = {
  meetingSchedule: { timezone: tz },
  channels: {
    telegram: { channelId: 'TELEGRAM_CHANNEL_ID' },
    instagram: { language: 'de' },
    threads: { language: 'de', delay: { minutes: 90 } },
  },
} as unknown as TenantConfig;

function workJob(id: string, channels = ['telegram', 'instagram', 'threads']): PublishJob {
  return {
    tenantId: tenant,
    postId: id,
    kind: 'work',
    type: 'free',
    texts: { uk: 'UA' },
    fileIds: ['photo'],
    provenance: 'human',
    work: { channels } as never,
  };
}

describe('channelDueAt', () => {
  it('adds minutes as absolute time, also over the DST switch', () => {
    expect(channelDueAt({ minutes: 90 }, mondaySlot, tz)).toEqual(
      new Date('2026-11-23T19:00:00.000Z'),
    );
    // 2027-10-31 01:30 CEST + 90 min = 02:00 CET (clocks went back at 03:00).
    expect(channelDueAt({ minutes: 90 }, new Date('2027-10-30T23:30:00.000Z'), tz)).toEqual(
      new Date('2027-10-31T01:00:00.000Z'),
    );
  });

  it('takes the wall time on the next local day, DST-safe both ways', () => {
    expect(channelDueAt({ nextDayAt: '09:00' }, mondaySlot, tz)).toEqual(
      new Date('2026-11-24T08:00:00.000Z'),
    );
    // Saturday 18:30 CET -> Sunday 09:00 CEST (spring forward 2027-03-28).
    expect(channelDueAt({ nextDayAt: '09:00' }, new Date('2027-03-27T17:30:00.000Z'), tz)).toEqual(
      new Date('2027-03-28T07:00:00.000Z'),
    );
    // Saturday 18:30 CEST -> Sunday 09:00 CET (fall back 2026-10-25).
    expect(channelDueAt({ nextDayAt: '09:00' }, new Date('2026-10-24T16:30:00.000Z'), tz)).toEqual(
      new Date('2026-10-25T08:00:00.000Z'),
    );
    // 00:30 local is already the next day: 09:00 of the day after.
    expect(channelDueAt({ nextDayAt: '09:00' }, new Date('2026-11-23T23:30:00.000Z'), tz)).toEqual(
      new Date('2026-11-25T08:00:00.000Z'),
    );
  });
});

describe('planFollowups', () => {
  it('splits delayed channels off a work job', () => {
    const plan = planFollowups(workJob('a'), config, mondaySlot);
    expect(plan.job.channels).toEqual(['telegram', 'instagram']);
    expect(plan.followups).toEqual([
      { channel: 'threads', dueAt: new Date('2026-11-23T19:00:00.000Z') },
    ]);
  });

  it('leaves posts and works without a delayed channel unchanged', () => {
    const noThreads = workJob('a', ['telegram']);
    expect(planFollowups(noThreads, config, mondaySlot)).toEqual({ job: noThreads, followups: [] });
    const post = { ...workJob('b'), kind: 'post', work: undefined } as unknown as PublishJob;
    expect(planFollowups(post, config, mondaySlot).job).toBe(post);
  });

  it('a work on delayed channels only goes out first with no channel', () => {
    expect(planFollowups(workJob('a', ['threads']), config, mondaySlot).job.channels).toEqual([]);
  });

  it('prepareDispatch stores the follow-up, or publishes everything when it cannot', async () => {
    const followups = { schedule: vi.fn(async () => undefined) } as unknown as FollowupStore;
    const tenantConfigs = { load: async () => config };
    const job = workJob('a');
    expect((await prepareDispatch(job, { tenantConfigs, followups }, mondaySlot)).channels).toEqual(
      ['telegram', 'instagram'],
    );
    expect(followups.schedule).toHaveBeenCalledWith(
      tenant,
      'a',
      job,
      [{ channel: 'threads', dueAt: new Date('2026-11-23T19:00:00.000Z') }],
      mondaySlot,
    );
    const broken = { load: async () => Promise.reject(new Error('GitHub down')) };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await prepareDispatch(job, { tenantConfigs: broken, followups }, mondaySlot)).toBe(job);
    expect(await prepareDispatch(job, { tenantConfigs }, mondaySlot)).toBe(job);
  });
});

async function setup() {
  const db = await makeD1();
  const drafts = createD1DraftStore(db);
  const followups = createD1FollowupStore(db);
  const run = vi.fn(async (_job: PublishJob) => undefined);
  const notify = vi.fn(async () => undefined);
  const options = {
    drafts,
    followups,
    runner: { run },
    buildJob: (draft: Draft) => workJob(draft.draftId),
    tenantConfigs: { load: async () => config },
    allowList: new Map([[42, tenant]]),
    notify,
    texts: botTexts,
  };
  return { db, drafts, followups, run, notify, options };
}

async function queuedWork(drafts: D1DraftStore, id: string, slot: Date): Promise<void> {
  await drafts.create(
    {
      ...createDraft(tenant, id, new Date('2026-11-23T09:00:00.000Z'), { kind: 'work' }),
      state: 'ready',
    },
    'chat-1',
  );
  expect(await drafts.schedule(tenant, id, slot, mondaySlot, 'chat-approve')).toBe('scheduled');
}

async function publishedWithFollowup(
  drafts: D1DraftStore,
  followups: FollowupStore,
  id: string,
  dueAt: Date,
): Promise<void> {
  await drafts.create(
    {
      ...createDraft(tenant, id, new Date('2026-11-23T09:00:00.000Z'), { kind: 'work' }),
      state: 'ready',
    },
    'chat-1',
  );
  expect(await drafts.markPublished(tenant, id, mondaySlot)).toBe(true);
  await followups.schedule(tenant, id, workJob(id), [{ channel: 'threads', dueAt }], mondaySlot);
}

const at = (minutes: number) => new Date(mondaySlot.getTime() + minutes * minute);

describe('follow-ups in the release-queue cron', () => {
  it('a work at 18:30 reaches Threads at 20:00, after its first run reported back', async () => {
    const { drafts, followups, run, options } = await setup();
    await queuedWork(drafts, 'a', mondaySlot);
    await runReleaseQueueCron(mondaySlot, options);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].channels).toEqual(['telegram', 'instagram']);

    // Due, but the first run has not reported back yet: Threads waits.
    await runReleaseQueueCron(at(90), options);
    expect(run).toHaveBeenCalledTimes(1);

    await drafts.markPublished(tenant, 'a', at(5));
    await runReleaseQueueCron(at(75), options);
    expect(run).toHaveBeenCalledTimes(1);
    await runReleaseQueueCron(at(90), options);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toEqual({ ...workJob('a'), channels: ['threads'] });

    // Dispatched once: the next tick sees it in flight.
    await runReleaseQueueCron(at(105), options);
    expect(run).toHaveBeenCalledTimes(2);
    await followups.markDone(tenant, 'a', ['threads'], at(100));
    await runReleaseQueueCron(at(300), options);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a follow-up in flight holds the queue; a queued work goes first on a shared tick', async () => {
    const { drafts, followups, run, options } = await setup();
    await publishedWithFollowup(drafts, followups, 'a', at(0));
    await queuedWork(drafts, 'b', at(15));
    await runReleaseQueueCron(at(0), options);
    expect(run.mock.calls.map(([job]) => [job.postId, job.channels])).toEqual([['a', ['threads']]]);
    await runReleaseQueueCron(at(15), options);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await drafts.get(tenant, 'b'))?.draft.state).toBe('scheduled');
    await followups.markDone(tenant, 'a', ['threads'], at(20));
    await runReleaseQueueCron(at(30), options);
    expect(run.mock.calls[1]![0].postId).toBe('b');

    // Both due on one tick: the queued work, the follow-up waits.
    await publishedWithFollowup(drafts, followups, 'c', at(60));
    await queuedWork(drafts, 'd', at(60));
    await drafts.markPublished(tenant, 'b', at(40));
    await runReleaseQueueCron(at(60), options);
    expect(run.mock.calls.map(([job]) => job.postId)).toEqual(['a', 'b', 'd']);
  });

  it('retries a failed dispatch each tick, then gives up and tells the author once', async () => {
    const { drafts, followups, run, notify, options } = await setup();
    await publishedWithFollowup(drafts, followups, 'a', at(0));
    run.mockRejectedValue(new Error('HTTP 502'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let tick = 0; tick < maxFollowupAttempts; tick++) {
      await runReleaseQueueCron(at(tick * 15), options);
    }
    expect(run).toHaveBeenCalledTimes(maxFollowupAttempts);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('chat-1', botTexts.followupFailedText('Threads'));
    await runReleaseQueueCron(at(60), options);
    expect(run).toHaveBeenCalledTimes(maxFollowupAttempts);
  });

  it('a run with no callback is dispatched again after 2 h, at most three times', async () => {
    const { drafts, followups, run, notify, options } = await setup();
    await publishedWithFollowup(drafts, followups, 'a', at(0));
    let now = at(0);
    for (let attempt = 0; attempt < maxFollowupAttempts; attempt++) {
      await runReleaseQueueCron(now, options);
      now = new Date(now.getTime() + queueLostRunMs + minute);
    }
    expect(run).toHaveBeenCalledTimes(maxFollowupAttempts);
    await runReleaseQueueCron(now, options);
    expect(run).toHaveBeenCalledTimes(maxFollowupAttempts);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a new dispatch of the draft resets a failed follow-up but never a done one', async () => {
    const { db, followups } = await setup();
    const state = async () =>
      (await db
        .prepare('SELECT state, due_at FROM channel_followups WHERE draft_id = ?')
        .bind('a')
        .first<{ state: string; due_at: string }>())!;
    await followups.schedule(
      tenant,
      'a',
      workJob('a'),
      [{ channel: 'threads', dueAt: at(90) }],
      at(0),
    );
    await db.prepare(`UPDATE channel_followups SET state = 'failed'`).run();
    await followups.schedule(
      tenant,
      'a',
      workJob('a'),
      [{ channel: 'threads', dueAt: at(200) }],
      at(110),
    );
    expect(await state()).toEqual({ state: 'pending', due_at: at(200).toISOString() });
    await followups.markDone(tenant, 'a', ['threads'], at(210));
    await followups.schedule(
      tenant,
      'a',
      workJob('a'),
      [{ channel: 'threads', dueAt: at(400) }],
      at(310),
    );
    expect(await state()).toEqual({ state: 'done', due_at: at(200).toISOString() });
  });
});

describe('published callback and follow-ups', () => {
  it('a work callback marks the reported delayed channel done', async () => {
    const { db, drafts, followups } = await setup();
    await publishedWithFollowup(drafts, followups, 'a', at(90));
    const body = JSON.stringify({
      tenantId: tenant,
      kind: 'work',
      postId: 'a',
      date: '2026-11-23T09:00:00.000Z',
      photos: [],
      channels: { threads: { status: 'done', completedAt: at(95).toISOString(), messageIds: {} } },
    });
    const env = { DB: db, PUBLISH_CALLBACK_SECRET: 'secret' } as Env;
    const response = await handlePublishedCallback(
      env,
      new Request('https://bot.example/callbacks/published', {
        method: 'POST',
        headers: { 'x-handmake-signature': await signCallbackBody('secret', body) },
        body,
      }),
    );
    expect(response.status).toBe(200);
    const row = await db
      .prepare('SELECT state FROM channel_followups WHERE draft_id = ?')
      .bind('a')
      .first<{ state: string }>();
    expect(row?.state).toBe('done');
  });
});
