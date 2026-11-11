import type { Draft } from '@handmake/core';

export interface PollOpeningStore {
  has(tenant: string, week: string): Promise<boolean>;
  /** Atomically record a skipped opening or insert its ready draft and receipt. */
  createIfAbsent(tenant: string, week: string, chatId: string, draft?: Draft): Promise<boolean>;
}

export function createPollOpeningStore(db: D1Database): PollOpeningStore {
  return {
    async has(tenant, week) {
      return !!(await db
        .prepare('SELECT 1 FROM poll_openings WHERE tenant_id = ? AND week = ?')
        .bind(tenant, week)
        .first());
    },
    async createIfAbsent(tenant, week, chatId, draft) {
      const receipt = db
        .prepare('INSERT OR IGNORE INTO poll_openings (tenant_id, week) VALUES (?, ?)')
        .bind(tenant, week);
      if (!draft) return (await receipt.run()).meta.changes === 1;
      if (draft.tenantId !== tenant || draft.extras['week'] !== week)
        throw new Error('Poll opening mismatch');
      // D1 batches are transactions: no receipt without a draft, no concurrent duplicate.
      const results = await db.batch([
        db
          .prepare(
            `INSERT OR IGNORE INTO drafts
            (tenant_id, id, chat_id, status, kind, type, extras, texts, photos, version, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM poll_openings WHERE tenant_id = ? AND week = ?)`,
          )
          .bind(
            tenant,
            draft.draftId,
            chatId,
            draft.state,
            draft.kind,
            draft.type,
            JSON.stringify(draft.extras),
            JSON.stringify(draft.texts),
            JSON.stringify(draft.photoRefs),
            draft.createdAt,
            draft.updatedAt,
            tenant,
            week,
          ),
        receipt,
      ]);
      return results[1]!.meta.changes === 1;
    },
  };
}
