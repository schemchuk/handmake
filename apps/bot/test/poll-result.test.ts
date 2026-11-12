import { expect, it } from 'vitest';
import { newUlid } from '@handmake/core';
import type { ContestTally } from '@handmake/core';
import { contestResultDecision, createPollResultStore } from '../src/poll-result';
import { createPollClosingStore } from '../src/poll-closing-store';
import { createD1DraftStore } from '../src/draft-store';
import { makeD1 } from './helpers';

const tenant = 'faden-und-stimmung';
const week = '2026-11-02';
const now = new Date('2026-11-12T12:00:00Z');
const refs = [newUlid(), newUlid(), newUlid()];
const counted = (counts: number[]): ContestTally => ({
  status: 'counted',
  counts,
  total: counts.reduce((a, b) => a + b, 0),
});

it.each([
  [counted([1, 3, 0]), [refs[1]], refs[1], 'readers'],
  [counted([2, 2, 1]), refs.slice(0, 2), undefined, 'author'],
  [counted([0, 0, 0]), refs, undefined, 'author'],
  [{ status: 'unreadable' }, refs, undefined, 'author'],
  [
    {
      ...counted([1, 3, 0]),
      sources: { telegram: counted([1, 3, 0]), instagram: { status: 'skipped' } },
    },
    [refs[1]],
    refs[1],
    'readers',
  ],
  [
    {
      ...counted([1, 3, 0]),
      sources: { telegram: counted([1, 3, 0]), instagram: counted([0, 0, 0]) },
    },
    refs,
    undefined,
    'author',
  ],
  [
    {
      ...counted([0, 0, 0]),
      sources: { telegram: counted([0, 0, 0]), threads: counted([0, 0, 0]) },
    },
    refs,
    undefined,
    'author',
  ],
])('derives the decision from the stored tally (%j)', (tally, allowed, automatic, source) => {
  expect(contestResultDecision(tally as ContestTally, refs)).toEqual({
    tally,
    allowed,
    automatic,
    source,
  });
});

async function fixture(
  tally: ContestTally = counted([1, 3, 0]),
  db?: D1Database,
  scope = tenant,
  closingWeek = week,
  entryRefs = refs,
) {
  db ??= await makeD1();
  for (const [i, ref] of entryRefs.entries())
    await db
      .prepare(
        `INSERT INTO contest_entries
    (tenant_id, entry_id, week, file_id, display_name, consent_at, created_at)
    VALUES (?, ?, ?, ?, 'Private name', 'now', 'now')`,
      )
      .bind(scope, ref, closingWeek, `photo-${i}`)
      .run();
  const closings = createPollClosingStore(db);
  const claim = (await closings.claim(
    {
      tenantId: scope,
      week: closingWeek,
      entryRefs,
      postId: newUlid(),
      channel: 'telegram',
      pollId: 42,
    },
    0,
  ))!;
  await closings.finish(scope, closingWeek, claim, tally);
  const store = createPollResultStore(db);
  const input = { tenant: scope, week: closingWeek, claim, chatId: '111', now };
  return { db, store, input };
}

it('creates one ready placeholder-only draft and winner from the immutable snapshot', async () => {
  const fx = await fixture();
  const result = await fx.store.create(fx.input);
  expect(result.created).toBe(true);
  expect(result.result).toMatchObject({ entryId: refs[1], source: 'readers' });
  const draft = (await createD1DraftStore(fx.db).get(tenant, result.result!.draftId))!.draft;
  expect(draft).toMatchObject({
    state: 'ready',
    type: 'wotw-result',
    photoRefs: ['photo-1'],
    extras: { entryRefs: [refs[1]], winnerEntryId: refs[1], resultSource: 'readers' },
  });
  expect(draft.texts['uk']).toContain(`{entry:${refs[1]}}`);
  expect(draft.texts['de']).toContain(`{entry:${refs[1]}}`);
  expect(JSON.stringify(draft)).not.toContain('Private name');
  expect(
    await fx.db.prepare('SELECT entry_id FROM contest_entries WHERE winner = 1').all(),
  ).toMatchObject({ results: [{ entry_id: refs[1] }] });
  expect(await fx.store.create({ ...fx.input, now: new Date('2026-11-13') })).toEqual({
    created: false,
    result: result.result,
  });
  // A durable receipt also prevents recreation after normal draft retention cleanup.
  await fx.db.prepare('DELETE FROM drafts').run();
  expect((await fx.store.create(fx.input)).created).toBe(false);
  expect((await fx.db.prepare('SELECT * FROM drafts').all()).results).toHaveLength(0);
});

it('restricts ties and stale claims and isolates tenant/week candidates', async () => {
  const fx = await fixture(counted([2, 2, 1]));
  for (const input of [
    fx.input,
    { ...fx.input, entryId: refs[2] },
    { ...fx.input, claim: 'stale', entryId: refs[0] },
    { ...fx.input, tenant: 'other', entryId: refs[0] },
    { ...fx.input, week: '2026-11-09', entryId: refs[0] },
  ])
    expect(await fx.store.create(input)).toEqual({ created: false });
  expect(await fx.store.decision(tenant, week)).toMatchObject({ allowed: refs.slice(0, 2) });
  expect(await fx.store.decision('other', week)).toBeUndefined();
  const result = await fx.store.create({ ...fx.input, entryId: refs[0] });
  expect(result.result?.source).toBe('author');
  const draft = (await createD1DraftStore(fx.db).get(tenant, result.result!.draftId))!.draft;
  expect(draft.texts['uk']).toContain('авторки');
  expect(draft.texts['de']).toContain('Autorin');
});

it('serializes competing choices and returns the same durable receipt on retries', async () => {
  const fx = await fixture({ status: 'unreadable' });
  const results = await Promise.all(
    refs.map((entryId) => fx.store.create({ ...fx.input, entryId })),
  );
  expect(results.filter((r) => r.created)).toHaveLength(1);
  const receipt = results.find((r) => r.created)!.result;
  expect(results.every((r) => JSON.stringify(r.result) === JSON.stringify(receipt))).toBe(true);
  expect((await fx.db.prepare('SELECT * FROM drafts').all()).results).toHaveLength(1);
  expect(
    (await fx.db.prepare('SELECT * FROM contest_entries WHERE winner = 1').all()).results,
  ).toHaveLength(1);
  expect(await fx.store.create({ ...fx.input, entryId: refs[2] })).toEqual({
    created: false,
    result: receipt,
  });
});

it('isolates result IDs across tenants and weeks', async () => {
  const a = await fixture();
  const b = await fixture(counted([3, 0, 0]), a.db, 'other');
  const c = await fixture(
    counted([0, 0, 3]),
    a.db,
    tenant,
    '2026-11-09',
    refs.map(() => newUlid()),
  );
  const results = await Promise.all([a, b, c].map((fx) => fx.store.create(fx.input)));
  expect(results.every((r) => r.created)).toBe(true);
  expect(new Set(results.map((r) => r.result!.draftId)).size).toBe(3);
});

it.each(['drafts', 'contest_entries', 'poll_results'])(
  'rolls back the entire result when %s fails',
  async (table) => {
    const fx = await fixture();
    const operation = table === 'contest_entries' ? 'UPDATE' : 'INSERT';
    await fx.db
      .prepare(
        `CREATE TRIGGER reject_result BEFORE ${operation} ON ${table}
    BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
      )
      .run();
    await expect(fx.store.create(fx.input)).rejects.toThrow();
    expect(await fx.store.get(tenant, week)).toBeUndefined();
    expect((await fx.db.prepare('SELECT * FROM drafts').all()).results).toHaveLength(0);
    expect(
      (await fx.db.prepare('SELECT * FROM contest_entries WHERE winner = 1').all()).results,
    ).toHaveLength(0);
    await fx.db.prepare('DROP TRIGGER reject_result').run();
    expect((await fx.store.create(fx.input)).created).toBe(true);
  },
);

it('requires an explicit author choice for combined totals, including a nonleader', async () => {
  const tally: ContestTally = {
    ...counted([1, 3, 0]),
    sources: {
      telegram: counted([1, 3, 0]),
      instagram: counted([0, 0, 0]),
    },
  };
  const fx = await fixture(tally);
  expect(await fx.store.decision(tenant, week)).toEqual({ allowed: refs, source: 'author', tally });
  expect(await fx.store.create(fx.input)).toEqual({ created: false });
  expect((await fx.store.create({ ...fx.input, entryId: refs[2] })).result).toMatchObject({
    entryId: refs[2],
    source: 'author',
  });
});

it('waits for a completed tally and refuses an absent candidate', async () => {
  const fx = await fixture();
  await fx.db.prepare('UPDATE poll_closings SET tally = NULL').run();
  expect(await fx.store.decision(tenant, week)).toBeUndefined();
  expect(await fx.store.create(fx.input)).toEqual({ created: false });
  await createPollClosingStore(fx.db).finish(tenant, week, fx.input.claim, counted([1, 3, 0]));
  await fx.db.prepare('DELETE FROM contest_entries WHERE entry_id = ?').bind(refs[1]).run();
  expect(await fx.store.create(fx.input)).toEqual({ created: false });
  expect((await fx.db.prepare('SELECT * FROM drafts').all()).results).toHaveLength(0);
});

it('refuses to replace an unrelated deterministic draft collision', async () => {
  const fx = await fixture();
  const first = await fx.store.create(fx.input);
  await fx.db.prepare('DELETE FROM poll_results').run();
  await fx.db.prepare('UPDATE contest_entries SET winner = 0').run();
  await fx.db.prepare('UPDATE drafts SET texts = \'{"uk":"unrelated"}\'').run();
  await expect(fx.store.create(fx.input)).rejects.toThrow();
  expect(await fx.store.get(tenant, week)).toBeUndefined();
  expect((await createD1DraftStore(fx.db).get(tenant, first.result!.draftId))?.draft.texts).toEqual(
    { uk: 'unrelated' },
  );
  expect(
    (await fx.db.prepare('SELECT * FROM contest_entries WHERE winner = 1').all()).results,
  ).toHaveLength(0);
});
