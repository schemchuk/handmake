import { queueNameReconciliations } from './name-withdrawal-store';

const retentionMs = 90 * 24 * 60 * 60 * 1000;
const eligible = `tenant_id = ? AND winner = 0 AND display_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM poll_results p
    WHERE p.tenant_id = contest_entries.tenant_id AND p.week = contest_entries.week
    AND p.published_at IS NOT NULL AND julianday(p.published_at) <= julianday(?))`;

/** UTC elapsed days, independent of contest creation flags and draft lifetime. */
export async function expireNonWinnerNames(db: D1Database, now: Date): Promise<void> {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid retention time');
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  const tenants = await db.prepare('SELECT DISTINCT tenant_id FROM contest_entries').all<{
    tenant_id: string;
  }>();
  for (const { tenant_id: tenant } of tenants.results) {
    // Eligibility, erasure and queue generation share a transaction. A concurrent
    // winner selection or manual withdrawal cannot split the private/public state.
    try {
      await db.batch([
        db
          .prepare(
            `INSERT OR IGNORE INTO name_withdrawals (tenant_id, entry_id, requested_at)
        SELECT tenant_id, entry_id, ? FROM contest_entries WHERE ${eligible}`,
          )
          .bind(now.toISOString(), tenant, cutoff),
        db
          .prepare(`UPDATE contest_entries SET display_name = NULL WHERE ${eligible}`)
          .bind(tenant, cutoff),
        queueNameReconciliations(db, tenant),
      ]);
    } catch {
      // Never log private values from a failed bound statement. Retry next day.
      console.error('Tenant name retention failed');
    }
  }
}
