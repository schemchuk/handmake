import { anonymousEditReceiptSchema } from '@handmake/core';
import { expect, it } from 'vitest';
import { createNameWithdrawalStore, queueNameReconciliations } from '../src/name-withdrawal-store';
import { createContestEntryStore } from '../src/contest-store';
import { makeD1 } from './helpers';

const a = '01JBCA1B2C3D4E5F6G7H8J9K0N';
const b = '01JBCA1B2C3D4E5F6G7H8J9K0P';
const now = new Date('2026-11-12T12:00:00Z');
async function fixture() {
  const db = await makeD1();
  for (const tenantId of ['fixture', 'other'])
    for (const entryId of [a, b]) {
      await createContestEntryStore(db).submit({
        tenantId,
        entryId,
        photoRef: 'photo',
        displayName: 'Private fixture',
        consent: true,
        consentAt: now,
        createdAt: now,
      });
    }
  return { db, store: createNameWithdrawalStore(db) };
}
async function receipt(db: D1Database, post = 'post', poll = false) {
  const value = anonymousEditReceiptSchema.parse({
    plan: {
      version: 1,
      type: 'wotw-poll',
      entryRefs: [a, b],
      allowNames: true,
      settings: { channelId: 'CHANNEL' },
      operations: [
        { kind: 'message', text: `{entry:${a}} {entry:${b}}`, lang: 'uk' },
        ...(poll ? [{ kind: 'poll', question: `{entry:${a}}`, options: ['1', '2'] }] : []),
      ],
    },
    remoteIds: poll ? [10, 11] : [10],
    publishedAt: now.toISOString(),
  });
  await db
    .prepare(`INSERT INTO anonymous_edit_receipts VALUES (?, ?, ?, ?, ?)`)
    .bind('fixture', post, 'telegram', JSON.stringify(value), now.toISOString())
    .run();
}

it('atomically clears only the name, queues all receipts, preserves winners and isolates tenants', async () => {
  const { db, store } = await fixture();
  await receipt(db);
  await receipt(db, 'result');
  await db
    .prepare("UPDATE contest_entries SET winner = 1 WHERE tenant_id = 'fixture' AND entry_id = ?")
    .bind(a)
    .run();
  const before = await db
    .prepare("SELECT * FROM contest_entries WHERE tenant_id = 'fixture' AND entry_id = ?")
    .bind(a)
    .first();
  const result = await store.withdraw('fixture', a, now);
  expect(result?.missingReceipt).toBe(false);
  expect(result?.publications).toHaveLength(2);
  expect(result?.publications[0]?.progress).toMatchObject({ generation: 1, state: 'pending' });
  expect(
    await db
      .prepare("SELECT * FROM contest_entries WHERE tenant_id = 'fixture' AND entry_id = ?")
      .bind(a)
      .first(),
  ).toEqual({ ...before, display_name: null });
  expect(
    await db
      .prepare(
        "SELECT display_name FROM contest_entries WHERE tenant_id = 'other' AND entry_id = ?",
      )
      .bind(a)
      .first(),
  ).toEqual({ display_name: 'Private fixture' });
  expect(await store.withdraw('missing', a)).toBeUndefined();
  expect(
    await db.prepare("SELECT count(*) n FROM name_withdrawals WHERE tenant_id = 'missing'").first(),
  ).toEqual({ n: 0 });
});

it('repeated and competing withdrawals advance generations once per distinct entry without restoring names', async () => {
  const { db, store } = await fixture();
  await receipt(db);
  await Promise.all([store.withdraw('fixture', a), store.withdraw('fixture', a)]);
  await db.prepare("UPDATE name_reconciliations SET next_operation = 1, state = 'running'").run();
  await store.withdraw('fixture', a);
  expect((await store.status('fixture', a))?.publications[0]?.progress).toMatchObject({
    generation: 1,
    next_operation: 1,
    state: 'running',
  });
  await Promise.all([store.withdraw('fixture', a), store.withdraw('fixture', b)]);
  expect((await store.status('fixture', b))?.publications[0]?.progress).toMatchObject({
    generation: 2,
    next_operation: 0,
    state: 'pending',
  });
  expect(
    (await db.prepare("SELECT display_name FROM contest_entries WHERE tenant_id = 'fixture'").all())
      .results,
  ).toEqual([{ display_name: null }, { display_name: null }]);
});

it('rolls back the private deletion and marker if queue insertion fails', async () => {
  const { db, store } = await fixture();
  await receipt(db);
  await db.exec(
    "CREATE TRIGGER reject_queue BEFORE INSERT ON name_reconciliations BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END;",
  );
  await expect(store.withdraw('fixture', a)).rejects.toThrow();
  expect(await store.status('fixture', a)).toBeUndefined();
  expect(
    await db
      .prepare(
        "SELECT display_name FROM contest_entries WHERE tenant_id = 'fixture' AND entry_id = ?",
      )
      .bind(a)
      .first(),
  ).toEqual({ display_name: 'Private fixture' });
});

it('reports absent legacy receipts, late delivery and name-bearing non-editable polls explicitly', async () => {
  const { db, store } = await fixture();
  expect((await store.withdraw('fixture', a))?.missingReceipt).toBe(true);
  await receipt(db, 'late', true);
  await db.batch([queueNameReconciliations(db, 'fixture')]);
  expect((await store.status('fixture', a))?.publications[0]).toMatchObject({
    uneditableNames: true,
    progress: { generation: 1 },
  });
  await db
    .prepare(
      "INSERT INTO poll_results (tenant_id, week, draft_id, entry_id, source) VALUES ('fixture', '2026-11-09', 'legacy', ?, 'author')",
    )
    .bind(a)
    .run();
  await db
    .prepare(
      "INSERT INTO channel_deliveries VALUES ('fixture', 'legacy', 'telegram', 'done', '{}')",
    )
    .run();
  expect((await store.status('fixture', a))?.missingReceipt).toBe(true);
});

it('rejects invalid identifiers before SQL', async () => {
  const { store } = await fixture();
  await expect(store.withdraw('bad tenant', a)).rejects.toThrow('Invalid name withdrawal');
  await expect(store.withdraw('fixture', 'bad')).rejects.toThrow('Invalid name withdrawal');
  await expect(store.withdraw('fixture', a, new Date('bad'))).rejects.toThrow(
    'Invalid name withdrawal',
  );
});

it.each(['instagram', 'facebook', 'threads'])(
  'does not require a receipt for anonymous %s delivery alongside a Telegram result',
  async (channel) => {
    const { db, store } = await fixture();
    await receipt(db, 'result');
    await db
      .prepare(
        `INSERT INTO poll_results (tenant_id, week, draft_id, entry_id, source)
      VALUES ('fixture', '2026-11-09', 'result', ?, 'author')`,
      )
      .bind(a)
      .run();
    for (const target of ['telegram', channel]) {
      await db
        .prepare(`INSERT INTO channel_deliveries VALUES ('fixture', 'result', ?, 'done', '{}')`)
        .bind(target)
        .run();
    }
    const result = await store.withdraw('fixture', a);
    expect(result?.missingReceipt).toBe(false);
    expect(result?.publications).toHaveLength(1);
    expect(result?.publications[0]).toMatchObject({
      channel: 'telegram',
      progress: { generation: 1 },
    });
    // The same result must still report a genuinely missing Telegram receipt.
    await db.prepare("DELETE FROM anonymous_edit_receipts WHERE tenant_id = 'fixture'").run();
    expect((await store.status('fixture', a))?.missingReceipt).toBe(true);
  },
);
