import { ChannelEditRejectedError, anonymousEditReceiptSchema } from '@handmake/core';
import type { SendOperation } from '@handmake/core';
import { expect, it, vi } from 'vitest';
import { createNameReconciler } from '../src/name-reconciliation';
import { createNameWithdrawalStore } from '../src/name-withdrawal-store';
import { createContestEntryStore } from '../src/contest-store';
import { makeD1 } from './helpers';

const a = '01JBCA1B2C3D4E5F6G7H8J9K0N';
const b = '01JBCA1B2C3D4E5F6G7H8J9K0P';
const target = { tenant_id: 'fixture', post_id: 'post', channel: 'telegram' };
const now = new Date('2026-11-12T12:00:00Z');
async function setup(poll = false) {
  const db = await makeD1();
  for (const tenantId of ['fixture', 'other']) {
    for (const [entryId, displayName] of [
      [a, 'First'],
      [b, 'Second'],
    ] as const)
      await createContestEntryStore(db).submit({
        tenantId,
        entryId,
        displayName,
        photoRef: 'photo',
        consent: true,
        consentAt: now,
        createdAt: now,
      });
  }
  const receipt = anonymousEditReceiptSchema.parse({
    plan: {
      version: 1,
      type: 'wotw-result',
      entryRefs: [a, b],
      allowNames: true,
      settings: { channelId: 'CHANNEL' },
      operations: [
        {
          kind: 'mediaGroup',
          photoIndexes: [0, 1],
          caption: `{entry:${a}} / {entry:${b}}`,
          captionLang: 'uk',
        },
        { kind: 'message', text: `{entry:${a}} / {entry:${b}}`, lang: 'de' },
        ...(poll ? [{ kind: 'poll', question: `{entry:${a}}`, options: ['1', '2'] }] : []),
      ],
    },
    remoteIds: poll ? [10, 11, 12] : [10, 11],
    publishedAt: now.toISOString(),
  });
  await db
    .prepare('INSERT INTO anonymous_edit_receipts VALUES (?, ?, ?, ?, ?)')
    .bind('fixture', 'post', 'telegram', JSON.stringify(receipt), now.toISOString())
    .run();
  const withdrawals = createNameWithdrawalStore(db);
  await withdrawals.withdraw('fixture', a);
  const edit = vi.fn(async (_id: string | number, _op: SendOperation) => {});
  const rebuild = vi.fn(async () => {});
  const runner = createNameReconciler({
    db,
    adapter: { key: 'telegram', editMessage: edit },
    secrets: { resolve: async () => 'destination' },
    rebuild,
  });
  const state = () => db.prepare('SELECT * FROM name_reconciliations').first();
  return { db, withdrawals, edit, rebuild, runner, state };
}

it('edits every durable caption/message after draft cleanup and preserves other names and tenants', async () => {
  const f = await setup();
  await f.db.prepare('DELETE FROM drafts').run();
  await f.runner.tick();
  expect(f.edit.mock.calls.map(([id, op]) => [id, op])).toEqual([
    [10, expect.objectContaining({ caption: 'Робота № 1 / Second' })],
    [11, expect.objectContaining({ text: 'Werk Nr. 1 / Second' })],
  ]);
  expect(await f.state()).toMatchObject({
    state: 'done',
    next_operation: 2,
    completed_generation: 1,
  });
  expect(f.rebuild).toHaveBeenCalledWith('fixture', 'post');
  await f.runner.tick();
  expect(f.edit).toHaveBeenCalledTimes(2);
  expect(
    await f.db
      .prepare(
        "SELECT display_name FROM contest_entries WHERE tenant_id = 'other' AND entry_id = ?",
      )
      .bind(a)
      .first(),
  ).toEqual({ display_name: 'First' });
});

it('resumes a partial explicit rejection without replaying accepted operations', async () => {
  const f = await setup();
  f.edit.mockResolvedValueOnce().mockRejectedValueOnce(new ChannelEditRejectedError());
  await f.runner.tick();
  expect(await f.state()).toMatchObject({ state: 'failed', next_operation: 1, lock_token: null });
  await f.runner.tick();
  expect(f.edit.mock.calls.map(([id]) => id)).toEqual([10, 11, 11]);
  expect(await f.state()).toMatchObject({ state: 'done' });
});

it('serializes competing workers and rerenders all messages after a concurrent withdrawal', async () => {
  const f = await setup();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const wait = new Promise<void>((r) => {
    release = r;
  });
  f.edit.mockImplementationOnce(async () => {
    entered();
    await wait;
  });
  const first = f.runner.tick();
  await started;
  await f.withdrawals.withdraw('fixture', b);
  await f.runner.tick();
  expect(f.edit).toHaveBeenCalledTimes(1);
  release();
  await first;
  expect(f.edit.mock.calls.slice(1).map(([, op]) => op)).toEqual([
    expect.objectContaining({ caption: 'Робота № 1 / Робота № 2' }),
    expect.objectContaining({ text: 'Werk Nr. 1 / Werk Nr. 2' }),
  ]);
  expect(await f.state()).toMatchObject({ state: 'done', generation: 2, completed_generation: 2 });
});

it('quarantines unknown remote outcomes until explicit quiescence, then reconciles from zero', async () => {
  const f = await setup();
  f.edit.mockRejectedValueOnce(new Error('private transport details'));
  await f.runner.tick();
  const state = await f.state();
  expect(state).toMatchObject({ state: 'blocked', error_code: 'remote_unknown' });
  await f.withdrawals.withdraw('fixture', b);
  await f.runner.tick();
  expect(f.edit).toHaveBeenCalledTimes(1);
  expect(await f.runner.recoverQuiescent(target, 'wrong', 'remote-writer-stopped')).toBe(false);
  expect(
    await f.runner.recoverQuiescent(
      { ...target, tenant_id: 'other' },
      String(state?.lock_token),
      'remote-writer-stopped',
    ),
  ).toBe(false);
  expect(
    await f.runner.recoverQuiescent(target, String(state?.lock_token), 'remote-writer-stopped'),
  ).toBe(true);
  await f.runner.tick();
  expect(await f.state()).toMatchObject({ state: 'done', completed_generation: 2 });
  expect(f.edit.mock.calls[1]?.[1]).toMatchObject({ caption: 'Робота № 1 / Робота № 2' });
});

it('never steals an interrupted running lock on subsequent cron ticks', async () => {
  const f = await setup();
  await f.db
    .prepare(
      "UPDATE name_reconciliations SET state = 'running', lock_token = 'interrupted', error_code = 'remote_inflight'",
    )
    .run();
  await f.runner.tick();
  expect(f.edit).not.toHaveBeenCalled();
  expect(await f.state()).toMatchObject({ state: 'running', lock_token: 'interrupted' });
  await f.runner.recoverQuiescent(target, 'interrupted', 'remote-writer-stopped');
  await f.runner.tick();
  expect(await f.state()).toMatchObject({ state: 'done' });
});

it('retains uneditable named polls as blocked after editing every supported operation', async () => {
  const f = await setup(true);
  await f.runner.tick();
  expect(f.edit.mock.calls.map(([id]) => id)).toEqual([10, 11]);
  expect(await f.state()).toMatchObject({
    state: 'blocked',
    error_code: 'uneditable_names',
    completed_generation: 0,
  });
});

it('isolates hook failure and retries it without replaying edits', async () => {
  const f = await setup();
  f.rebuild.mockRejectedValueOnce(new Error('private hook details'));
  await f.runner.tick();
  expect(await f.state()).toMatchObject({
    state: 'failed',
    next_operation: 2,
    error_code: 'retry_required',
  });
  await f.runner.tick();
  expect(f.edit).toHaveBeenCalledTimes(2);
  expect(f.rebuild).toHaveBeenCalledTimes(2);
  expect(await f.state()).toMatchObject({ state: 'done' });
});

it('rerenders a new generation if withdrawal races the rebuild hook', async () => {
  const f = await setup();
  f.rebuild.mockImplementationOnce(async () => {
    await f.withdrawals.withdraw('fixture', b);
  });
  await f.runner.tick();
  expect(f.edit).toHaveBeenCalledTimes(4);
  expect(await f.state()).toMatchObject({ state: 'done', completed_generation: 2 });
});

it('continues other publications after one fails and resumes its recorded prefix later', async () => {
  const f = await setup();
  await f.db
    .prepare(
      `INSERT INTO anonymous_edit_receipts
    SELECT tenant_id, 'result', channel, receipt, published_at FROM anonymous_edit_receipts`,
    )
    .run();
  await f.withdrawals.withdraw('fixture', a);
  f.edit.mockResolvedValueOnce().mockRejectedValueOnce(new ChannelEditRejectedError());
  await f.runner.tick();
  expect(
    await f.db
      .prepare('SELECT post_id, state, next_operation FROM name_reconciliations ORDER BY post_id')
      .all(),
  ).toMatchObject({
    results: [
      { post_id: 'post', state: 'failed', next_operation: 1 },
      { post_id: 'result', state: 'done', next_operation: 2 },
    ],
  });
  await f.runner.tick();
  expect(f.edit).toHaveBeenCalledTimes(5);
});

it('fences an old recovery token after a new owner has claimed the publication', async () => {
  const f = await setup();
  await f.db.prepare("UPDATE name_reconciliations SET state = 'running', lock_token = 'old'").run();
  await f.runner.recoverQuiescent(target, 'old', 'remote-writer-stopped');
  f.edit.mockImplementationOnce(async () => {
    expect(await f.runner.recoverQuiescent(target, 'old', 'remote-writer-stopped')).toBe(false);
  });
  await f.runner.tick();
  expect(await f.state()).toMatchObject({ state: 'done' });
});
