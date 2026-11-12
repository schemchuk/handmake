import { expect, it } from 'vitest';
import { expireNonWinnerNames } from '../src/name-retention';
import { createContestEntryStore } from '../src/contest-store';
import { createNameWithdrawalStore } from '../src/name-withdrawal-store';
import { makeD1 } from './helpers';

const a = '01JBCA1B2C3D4E5F6G7H8J9K0N';
const b = '01JBCA1B2C3D4E5F6G7H8J9K0P';
const createdAt = new Date('2026-08-10T12:00:00Z');
const publication = new Date('2026-08-11T12:00:00Z');
const cutoff = new Date(publication.getTime() + 90 * 86400000);
async function fixture() {
  const db = await makeD1();
  for (const tenantId of ['fixture', 'other']) {
    for (const entryId of [a, b])
      await createContestEntryStore(db).submit({
        tenantId,
        entryId,
        photoRef: 'photo',
        displayName: 'Fixture',
        consent: true,
        consentAt: createdAt,
        createdAt,
      });
    await db
      .prepare('UPDATE contest_entries SET winner = 1 WHERE tenant_id = ? AND entry_id = ?')
      .bind(tenantId, a)
      .run();
    await db
      .prepare(
        `INSERT INTO poll_results (tenant_id, week, draft_id, entry_id, source, published_at)
      VALUES (?, '2026-08-10', 'result', ?, 'author', ?)`,
      )
      .bind(tenantId, a, publication.toISOString())
      .run();
    const receipt = {
      plan: {
        version: 1,
        type: 'wotw-result',
        entryRefs: [a, b],
        allowNames: true,
        settings: { channelId: tenantId },
        operations: [{ kind: 'message', text: `{entry:${a}} {entry:${b}}`, lang: 'de' }],
      },
      remoteIds: [1],
      publishedAt: publication.toISOString(),
    };
    await db
      .prepare('INSERT INTO anonymous_edit_receipts VALUES (?, ?, ?, ?, ?)')
      .bind(tenantId, 'result', 'telegram', JSON.stringify(receipt), publication.toISOString())
      .run();
  }
  return db;
}
const rows = async (db: D1Database) =>
  (await db.prepare('SELECT * FROM contest_entries ORDER BY tenant_id, entry_id').all()).results;

it('expires at exactly 90 elapsed UTC days across DST, preserving winners and all other fields', async () => {
  const db = await fixture();
  const before = await rows(db);
  await expireNonWinnerNames(db, new Date(cutoff.getTime() - 1));
  expect(await rows(db)).toEqual(before);
  await Promise.all([expireNonWinnerNames(db, cutoff), expireNonWinnerNames(db, cutoff)]);
  expect(await rows(db)).toEqual(
    before.map((row) => ({ ...row, display_name: row.winner ? 'Fixture' : null })),
  );
  expect(
    (await db.prepare('SELECT generation, state FROM name_reconciliations').all()).results,
  ).toEqual([
    { generation: 1, state: 'pending' },
    { generation: 1, state: 'pending' },
  ]);
  await db
    .prepare("UPDATE name_reconciliations SET state = 'failed', error_code = 'edit_rejected'")
    .run();
  await expireNonWinnerNames(db, new Date(cutoff.getTime() + 86400000));
  expect(
    (await db.prepare('SELECT generation, state FROM name_reconciliations').all()).results,
  ).toEqual([
    { generation: 1, state: 'failed' },
    { generation: 1, state: 'failed' },
  ]);
  await createNameWithdrawalStore(db).withdraw('fixture', a, cutoff);
  await expireNonWinnerNames(db, cutoff);
  expect(
    (await rows(db)).find((row) => row.tenant_id === 'fixture' && row.entry_id === a)?.display_name,
  ).toBeNull();
});

it('leaves unpublished and later results alone regardless of selection/draft dates', async () => {
  const db = await fixture();
  await db.prepare("UPDATE poll_results SET published_at = NULL WHERE tenant_id = 'fixture'").run();
  await db
    .prepare("UPDATE poll_results SET published_at = ? WHERE tenant_id = 'other'")
    .bind(new Date(publication.getTime() + 1).toISOString())
    .run();
  const before = await rows(db);
  await expireNonWinnerNames(db, cutoff);
  expect(await rows(db)).toEqual(before);
  expect((await db.prepare('SELECT * FROM name_withdrawals').all()).results).toEqual([]);
});

it('rolls back erasure if queueing fails', async () => {
  const db = await fixture();
  const before = await rows(db);
  await db.exec(
    "CREATE TRIGGER reject_queue BEFORE INSERT ON name_reconciliations BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
  );
  await expect(expireNonWinnerNames(db, cutoff)).rejects.toThrow();
  expect(await rows(db)).toEqual(before);
  expect((await db.prepare('SELECT * FROM name_withdrawals').all()).results).toEqual([]);
});

it.each(['2026-01-01T00:00:00Z', '2026-03-28T23:59:59Z'])(
  'uses elapsed UTC time at midnight and across spring DST from %s',
  async (published) => {
    const db = await fixture();
    await db.prepare('UPDATE poll_results SET published_at = ?').bind(published).run();
    const end = new Date(new Date(published).getTime() + 90 * 86400000);
    await expireNonWinnerNames(db, new Date(end.getTime() - 1));
    expect((await rows(db)).every((row) => row.display_name === 'Fixture')).toBe(true);
    await expireNonWinnerNames(db, end);
    expect((await rows(db)).filter((row) => row.display_name === null)).toHaveLength(2);
  },
);

it('retains anonymous records and reconciles other tenants despite a rejected public edit', async () => {
  const db = await fixture();
  await db
    .prepare(
      "UPDATE contest_entries SET display_name = NULL WHERE tenant_id = 'fixture' AND entry_id = ?",
    )
    .bind(a)
    .run();
  const before = await rows(db);
  await expireNonWinnerNames(db, cutoff);
  const { createNameReconciler } = await import('../src/name-reconciliation');
  const { ChannelEditRejectedError } = await import('@handmake/core');
  const edits: string[] = [];
  let rejected = true;
  const runner = createNameReconciler({
    db,
    adapter: {
      key: 'telegram',
      editMessage: async (_id, op, ctx) => {
        if ((ctx.settings as { channelId: string }).channelId === 'fixture' && rejected)
          throw new ChannelEditRejectedError();
        if (op.kind === 'message') edits.push(op.text);
      },
    },
    secrets: { resolve: async () => '' },
  });
  await runner.tick();
  expect(
    (await db.prepare('SELECT state FROM name_reconciliations ORDER BY tenant_id').all()).results,
  ).toEqual([{ state: 'failed' }, { state: 'done' }]);
  await expireNonWinnerNames(db, new Date(cutoff.getTime() + 1));
  rejected = false;
  await runner.tick();
  expect((await db.prepare('SELECT state FROM name_reconciliations').all()).results).toEqual([
    { state: 'done' },
    { state: 'done' },
  ]);
  expect(edits).toHaveLength(2);
  expect((await rows(db))[0]).toEqual(before[0]);
});
