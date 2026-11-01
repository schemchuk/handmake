/** An uncertain call retains the tenant lock; no automatic takeover by another show. */
export function createShowGenerationLocks(db: D1Database) {
  return {
    async acquire(tenant: string, draft: string, lease: string, now: Date, previous = '') {
      const result = await db
        .prepare(
          `INSERT INTO show_generation_locks VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id) DO UPDATE SET lease = excluded.lease, updated_at = excluded.updated_at
        WHERE draft_id = excluded.draft_id AND (lease = ? OR updated_at < ?)`,
        )
        .bind(
          tenant,
          draft,
          lease,
          now.toISOString(),
          previous,
          new Date(now.getTime() - 10 * 60_000).toISOString(),
        )
        .run();
      return result.meta.changes === 1;
    },
    async release(tenant: string, lease: string) {
      await db
        .prepare('DELETE FROM show_generation_locks WHERE tenant_id = ? AND lease = ?')
        .bind(tenant, lease)
        .run();
    },
  };
}
