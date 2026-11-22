import { createDraft, tenantConfigSchema } from '@handmake/core';
import type { Draft, PublishJob, ReleaseQueueConfig, TenantConfig } from '@handmake/core';
import { describe, expect, it, vi } from 'vitest';

import { createD1DraftStore, queueInterruptedMs } from '../src/draft-store';
import type { D1DraftStore } from '../src/draft-store';
import {
  formatSlot,
  maxQueueAttempts,
  nextFreeSlot,
  queuesKind,
  runReleaseQueueCron,
} from '../src/release-queue';
import { botTexts } from '../src/texts';
import { makeD1 } from './helpers';

const tz = 'Europe/Berlin';
const tenant = 'faden-und-stimmung';
const queue: ReleaseQueueConfig = {
  kinds: ['work'],
  time: '18:30',
  overrides: { tuesday: '19:30' },
  leadMinutes: 10,
  lowQueueReminder: 1,
};

/** Monday 2026-11-23 (CET, UTC+1). */
const monday10 = new Date('2026-11-23T09:00:00.000Z');
const mondaySlot = new Date('2026-11-23T17:30:00.000Z');
const tuesdaySlot = new Date('2026-11-24T18:30:00.000Z');
const wednesdaySlot = new Date('2026-11-25T17:30:00.000Z');

describe('nextFreeSlot', () => {
  it('takes today, then the Tuesday override, then the next day', () => {
    expect(nextFreeSlot(monday10, [], queue, tz)).toEqual(mondaySlot);
    expect(nextFreeSlot(monday10, [mondaySlot], queue, tz)).toEqual(tuesdaySlot);
    expect(nextFreeSlot(monday10, [mondaySlot, tuesdaySlot], queue, tz)).toEqual(wednesdaySlot);
  });

  it('skips a gap only where a day is taken', () => {
    expect(nextFreeSlot(monday10, [tuesdaySlot], queue, tz)).toEqual(mondaySlot);
    expect(nextFreeSlot(monday10, [mondaySlot, wednesdaySlot], queue, tz)).toEqual(tuesdaySlot);
  });

  it("skips today's slot inside the lead time", () => {
    expect(nextFreeSlot(new Date('2026-11-23T17:19:00.000Z'), [], queue, tz)).toEqual(mondaySlot);
    expect(nextFreeSlot(new Date('2026-11-23T17:25:00.000Z'), [], queue, tz)).toEqual(tuesdaySlot);
  });

  it('keeps 18:30 wall time across both DST switches', () => {
    // Spring forward: Sunday 2027-03-28 is the switch day (CEST, UTC+2 from 02:00).
    expect(nextFreeSlot(new Date('2027-03-28T08:00:00.000Z'), [], queue, tz)).toEqual(
      new Date('2027-03-28T16:30:00.000Z'),
    );
    expect(
      nextFreeSlot(
        new Date('2027-03-27T08:00:00.000Z'),
        [new Date('2027-03-27T17:30:00.000Z')],
        queue,
        tz,
      ),
    ).toEqual(new Date('2027-03-28T16:30:00.000Z'));
    // Fall back: Sunday 2026-10-25 (CET again from 03:00).
    expect(
      nextFreeSlot(
        new Date('2026-10-24T08:00:00.000Z'),
        [new Date('2026-10-24T16:30:00.000Z')],
        queue,
        tz,
      ),
    ).toEqual(new Date('2026-10-25T17:30:00.000Z'));
  });
});

describe('formatSlot and queuesKind', () => {
  it('formats the slot in Ukrainian wall time', () => {
    expect(formatSlot(tuesdaySlot, tz)).toBe('вівторок, 24.11 о 19:30');
  });

  it('queues only the configured kinds and nothing without the block', () => {
    const base = { releaseQueue: queue } as TenantConfig;
    expect(queuesKind(base, 'work')).toBe(true);
    expect(queuesKind(base, 'post')).toBe(false);
    expect(queuesKind({} as TenantConfig, 'work')).toBe(false);
  });

  it('the tenant schema fills defaults and rejects a bad time', () => {
    const shape = tenantConfigSchema.shape.releaseQueue;
    expect(shape.parse({ kinds: ['work'], time: '18:30' })).toEqual({
      kinds: ['work'],
      time: '18:30',
      overrides: {},
      leadMinutes: 10,
      lowQueueReminder: 1,
    });
    expect(shape.safeParse({ kinds: ['work'], time: '18:61' }).success).toBe(false);
    expect(shape.safeParse({ kinds: ['show'], time: '18:30' }).success).toBe(false);
  });
});

function readyWork(id: string): Draft {
  return { ...createDraft(tenant, id, monday10, { kind: 'work' }), state: 'ready' };
}

async function queued(store: D1DraftStore, id: string, slot: Date): Promise<void> {
  await store.create(readyWork(id), 'chat-1');
  expect(await store.schedule(tenant, id, slot, monday10, 'chat-approve')).toBe('scheduled');
}

function cronOptions(
  store: D1DraftStore,
  run: (job: PublishJob) => Promise<void>,
  buildJob: (draft: Draft) => PublishJob = (draft) =>
    ({ tenantId: draft.tenantId, postId: draft.draftId }) as PublishJob,
) {
  const notify = vi.fn(async () => undefined);
  return {
    notify,
    options: {
      drafts: store,
      runner: { run: vi.fn(run) },
      buildJob,
      tenantConfigs: { load: async () => ({ meetingSchedule: { timezone: tz } }) as TenantConfig },
      allowList: new Map([[42, tenant]]),
      notify,
      texts: botTexts,
    },
  };
}

describe('D1 release queue', () => {
  it('schedule, list in slot order, unschedule frees the slot', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'b', tuesdaySlot);
    await queued(store, 'a', mondaySlot);
    const list = await store.listScheduled(tenant);
    expect(list.map((s) => [s.draft.draftId, s.draft.state, s.publishAt])).toEqual([
      ['a', 'scheduled', mondaySlot.toISOString()],
      ['b', 'scheduled', tuesdaySlot.toISOString()],
    ]);
    expect(list[0]!.draft.extras['approvalChatId']).toBe('chat-approve');
    expect(await store.schedule(tenant, 'a', wednesdaySlot, monday10)).toBe('not-ready');
    expect(await store.listScheduled('other-tenant')).toEqual([]);

    expect(await store.unschedule(tenant, 'a', monday10)).toBe(true);
    const back = await store.get(tenant, 'a');
    expect(back?.draft.state).toBe('ready');
    expect(back?.publishAt).toBeUndefined();
  });

  it('claims a due slot once and never before it', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    expect(await store.claimDue(tenant, 'a', new Date(mondaySlot.getTime() - 1))).toBeUndefined();
    const [first, second] = await Promise.all([
      store.claimDue(tenant, 'a', mondaySlot),
      store.claimDue(tenant, 'a', mondaySlot),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await store.get(tenant, 'a'))?.draft.state).toBe('publishing');
  });

  it('retention never deletes a queued draft', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    await store.create(readyWork('stale'), 'chat-2');
    expect(await store.deleteOlderThan(new Date('2027-01-01T00:00:00.000Z'))).toBe(1);
    expect(await store.get(tenant, 'a')).toBeDefined();
  });
});

describe('runReleaseQueueCron', () => {
  it('dispatches due drafts only, once across overlapping ticks', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    await queued(store, 'b', tuesdaySlot);
    const { options } = cronOptions(store, async () => undefined);
    await Promise.all([
      runReleaseQueueCron(mondaySlot, options),
      runReleaseQueueCron(mondaySlot, options),
    ]);
    expect(options.runner.run).toHaveBeenCalledTimes(1);
    expect(options.runner.run).toHaveBeenCalledWith({ tenantId: tenant, postId: 'a' });
    expect((await store.get(tenant, 'a'))?.draft.state).toBe('publishing');
    expect((await store.get(tenant, 'b'))?.draft.state).toBe('scheduled');
  });

  it('retries a failed dispatch on the same slot, then gives up and tells the author', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    const { options, notify } = cronOptions(store, async () => {
      throw new Error('HTTP 502');
    });
    for (let tick = 1; tick < maxQueueAttempts; tick++) {
      await runReleaseQueueCron(new Date(mondaySlot.getTime() + tick * 900_000), options);
      const stored = await store.get(tenant, 'a');
      expect(stored?.draft.state).toBe('scheduled');
      expect(stored?.publishAt).toBe(mondaySlot.toISOString());
    }
    expect(notify).not.toHaveBeenCalled();
    await runReleaseQueueCron(new Date(mondaySlot.getTime() + 3 * 900_000), options);
    expect(options.runner.run).toHaveBeenCalledTimes(maxQueueAttempts);
    const stored = await store.get(tenant, 'a');
    expect(stored?.draft.state).toBe('ready');
    expect(stored?.publishAt).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(
      'chat-approve',
      expect.stringContaining('понеділок, 23.11 о 18:30'),
    );
  });

  it('a job that cannot be built goes back to ready at once', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    const { options, notify } = cronOptions(
      store,
      async () => undefined,
      () => {
        throw new Error('work is not ready for approval');
      },
    );
    await runReleaseQueueCron(mondaySlot, options);
    expect(options.runner.run).not.toHaveBeenCalled();
    expect((await store.get(tenant, 'a'))?.draft.state).toBe('ready');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('an empty queue loads no tenant config', async () => {
    const store = createD1DraftStore(await makeD1());
    const { options } = cronOptions(store, async () => undefined);
    const load = vi.spyOn(options.tenantConfigs, 'load');
    await runReleaseQueueCron(mondaySlot, options);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('release queue races (PR #187 review)', () => {
  const failing = async () => {
    throw new Error('HTTP 502');
  };

  it('two works never share a slot', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    await store.create(readyWork('b'), 'chat-1');
    expect(await store.schedule(tenant, 'b', mondaySlot, monday10)).toBe('slot-taken');
    expect((await store.get(tenant, 'b'))?.draft.state).toBe('ready');
  });

  it('a claim that was never dispatched is reclaimed after the interruption window', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    expect(await store.claimDue(tenant, 'a', mondaySlot)).toBeDefined(); // Worker dies here
    const { options } = cronOptions(store, async () => undefined);
    await runReleaseQueueCron(new Date(mondaySlot.getTime() + 60_000), options);
    expect(options.runner.run).not.toHaveBeenCalled();
    await runReleaseQueueCron(
      new Date(mondaySlot.getTime() + queueInterruptedMs + 60_000),
      options,
    );
    expect(options.runner.run).toHaveBeenCalledTimes(1);
  });

  it('a failure never touches a manual 🚀 that took over the claim', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    const claimed = (await store.claimDue(tenant, 'a', mondaySlot))!;
    const later = new Date(mondaySlot.getTime() + 600_000);
    expect(await store.claimPublishing(tenant, 'a', later, later)).toBeDefined();
    expect(await store.requeueAfterFailure(tenant, 'a', claimed.version, later, 3)).toBe('missing');
    const stored = await store.get(tenant, 'a');
    expect(stored?.draft.state).toBe('publishing');
    expect(stored?.publishAt).toBeUndefined();
  });

  it('two executions of one tick spend one attempt', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    const { options } = cronOptions(store, failing);
    await runReleaseQueueCron(mondaySlot, options);
    await runReleaseQueueCron(mondaySlot, options);
    expect(options.runner.run).toHaveBeenCalledTimes(1);
    expect((await store.get(tenant, 'a'))?.draft.state).toBe('scheduled');
  });

  it('a late success callback on a requeued draft marks it published', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    const { options } = cronOptions(store, failing);
    await runReleaseQueueCron(mondaySlot, options);
    expect(await store.markPublished(tenant, 'a', mondaySlot)).toBe(true);
    await runReleaseQueueCron(new Date(mondaySlot.getTime() + 900_000), options);
    expect(options.runner.run).toHaveBeenCalledTimes(1);
  });

  it('delete refuses a draft the cron has claimed', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    await store.claimDue(tenant, 'a', mondaySlot);
    await store.delete(tenant, 'a');
    expect((await store.get(tenant, 'a'))?.draft.state).toBe('publishing');
  });

  it('a backlog drains one work per tick and waits for a run in flight', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    await queued(store, 'b', tuesdaySlot);
    const { options } = cronOptions(store, async () => undefined);
    const afterOutage = new Date(tuesdaySlot.getTime() + 60_000);
    await runReleaseQueueCron(afterOutage, options);
    expect(options.runner.run).toHaveBeenCalledTimes(1);
    expect(options.runner.run).toHaveBeenLastCalledWith({ tenantId: tenant, postId: 'a' });
    // A's run is in flight: the next tick waits.
    await runReleaseQueueCron(new Date(afterOutage.getTime() + 900_000), options);
    expect(options.runner.run).toHaveBeenCalledTimes(1);
    await store.markPublished(tenant, 'a', new Date(afterOutage.getTime() + 1_000_000));
    await runReleaseQueueCron(new Date(afterOutage.getTime() + 1_800_000), options);
    expect(options.runner.run).toHaveBeenLastCalledWith({ tenantId: tenant, postId: 'b' });
  });

  it('a manual publish in flight also holds the queue', async () => {
    const store = createD1DraftStore(await makeD1());
    await queued(store, 'a', mondaySlot);
    await store.create(readyWork('manual'), 'chat-1');
    await store.claimPublishing(tenant, 'manual', mondaySlot);
    const { options } = cronOptions(store, async () => undefined);
    await runReleaseQueueCron(mondaySlot, options);
    expect(options.runner.run).not.toHaveBeenCalled();
  });
});
