import { ChannelEditRejectedError, resolveEditPlan } from '@handmake/core';
import type { ChannelAdapter, DeliverContext } from '@handmake/core';

import { readEntryNames } from './contest-names';
import { createEditReceiptStore } from './edit-receipt-store';
import { receiptHasUneditableNames } from './name-withdrawal-store';

interface Job {
  tenant_id: string;
  post_id: string;
  channel: string;
  generation: number;
  next_operation: number;
  lock_token: string | null;
}
type Target = Pick<Job, 'tenant_id' | 'post_id' | 'channel'>;
export interface NameReconciliationOptions {
  db: D1Database;
  adapter: Pick<ChannelAdapter, 'key' | 'editMessage'>;
  secrets: DeliverContext['secrets'];
  /** Must be idempotent. A failure retries the hook without replaying successful edits. */
  rebuild?: (tenant: string, post: string) => Promise<void>;
}

/** No expiring leases: Telegram cannot reject writes from an expired owner. */
export function createNameReconciler(options: NameReconciliationOptions) {
  const { db, adapter } = options;
  const key = (job: Target) => [job.tenant_id, job.post_id, job.channel];
  const read = (job: Target) =>
    db
      .prepare(
        `SELECT * FROM name_reconciliations WHERE tenant_id = ? AND post_id = ? AND channel = ?`,
      )
      .bind(...key(job))
      .first<Job>();
  async function run(job: Job) {
    const token = crypto.randomUUID();
    const claim = await db
      .prepare(
        `UPDATE name_reconciliations SET lock_token = ?, state = 'running', error_code = NULL,
          attempts = attempts + 1
         WHERE tenant_id = ? AND post_id = ? AND channel = ? AND lock_token IS NULL
         AND state IN ('pending', 'failed') RETURNING *`,
      )
      .bind(token, ...key(job))
      .first<Job>();
    if (!claim) return;
    const update = async (sql: string, values: unknown[] = [], generation?: number) =>
      db
        .prepare(
          `UPDATE name_reconciliations SET ${sql}
           WHERE tenant_id = ? AND post_id = ? AND channel = ? AND lock_token = ?
           ${generation === undefined ? '' : 'AND generation = ?'}`,
        )
        .bind(...values, ...key(job), token, ...(generation === undefined ? [] : [generation]))
        .run();
    let remoteInFlight = false;
    try {
      const receipt = await createEditReceiptStore(db).get(job.tenant_id, job.post_id, job.channel);
      if (!receipt || !adapter.editMessage) {
        await update("state = 'blocked', error_code = 'unsupported_receipt', lock_token = NULL");
        return;
      }
      // Bound one tick; release only between confirmed remote outcomes.
      for (let budget = 0; budget < 64; budget++) {
        const current = await read(job);
        if (!current || current.lock_token !== token) return;
        const generation = current.generation;
        const index = current.next_operation;
        const ops = resolveEditPlan(
          receipt.plan,
          await readEntryNames(db, job.tenant_id, receipt.plan.entryRefs),
        );
        const op = ops[index];
        if (!op) {
          if (receiptHasUneditableNames(receipt)) {
            await update(
              "state = 'blocked', error_code = 'uneditable_names', lock_token = NULL",
              [],
              generation,
            );
          } else {
            // Site currently has no contest-name consumer; production uses the no-op.
            await options.rebuild?.(job.tenant_id, job.post_id);
            const result = await update(
              "state = 'done', completed_generation = generation, error_code = NULL, lock_token = NULL",
              [],
              generation,
            );
            if (!result.meta.changes) continue;
          }
          // A withdrawal during the hook/blocked transition must still be processed.
          if ((await read(job))?.lock_token === token) continue;
          return;
        }
        if (op.kind === 'poll') {
          await update('next_operation = ?', [index + 1], generation);
          continue;
        }
        // Persist uncertainty before the call. A crash at any later point retains
        // the lock, even if the remote side succeeded but the progress write failed.
        const prepared = await update("error_code = 'remote_inflight'", [], generation);
        if (!prepared.meta.changes) continue;
        remoteInFlight = true;
        await adapter.editMessage(receipt.remoteIds[index]!, op, {
          settings: receipt.plan.settings,
          secrets: options.secrets,
        });
        remoteInFlight = false;
        await update('next_operation = ?, error_code = NULL', [index + 1], generation);
        // If another entry was withdrawn during the edit, its transaction reset
        // progress. The same owner renders the new generation before releasing.
      }
      await update("state = 'pending', lock_token = NULL, error_code = NULL");
    } catch (error) {
      if (remoteInFlight && !(error instanceof ChannelEditRejectedError)) {
        await update("state = 'blocked', error_code = 'remote_unknown'");
      } else {
        await update("state = 'failed', error_code = ?, lock_token = NULL", [
          error instanceof ChannelEditRejectedError ? 'edit_rejected' : 'retry_required',
        ]);
      }
    }
  }
  return {
    async tick() {
      const jobs = await db
        .prepare(
          `SELECT * FROM name_reconciliations WHERE channel = ? AND lock_token IS NULL
           AND state IN ('pending', 'failed') ORDER BY attempts, tenant_id, post_id LIMIT 10`,
        )
        .bind(adapter.key)
        .all<Job>();
      for (const job of jobs.results) await run(job);
    },
    /** Operator-only recovery boundary, never a timeout takeover. Before calling,
     * establish that the old invocation AND its remote request cannot still write.
     * The token fences delayed local writes; replay from zero repairs unknown delivery.
     * No HTTP/author route exposes this assertion.
     */
    async recoverQuiescent(job: Target, token: string, proof: 'remote-writer-stopped') {
      if (proof !== 'remote-writer-stopped' || !token) throw new Error('Quiescence required');
      const result = await db
        .prepare(
          `UPDATE name_reconciliations SET lock_token = NULL, state = 'pending',
           next_operation = 0, error_code = NULL
           WHERE tenant_id = ? AND post_id = ? AND channel = ? AND lock_token = ?
           AND state IN ('running', 'blocked')`,
        )
        .bind(...key(job), token)
        .run();
      return result.meta.changes === 1;
    },
  };
}
