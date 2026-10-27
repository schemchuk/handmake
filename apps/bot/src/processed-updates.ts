/**
 * Webhook retry dedupe (migration 0003). Telegram re-delivers an update
 * when our answer times out or errors, and a re-run of a handled update
 * would append the author's text or photos twice. The Worker records each
 * successfully handled `update_id` and drops exact redeliveries. Rows are
 * small and purged by the same daily cron as drafts; the retention only
 * needs to cover Telegram's retry window.
 */

export const processedUpdateRetentionDays = 7;

export interface ProcessedUpdateTracker {
  wasProcessed(updateId: number): Promise<boolean>;
  markProcessed(updateId: number): Promise<void>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}

export function createProcessedUpdateTracker(db: D1Database): ProcessedUpdateTracker {
  return {
    async wasProcessed(updateId) {
      const row = await db
        .prepare('SELECT update_id FROM processed_updates WHERE update_id = ?')
        .bind(updateId)
        .first();
      return row !== null;
    },

    async markProcessed(updateId) {
      await db
        .prepare('INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)')
        .bind(updateId)
        .run();
    },

    async deleteOlderThan(cutoff) {
      const result = await db
        .prepare('DELETE FROM processed_updates WHERE processed_at < ?')
        .bind(cutoff.toISOString())
        .run();
      return result.meta.changes;
    },
  };
}
