import { expect, it, vi } from 'vitest';
import { newUlid } from '@handmake/core';
import type { ChannelAdapter, DeliverContext } from '@handmake/core';
import { closeContestPoll } from '../src/poll-closing';
import { createPollClosingStore, findClosingPoll } from '../src/poll-closing-store';
import { makeD1 } from './helpers';

const tenant = 'faden-und-stimmung';
const week = '2026-11-02';
async function fixture() {
  const db = await makeD1();
  const refs = [newUlid(), newUlid()];
  const id = newUlid();
  for (const ref of refs)
    await db
      .prepare(
        `INSERT INTO contest_entries
    (tenant_id, entry_id, week, file_id, consent_at, created_at) VALUES (?, ?, ?, 'photo', 'now', 'now')`,
      )
      .bind(tenant, ref, week)
      .run();
  await db
    .prepare(
      `INSERT INTO drafts (tenant_id, id, chat_id, status, type, extras)
    VALUES (?, ?, '111', 'published', 'wotw-poll', ?)`,
    )
    .bind(
      tenant,
      id,
      JSON.stringify({ week, entryRefs: refs, poll: { options: ['No 1', 'No 2'] } }),
    )
    .run();
  await db
    .prepare(
      `INSERT INTO channel_deliveries VALUES (?, ?, 'telegram', 'done', '{"main":10,"poll":11}')`,
    )
    .bind(tenant, id)
    .run();
  const close = vi.fn(async () => ({ optionVotes: [1, 2], totalVotes: 3 }));
  const adapter = {
    key: 'telegram',
    capabilities: { polls: true },
    closePoll: close,
  } as unknown as ChannelAdapter;
  const context = {} as DeliverContext;
  const run = (now = 0) => closeContestPoll(db, tenant, week, adapter, context, now);
  return { db, refs, id, close, run, store: createPollClosingStore(db) };
}

it('resolves delivery poll ID and original order and saves counts exactly once', async () => {
  const fx = await fixture();
  expect(await findClosingPoll(fx.db, tenant, week, 'telegram')).toMatchObject({
    pollId: 11,
    entryRefs: fx.refs,
  });
  await Promise.all([fx.run(), fx.run()]);
  await fx.run(900_000);
  expect(fx.close).toHaveBeenCalledTimes(1);
  expect((await fx.store.get(tenant, week))?.tally).toEqual({
    status: 'counted',
    counts: [1, 2],
    total: 3,
  });
  expect(await fx.store.finish(tenant, week, 'wrong', { status: 'unreadable' })).toBe(false);
  expect(await fx.store.get('other', week)).toBeUndefined();
});

it.each(['ready', 'discarded'])('ignores %s openings', async (state) => {
  const fx = await fixture();
  await fx.db.prepare('UPDATE drafts SET status = ?').bind(state).run();
  await fx.run();
  expect(fx.close).not.toHaveBeenCalled();
  expect(await fx.store.get(tenant, week)).toBeUndefined();
});
it('ignores skipped, failed and legacy deliveries', async () => {
  const fx = await fixture();
  expect(await findClosingPoll(fx.db, tenant, '2026-10-26', 'telegram')).toBeUndefined();
  await fx.db.prepare("UPDATE channel_deliveries SET status = 'failed'").run();
  await fx.run();
  await fx.db.prepare("UPDATE channel_deliveries SET status = 'done', message_ids = '{}'").run();
  await fx.run();
  expect(fx.close).not.toHaveBeenCalled();
});
it('rejects cross-tenant candidates and preserves the published order', async () => {
  const fx = await fixture();
  await fx.db
    .prepare('UPDATE contest_entries SET tenant_id = ? WHERE entry_id = ?')
    .bind('other', fx.refs[0])
    .run();
  await expect(fx.run()).rejects.toThrow('tenant/week');
  expect(fx.close).not.toHaveBeenCalled();
});
it.each([
  [0, 0],
  [2, 2],
])('persists valid zero or tie counts %j', async (...counts) => {
  const fx = await fixture();
  fx.close.mockResolvedValue({
    optionVotes: counts,
    totalVotes: counts.reduce((a, b) => a + b, 0),
  });
  await fx.run();
  expect((await fx.store.get(tenant, week))?.tally).toMatchObject({ status: 'counted', counts });
});
it.each(['failure', 'invalid'])('records %s as unreadable, never as zero', async (mode) => {
  const fx = await fixture();
  if (mode === 'failure') fx.close.mockRejectedValue(new Error('private diagnostics'));
  else fx.close.mockResolvedValue({ optionVotes: [1], totalVotes: 1 });
  await fx.run();
  expect((await fx.store.get(tenant, week))?.tally).toEqual({ status: 'unreadable' });
});
it.each([false, true])(
  'recovers interruption with remote stop=%s without a second stop',
  async (stopped) => {
    const fx = await fixture();
    const poll = (await findClosingPoll(fx.db, tenant, week, 'telegram'))!;
    const claim = (await fx.store.claim(poll, 0))!;
    if (stopped) await fx.close();
    await fx.run(299_999);
    expect((await fx.store.get(tenant, week))?.tally).toBeUndefined();
    await fx.run(300_000);
    expect((await fx.store.get(tenant, week))?.tally).toEqual({ status: 'unreadable' });
    expect(
      await fx.store.finish(tenant, week, claim, { status: 'counted', counts: [1, 2], total: 3 }),
    ).toBe(false);
    expect(fx.close).toHaveBeenCalledTimes(stopped ? 1 : 0);
  },
);

it.each(['duplicate', 'option-count', 'wrong-week'])(
  'rejects %s candidate snapshots before stopping',
  async (mode) => {
    const fx = await fixture();
    const entryRefs = mode === 'duplicate' ? [fx.refs[0], fx.refs[0]] : [...fx.refs].reverse();
    if (mode === 'wrong-week') {
      await fx.db.prepare("UPDATE contest_entries SET week = '2026-10-26'").run();
    } else {
      await fx.db
        .prepare('UPDATE drafts SET extras = ?')
        .bind(
          JSON.stringify({
            week,
            entryRefs,
            poll: { options: mode === 'option-count' ? ['No 1'] : ['No 1', 'No 2'] },
          }),
        )
        .run();
    }
    await expect(fx.run()).rejects.toThrow();
    expect(fx.close).not.toHaveBeenCalled();
    expect(await fx.store.get(tenant, week)).toBeUndefined();
  },
);

it('preserves reversed ballot order and isolates simultaneous tenant/week claims', async () => {
  const fx = await fixture();
  const poll = (await findClosingPoll(fx.db, tenant, week, 'telegram'))!;
  await fx.db
    .prepare('UPDATE drafts SET extras = ?')
    .bind(
      JSON.stringify({
        week,
        entryRefs: [...fx.refs].reverse(),
        poll: { options: ['No 1', 'No 2'] },
      }),
    )
    .run();
  const reversed = (await findClosingPoll(fx.db, tenant, week, 'telegram'))!;
  expect(reversed.entryRefs).toEqual([...fx.refs].reverse());
  const claims = await Promise.all([fx.store.claim(reversed, 0), fx.store.claim(poll, 0)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect((await fx.store.get(tenant, week))?.poll.entryRefs).toEqual(reversed.entryRefs);
  expect(await fx.store.claim({ ...poll, tenantId: 'other' }, 0)).toBeDefined();
  expect(await fx.store.claim({ ...poll, week: '2026-10-26' }, 0)).toBeDefined();
  await expect(
    fx.store.finish(tenant, week, claims[0]!, { status: 'counted', counts: [-1, 2], total: 1 }),
  ).rejects.toThrow();
  expect((await fx.store.get(tenant, week))?.tally).toBeUndefined();
});
