import { entryReferences, isUlid } from '@handmake/core';
import type { AnonymousEditReceipt } from '@handmake/core';

import { createEditReceiptStore } from './edit-receipt-store';

/** Also used by callbacks: late receipts must not escape an earlier deletion request. */
export function queueNameReconciliations(db: D1Database, tenant: string): D1PreparedStatement {
  return db
    .prepare(
      `
    INSERT INTO name_reconciliations (tenant_id, post_id, channel, generation)
    SELECT r.tenant_id, r.post_id, r.channel, count(DISTINCT w.entry_id)
    FROM anonymous_edit_receipts r
    JOIN json_each(r.receipt, '$.plan.entryRefs') refs
    JOIN name_withdrawals w ON w.tenant_id = r.tenant_id AND w.entry_id = refs.value
    WHERE r.tenant_id = ?
    GROUP BY r.tenant_id, r.post_id, r.channel
    ON CONFLICT (tenant_id, post_id, channel) DO UPDATE SET
      generation = excluded.generation, next_operation = 0, state = 'pending', error_code = NULL
    WHERE name_reconciliations.generation < excluded.generation
  `,
    )
    .bind(tenant);
}

/** Poll API messages cannot be edited; never claim those name-bearing fields were removed. */
export function receiptHasUneditableNames(receipt: AnonymousEditReceipt | undefined): boolean {
  return (
    !!receipt?.plan.allowNames &&
    receipt.plan.operations.some(
      (op) =>
        op.kind === 'poll' &&
        [op.question, ...op.options].some((s) => entryReferences(s).length > 0),
    )
  );
}

/** Internal boundary only; the command layer must authenticate the tenant's author. */
export function createNameWithdrawalStore(db: D1Database) {
  return {
    async withdraw(tenant: string, entry: string, now = new Date()) {
      if (
        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tenant) ||
        !isUlid(entry) ||
        !Number.isFinite(now.getTime())
      )
        throw new Error('Invalid name withdrawal');
      // The conditional insert and deletion run in the same D1 transaction as queueing.
      // Repeated actions never increment generations or reset a worker's progress.
      await db.batch([
        db
          .prepare(
            `INSERT OR IGNORE INTO name_withdrawals (tenant_id, entry_id, requested_at)
          SELECT tenant_id, entry_id, ? FROM contest_entries WHERE tenant_id = ? AND entry_id = ?`,
          )
          .bind(now.toISOString(), tenant, entry),
        db
          .prepare(
            `UPDATE contest_entries SET display_name = NULL
          WHERE tenant_id = ? AND entry_id = ?`,
          )
          .bind(tenant, entry),
        queueNameReconciliations(db, tenant),
      ]);
      return this.status(tenant, entry);
    },
    async status(tenant: string, entry: string) {
      const marker = await db
        .prepare(
          `SELECT requested_at FROM name_withdrawals
        WHERE tenant_id = ? AND entry_id = ?`,
        )
        .bind(tenant, entry)
        .first<{ requested_at: string }>();
      if (!marker) return undefined;
      const receipts = await createEditReceiptStore(db).forEntry(tenant, entry);
      // A known receipt does not prove every legacy publication is covered. Check the
      // independent result/closing indexes after drafts have been cleaned up as well.
      // Only Telegram can carry names under entryNamesAllowed; other deliveries need no receipt.
      const legacy = await db
        .prepare(
          `SELECT 1 FROM channel_deliveries d
        WHERE d.tenant_id = ? AND d.status = 'done' AND d.channel = 'telegram'
        AND NOT EXISTS (SELECT 1 FROM anonymous_edit_receipts r
          WHERE r.tenant_id = d.tenant_id AND r.post_id = d.post_id AND r.channel = d.channel)
        AND (EXISTS (SELECT 1 FROM poll_results p JOIN contest_entries e
          ON e.tenant_id = p.tenant_id AND e.week = p.week
          WHERE p.tenant_id = d.tenant_id AND p.draft_id = d.post_id AND e.entry_id = ?)
          OR EXISTS (SELECT 1 FROM poll_closings p, json_each(p.snapshot, '$.entryRefs') refs
            WHERE p.tenant_id = d.tenant_id AND json_extract(p.snapshot, '$.postId') = d.post_id
              AND refs.value = ?)) LIMIT 1`,
        )
        .bind(tenant, entry, entry)
        .first();
      return {
        requestedAt: marker.requested_at,
        // Absence is explicit, never reconstructed from a draft or treated as success.
        missingReceipt: receipts.length === 0 || !!legacy,
        publications: await Promise.all(
          receipts.map(async ({ postId, channel, receipt }) => ({
            postId,
            channel,
            uneditableNames: receiptHasUneditableNames(receipt),
            progress: await db
              .prepare(
                `SELECT generation, completed_generation, next_operation, state, error_code
            FROM name_reconciliations WHERE tenant_id = ? AND post_id = ? AND channel = ?`,
              )
              .bind(tenant, postId, channel)
              .first(),
          })),
        ),
      };
    },
  };
}
