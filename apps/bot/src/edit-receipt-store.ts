import { anonymousEditReceiptSchema } from '@handmake/core';
import type { AnonymousEditReceipt } from '@handmake/core';

/** Absence explicitly means a legacy/incomplete publication; never infer from a draft. */
export function createEditReceiptStore(db: D1Database) {
  return {
    async get(
      tenant: string,
      post: string,
      channel: string,
    ): Promise<AnonymousEditReceipt | undefined> {
      const row = await db
        .prepare(
          `SELECT receipt FROM anonymous_edit_receipts
        WHERE tenant_id = ? AND post_id = ? AND channel = ?`,
        )
        .bind(tenant, post, channel)
        .first<{ receipt: string }>();
      return row ? anonymousEditReceiptSchema.parse(JSON.parse(row.receipt)) : undefined;
    },
    async forEntry(tenant: string, entry: string) {
      // Bounded by the entry's lifetime; JSON membership avoids substring/LIKE matches.
      const rows = await db
        .prepare(
          `SELECT post_id, channel, receipt FROM anonymous_edit_receipts
        WHERE tenant_id = ? AND EXISTS (SELECT 1 FROM json_each(receipt, '$.plan.entryRefs') WHERE value = ?)`,
        )
        .bind(tenant, entry)
        .all<{ post_id: string; channel: string; receipt: string }>();
      return rows.results.map((row) => ({
        postId: row.post_id,
        channel: row.channel,
        receipt: anonymousEditReceiptSchema.parse(JSON.parse(row.receipt)),
      }));
    },
  };
}
