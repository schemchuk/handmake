import { expect, it, vi } from 'vitest';
import { newUlid } from '@handmake/core';
import { InstagramAdapter } from '@handmake/channels';
import type { ChannelAdapter, ChannelComment, DeliverContext } from '@handmake/core';
import { countCommentVotes, type ContestVoteSource } from '../src/contest-votes';
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
  return { db, refs, id, close, run, adapter, context, store: createPollClosingStore(db) };
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

function comment(id: string, handle: string, text: string, createdAt = ''): ChannelComment {
  return { id, handle, text, createdAt };
}

it('counts earliest valid votes deterministically, including repeated pages and case variants', () => {
  const votes = [
    comment('z', 'Alice', '2', '2026-11-02T12:00:00Z'),
    comment('b', 'ALICE', '1', '2026-11-02T11:00:00Z'),
    comment('a', 'alice', 'not a vote', '2026-11-02T10:00:00Z'),
    comment('c', 'Bob', ' 2 '),
    comment('c', 'Bob', ' 2 '),
  ];
  for (const input of [votes, [...votes].reverse()])
    expect(countCommentVotes(input, 2, 'instagram')).toEqual({
      status: 'counted',
      counts: [1, 1],
      total: 2,
    });
  expect(
    countCommentVotes([comment('z', 'a', '2'), comment('a', 'a', '1')], 2, 'threads'),
  ).toMatchObject({ counts: [1, 0] });
});

it('rejects invalid votes without consuming the account and accepts candidate ten', () => {
  const votes = ['0', '11', '01', '+1', '1.0', '1 2', '１', 'vote 1', '2\n1'].map((text, i) =>
    comment(String(i), 'same', text),
  );
  expect(countCommentVotes(votes, 2, 'threads')).toMatchObject({ counts: [0, 0] });
  expect(
    countCommentVotes([...votes, comment('valid', 'same', '10')], 10, 'threads'),
  ).toMatchObject({ counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1], total: 1 });
});

it('uses Facebook IDs rather than shared display names and fails closed without identity', () => {
  const votes = [
    { ...comment('a', 'same name', '1'), accountId: 'account-one' },
    { ...comment('b', 'same name', '2'), accountId: 'account-two' },
  ];
  expect(countCommentVotes(votes, 2, 'facebook')).toMatchObject({ counts: [1, 1] });
  expect(countCommentVotes([comment('c', 'same name', '1')], 2, 'facebook')).toEqual({
    status: 'unreadable',
  });
  expect(countCommentVotes([comment('a', '', '1')], 2, 'instagram')).toEqual({
    status: 'unreadable',
  });
  expect(countCommentVotes([votes[0]!, { ...votes[0]!, text: '2' }], 2, 'facebook')).toEqual({
    status: 'unreadable',
  });
});

async function metaSource(fx: Awaited<ReturnType<typeof fixture>>, key: string, status = 'done') {
  await fx.db
    .prepare('INSERT INTO channel_deliveries VALUES (?, ?, ?, ?, ?)')
    .bind(tenant, fx.id, key, status, JSON.stringify({ main: `${key}-post` }))
    .run();
  const listComments = vi.fn(async () => [comment('private-comment', 'private-account', '1')]);
  const source: ContestVoteSource = {
    adapter: { key, comments: { listComments } } as unknown as ChannelAdapter,
    context: {} as DeliverContext,
  };
  return { source, listComments };
}

it('combines independent networks once and persists anonymous aggregates only', async () => {
  const fx = await fixture();
  const ig = await metaSource(fx, 'instagram');
  const fb = await metaSource(fx, 'facebook');
  const th = await metaSource(fx, 'threads');
  fb.listComments.mockResolvedValue([
    { ...comment('private-comment', 'private-account', '2'), accountId: 'private-facebook-id' },
  ]);
  const run = () =>
    closeContestPoll(fx.db, tenant, week, fx.adapter, fx.context, 0, [
      ig.source,
      fb.source,
      th.source,
    ]);
  await Promise.all([run(), run()]);
  await run();
  const tally = (await fx.store.get(tenant, week))?.tally;
  expect(tally).toMatchObject({
    status: 'counted',
    counts: [3, 3],
    total: 6,
    sources: {
      instagram: { status: 'counted' },
      facebook: { counts: [0, 1] },
      threads: { status: 'counted' },
    },
  });
  for (const reader of [ig, fb, th]) {
    expect(reader.listComments).toHaveBeenCalledTimes(1);
    expect(reader.listComments).toHaveBeenCalledWith(
      `${reader.source.adapter.key}-post`,
      undefined,
      { ...reader.source.context, excludeOwnerComments: true },
    );
  }
  const stored = JSON.stringify(await fx.db.prepare('SELECT * FROM poll_closings').all());
  expect(stored).not.toMatch(/private-|accountId|handle|createdAt/);
});

it.each(['failed', 'missing', 'legacy', 'api', 'capability'])(
  'records %s source completeness without silently adding partial counts',
  async (mode) => {
    const fx = await fixture();
    const ig = await metaSource(fx, 'instagram', mode === 'failed' ? mode : 'done');
    if (mode === 'missing')
      await fx.db.prepare("DELETE FROM channel_deliveries WHERE channel = 'instagram'").run();
    if (mode === 'legacy')
      await fx.db
        .prepare("UPDATE channel_deliveries SET message_ids = '{}' WHERE channel = 'instagram'")
        .run();
    if (mode === 'api') ig.listComments.mockRejectedValue(new Error('private-partial-data'));
    if (mode === 'capability') ig.source.adapter = { key: 'instagram' } as ChannelAdapter;
    await closeContestPoll(fx.db, tenant, week, fx.adapter, fx.context, 0, [ig.source]);
    const skipped = ['failed', 'missing'].includes(mode);
    expect((await fx.store.get(tenant, week))?.tally).toMatchObject({
      status: skipped ? 'counted' : 'unreadable',
      sources: { instagram: { status: skipped ? 'skipped' : 'unreadable' } },
    });
    if (mode !== 'api') expect(ig.listComments).not.toHaveBeenCalled();
    expect(JSON.stringify(await fx.store.get(tenant, week))).not.toContain('private-');
  },
);

it('never reads Meta sources for an unpublished ballot or another tenant', async () => {
  const fx = await fixture();
  const ig = await metaSource(fx, 'instagram');
  await closeContestPoll(fx.db, 'other', week, fx.adapter, fx.context, 0, [ig.source]);
  await fx.db.prepare("UPDATE drafts SET status = 'ready'").run();
  await closeContestPoll(fx.db, tenant, week, fx.adapter, fx.context, 0, [ig.source]);
  expect(ig.listComments).not.toHaveBeenCalled();
});

it.each([1, 2])('requires complete real-reader pagination with page limit %s', async (maxPages) => {
  const fx = await fixture();
  const ig = await metaSource(fx, 'instagram');
  const fetchImpl = vi.fn(async (input: unknown) => {
    const next = String(input).includes('after=next');
    return new Response(
      JSON.stringify({
        data: [
          {
            id: next ? 'c2' : 'c1',
            username: next ? 'reader-b' : 'reader-a',
            text: next ? '2' : '1',
            timestamp: '2026-11-02T12:00:00Z',
          },
        ],
        ...(next
          ? {}
          : {
              paging: {
                next: 'https://graph.facebook.com/v21.0/instagram-post/comments?after=next',
              },
            }),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  ig.source.adapter = new InstagramAdapter({ fetchImpl, commentsMaxPages: maxPages });
  ig.source.context = { secrets: { resolve: async () => 'test-value' } };
  await closeContestPoll(fx.db, tenant, week, fx.adapter, fx.context, 0, [ig.source]);
  expect((await fx.store.get(tenant, week))?.tally).toMatchObject(
    maxPages === 1
      ? { status: 'unreadable', sources: { instagram: { status: 'unreadable' } } }
      : { status: 'counted', counts: [2, 3], sources: { instagram: { counts: [1, 1] } } },
  );
  expect(fetchImpl).toHaveBeenCalledTimes(maxPages);
});

it.each(['ready', 'discarded'])('ignores %s openings', async (state) => {
  const fx = await fixture();
  await fx.db.prepare('UPDATE drafts SET status = ?').bind(state).run();
  await fx.run();
  expect(fx.close).not.toHaveBeenCalled();
  expect(await fx.store.get(tenant, week)).toBeUndefined();
});
it('ignores a skipped opening receipt, failed and legacy deliveries', async () => {
  const fx = await fixture();
  expect(await findClosingPoll(fx.db, tenant, '2026-10-26', 'telegram')).toBeUndefined();
  const skippedWeek = '2026-10-26';
  await fx.db.prepare('INSERT INTO poll_openings VALUES (?, ?)').bind(tenant, skippedWeek).run();
  await closeContestPoll(fx.db, tenant, skippedWeek, fx.adapter, fx.context, 0);
  expect(await fx.store.get(tenant, skippedWeek)).toBeUndefined();
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

it('skips every Meta reader when Telegram cannot be read', async () => {
  const fx = await fixture();
  const ig = await metaSource(fx, 'instagram');
  fx.close.mockRejectedValue(new Error('transport'));
  await closeContestPoll(fx.db, tenant, week, fx.adapter, fx.context, 0, [ig.source]);
  expect(ig.listComments).not.toHaveBeenCalled();
  expect((await fx.store.get(tenant, week))?.tally).toEqual({ status: 'unreadable' });
});

it('bounds collection and ignores late counts and subsequent sources', async () => {
  const fx = await fixture();
  const ig = await metaSource(fx, 'instagram');
  const th = await metaSource(fx, 'threads');
  let complete!: (comments: ChannelComment[]) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  ig.listComments.mockImplementation(() => {
    started();
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const closing = closeContestPoll(fx.db, tenant, week, fx.adapter, fx.context, 0, [
      ig.source,
      th.source,
    ]);
    await reading;
    await vi.advanceTimersByTimeAsync(120_000);
    await closing;
    expect((await fx.store.get(tenant, week))?.tally).toEqual({ status: 'unreadable' });
    complete([comment('late', 'reader', '1')]);
    await vi.advanceTimersByTimeAsync(0);
    await fx.run(300_000);
    expect((await fx.store.get(tenant, week))?.tally).toEqual({ status: 'unreadable' });
    expect(th.listComments).not.toHaveBeenCalled();
    expect(fx.close).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('excludes Instagram owner votes only in contest collection', async () => {
  const fx = await fixture();
  const ig = await metaSource(fx, 'instagram');
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'owner', from: { id: 'test-owner' }, username: 'author', text: '1' },
            { id: 'reader', from: { id: 'reader-id' }, username: 'reader', text: '2' },
          ],
        }),
      ),
  ) as unknown as typeof fetch;
  const adapter = new InstagramAdapter({ fetchImpl });
  ig.source.adapter = adapter;
  ig.source.context = { secrets: { resolve: async () => 'test-owner' } };
  expect(await adapter.comments!.listComments('post', undefined, ig.source.context)).toHaveLength(
    2,
  );
  await closeContestPoll(fx.db, tenant, week, fx.adapter, fx.context, 0, [ig.source]);
  expect((await fx.store.get(tenant, week))?.tally).toMatchObject({
    status: 'counted',
    sources: { instagram: { counts: [0, 1], total: 1 } },
  });
});
