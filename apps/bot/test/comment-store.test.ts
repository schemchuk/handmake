import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { commentRetentionDays, createCommentStore } from '../src/comment-store';
import type { NewComment } from '../src/comment-store';
import { makeD1 } from './helpers';

const TENANT = 'faden-und-stimmung';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const LATER = new Date('2026-11-09T12:05:00.000Z');

function newComment(patch: Partial<NewComment> = {}): NewComment {
  return {
    tenantId: TENANT,
    network: 'instagram',
    id: 'comment-1',
    postId: 'media-1',
    handle: 'anna_reader',
    text: 'Wunderschöne Stickerei!',
    commentCreatedAt: '2026-11-09T11:00:00.000Z',
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

async function rowOf(db: D1Database, network: string, id: string) {
  return db
    .prepare('SELECT * FROM comments WHERE tenant_id = ? AND network = ? AND id = ?')
    .bind(TENANT, network, id)
    .first<Record<string, string | null>>();
}

describe('createCommentStore', () => {
  it('collects a new comment once and dedupes repeats by id', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);

    expect(await store.collect(newComment())).toBe(true);
    expect(await store.collect(newComment())).toBe(false);

    const row = await rowOf(db, 'instagram', 'comment-1');
    expect(row?.['status']).toBe('new');
    expect(row?.['handle']).toBe('anna_reader');
    expect(row?.['text']).toBe('Wunderschöne Stickerei!');
    expect(row?.['post_id']).toBe('media-1');
    expect(row?.['comment_created_at']).toBe('2026-11-09T11:00:00.000Z');
  });

  it('isolates the same comment id per tenant and network', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);

    expect(await store.collect(newComment())).toBe(true);
    expect(await store.collect(newComment({ tenantId: 'other-tenant' }))).toBe(true);
    expect(await store.collect(newComment({ network: 'facebook' }))).toBe(true);
  });

  it('claims drafting atomically: the second claimant loses', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment());

    expect(await store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW)).toBe(true);
    expect(await store.claimDrafting(TENANT, 'instagram', 'comment-1', LATER)).toBe(false);
    expect((await rowOf(db, 'instagram', 'comment-1'))?.['status']).toBe('drafting');
  });

  it('reopens a drafting row so a failed draft retries on the next tick', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment());
    await store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW);

    expect(await store.reopenDrafting(TENANT, 'instagram', 'comment-1', LATER)).toBe(true);
    expect((await rowOf(db, 'instagram', 'comment-1'))?.['status']).toBe('new');
    // A drafted row must never go back to new.
    await store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW);
    await store.storeDraft(
      TENANT,
      'instagram',
      'comment-1',
      { translationUk: 'Чудова вишивка!', replyDe: 'Danke!', notesUk: '' },
      LATER,
    );
    expect(await store.reopenDrafting(TENANT, 'instagram', 'comment-1', LATER)).toBe(false);
  });

  it('stores the draft only from the drafting state', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment());

    const draft = { translationUk: 'Чудова вишивка!', replyDe: 'Danke!', notesUk: '' };
    expect(await store.storeDraft(TENANT, 'instagram', 'comment-1', draft, NOW)).toBe(false);

    await store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW);
    expect(await store.storeDraft(TENANT, 'instagram', 'comment-1', draft, LATER)).toBe(true);

    const row = await rowOf(db, 'instagram', 'comment-1');
    expect(row?.['status']).toBe('drafted');
    expect(row?.['translation_uk']).toBe('Чудова вишивка!');
    expect(row?.['reply_de']).toBe('Danke!');
  });

  it('notifies a drafted row at most once', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment());
    await store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW);
    await store.storeDraft(
      TENANT,
      'instagram',
      'comment-1',
      { translationUk: 'Чудова вишивка!', replyDe: 'Danke!', notesUk: '' },
      LATER,
    );

    expect(await store.listPendingNotify(TENANT)).toHaveLength(1);
    expect(await store.markNotified(TENANT, 'instagram', 'comment-1', LATER)).toBe(true);
    expect(await store.markNotified(TENANT, 'instagram', 'comment-1', LATER)).toBe(false);
    expect(await store.listPendingNotify(TENANT)).toHaveLength(0);
    expect((await rowOf(db, 'instagram', 'comment-1'))?.['notified_at']).toBe(LATER.toISOString());
  });

  it('lists only unnotified drafted rows, in collection order', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    for (const [id, at] of [
      ['comment-1', NOW],
      ['comment-2', LATER],
    ] as const) {
      await store.collect(newComment({ id, createdAt: at, updatedAt: at }));
      await store.claimDrafting(TENANT, 'instagram', id, at);
      await store.storeDraft(
        TENANT,
        'instagram',
        id,
        { translationUk: 'T', replyDe: 'D', notesUk: '' },
        at,
      );
    }
    await store.markNotified(TENANT, 'instagram', 'comment-1', LATER);

    const pending = await store.listPendingNotify(TENANT);
    expect(pending.map((row) => row.id)).toEqual(['comment-2']);
    expect(pending[0]!.status).toBe('drafted');
  });

  it('the status CHECK constraint rejects values outside the lifecycle', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment());

    await expect(
      db
        .prepare("UPDATE comments SET status = 'weird' WHERE tenant_id = ? AND id = 'comment-1'")
        .bind(TENANT)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it('round-trips the per-network watermark', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);

    expect(await store.getWatermark(TENANT, 'instagram')).toBeUndefined();
    const watermark = new Date('2026-11-09T11:30:00.000Z');
    await store.setWatermark(TENANT, 'instagram', watermark, NOW);
    expect((await store.getWatermark(TENANT, 'instagram'))?.toISOString()).toBe(
      watermark.toISOString(),
    );
    // Watermarks of other tenants and networks stay untouched.
    expect(await store.getWatermark(TENANT, 'facebook')).toBeUndefined();
    expect(await store.getWatermark('other-tenant', 'instagram')).toBeUndefined();
    const later = new Date('2026-11-09T12:00:00.000Z');
    await store.setWatermark(TENANT, 'instagram', later, LATER);
    expect((await store.getWatermark(TENANT, 'instagram'))?.toISOString()).toBe(
      later.toISOString(),
    );
  });

  it('deletes rows older than the cutoff by creation time and returns the count', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment({ id: 'old', createdAt: NOW, updatedAt: NOW }));
    await store.collect(newComment({ id: 'fresh', createdAt: LATER, updatedAt: LATER }));

    const cutoff = new Date('2026-11-09T12:02:30.000Z');
    expect(await store.deleteOlderThan(cutoff)).toBe(1);
    expect(await store.deleteOlderThan(cutoff)).toBe(0);
    expect(await rowOf(db, 'instagram', 'old')).toBeNull();
    expect(await rowOf(db, 'instagram', 'fresh')).not.toBeNull();
  });
  it('serializes concurrent insert, draft and notification claims in real D1', async () => {
    const store = createCommentStore(await makeD1());
    const other = 'other-tenant';
    await store.collect(newComment({ tenantId: other }));
    expect(
      (await Promise.all([store.collect(newComment()), store.collect(newComment())])).sort(),
    ).toEqual([false, true]);
    expect(await store.markNotified(TENANT, 'instagram', 'comment-1', NOW)).toBe(false);
    const claim = () => store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW);
    expect((await Promise.all([claim(), claim()])).sort()).toEqual([false, true]);
    const draft = { translationUk: 'T', replyDe: 'D', notesUk: '' };
    await store.storeDraft(TENANT, 'instagram', 'comment-1', draft, NOW);
    const notify = () => store.markNotified(TENANT, 'instagram', 'comment-1', NOW);
    expect((await Promise.all([notify(), notify()])).sort()).toEqual([false, true]);
    expect(await store.listPendingDrafts(other, 'instagram')).toHaveLength(1);
    expect(await store.listPendingDrafts(TENANT, 'facebook')).toHaveLength(0);
    expect(await store.reopenNotification(TENANT, 'instagram', 'comment-1', LATER)).toBe(false);
    expect(await store.reopenNotification(TENANT, 'instagram', 'comment-1', NOW, LATER)).toBe(true);
    expect(await store.listPendingNotify(other)).toHaveLength(0);
    const [row] = await store.listPendingNotify(TENANT);
    expect(row).toMatchObject({
      tenantId: TENANT,
      postId: 'media-1',
      status: 'drafted',
      ...draft,
      notifiedAt: null,
      commentCreatedAt: '2026-11-09T11:00:00.000Z',
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
  });

  it('keeps failed drafts pending independently of the watermark and never reclaims uncertain calls', async () => {
    const store = createCommentStore(await makeD1());
    await store.collect(newComment());
    await store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW);
    expect(await store.listPendingDrafts(TENANT, 'instagram')).toHaveLength(0);
    expect(await store.claimDrafting(TENANT, 'instagram', 'comment-1', LATER)).toBe(false);
    await store.reopenDrafting(TENANT, 'instagram', 'comment-1', LATER);
    await store.setWatermark(TENANT, 'instagram', LATER, LATER);
    expect((await store.listPendingDrafts(TENANT, 'instagram')).map((row) => row.id)).toEqual([
      'comment-1',
    ]);
  });

  it('does not regress watermarks under racing ticks', async () => {
    const store = createCommentStore(await makeD1());
    await Promise.all([
      store.setWatermark(TENANT, 'instagram', LATER, LATER),
      store.setWatermark(TENANT, 'instagram', NOW, LATER),
    ]);
    await store.setWatermark(TENANT, 'instagram', NOW, LATER);
    expect(await store.getWatermark(TENANT, 'instagram')).toEqual(LATER);
  });

  it('reports stale ambiguous work as tenant-scoped counts only', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment());
    await store.claimDrafting(TENANT, 'instagram', 'comment-1', NOW);
    expect(await store.countUncertain(TENANT, LATER)).toEqual({ drafting: 1 });
    expect(await store.countUncertain('other', LATER)).toEqual({ drafting: 0 });
    await store.storeDraft(
      TENANT,
      'instagram',
      'comment-1',
      { translationUk: 'T', replyDe: 'D', notesUk: '' },
      NOW,
    );
    await store.markNotified(TENANT, 'instagram', 'comment-1', NOW);
    expect(await store.countUncertain(TENANT, LATER)).toEqual({ drafting: 0 });
    await store.reopenNotification(TENANT, 'instagram', 'comment-1', NOW, LATER);
    expect((await rowOf(db, 'instagram', 'comment-1'))?.['updated_at']).toBe(LATER.toISOString());
    expect(await store.countUncertain(TENANT, LATER)).toEqual({ drafting: 0 });
  });

  it('deletes all tenant/network states strictly before the 30-day boundary', async () => {
    const store = createCommentStore(await makeD1());
    const cutoff = new Date(NOW.getTime() - commentRetentionDays * 86400000);
    for (const tenantId of [TENANT, 'other-tenant']) {
      for (const network of ['instagram', 'facebook'] as const) {
        await store.collect(
          newComment({ tenantId, network, id: 'old', createdAt: new Date(cutoff.getTime() - 1) }),
        );
        await store.claimDrafting(tenantId, network, 'old', NOW);
        await store.collect(newComment({ tenantId, network, id: 'boundary', createdAt: cutoff }));
      }
    }
    expect(await store.deleteOlderThan(cutoff)).toBe(4);
    expect(await store.deleteOlderThan(cutoff)).toBe(0);
    expect((await store.listPendingDrafts(TENANT, 'instagram')).map((row) => row.id)).toEqual([
      'boundary',
    ]);
  });
  it('scopes every draft and delivery transition to tenant and network', async () => {
    const db = await makeD1();
    const store = createCommentStore(db);
    await store.collect(newComment());
    const draft = { translationUk: 'T', replyDe: 'D', notesUk: '' };
    for (const [tenantId, network] of [
      ['other-tenant', 'instagram'],
      [TENANT, 'facebook'],
    ] as const) {
      expect(await store.claimDrafting(tenantId, network, 'comment-1', NOW)).toBe(false);
      expect(await store.reopenDrafting(tenantId, network, 'comment-1', NOW)).toBe(false);
      expect(await store.storeDraft(tenantId, network, 'comment-1', draft, NOW)).toBe(false);
      expect(await store.markNotified(tenantId, network, 'comment-1', NOW)).toBe(false);
      expect(await store.reopenNotification(tenantId, network, 'comment-1', NOW)).toBe(false);
    }
    expect((await rowOf(db, 'instagram', 'comment-1'))?.['status']).toBe('new');
  });
});

it('migration 0011 preserves existing comments, edit arms, watermarks and indexes', async () => {
  const db = await makeD1('0010_comment_edits.sql');
  const store = createCommentStore(db);
  for (const network of ['instagram', 'facebook'] as const) {
    await store.collect(newComment({ network }));
    await store.setWatermark(TENANT, network, NOW, NOW);
  }
  await db
    .prepare(
      "UPDATE comments SET edit_chat_id = '42', edit_expires_at = ? WHERE network = 'instagram'",
    )
    .bind(LATER.toISOString())
    .run();
  const before = await db.prepare('SELECT * FROM comments ORDER BY network').all();
  const watermarks = await db.prepare('SELECT * FROM comment_watermarks ORDER BY network').all();
  const sql = readFileSync(
    new URL('../migrations/0011_threads_comments.sql', import.meta.url),
    'utf8',
  )
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join(' ');
  await db.exec(sql);
  expect((await db.prepare('SELECT * FROM comments ORDER BY network').all()).results).toEqual(
    before.results,
  );
  expect(
    (await db.prepare('SELECT * FROM comment_watermarks ORDER BY network').all()).results,
  ).toEqual(watermarks.results);
  const indexes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all<{ name: string }>();
  expect(indexes.results.map((r) => r.name)).toEqual(
    expect.arrayContaining([
      'idx_comments_pending_notify',
      'idx_comments_retention',
      'idx_comments_edit_chat',
    ]),
  );
  expect(await store.collect(newComment({ network: 'threads' }))).toBe(true);
  await store.setWatermark(TENANT, 'threads', NOW, NOW);
  expect(await store.getWatermark(TENANT, 'threads')).toEqual(NOW);
});
