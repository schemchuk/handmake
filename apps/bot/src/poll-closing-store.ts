import { isUlid, validateContestTally } from '@handmake/core';
import type { ContestTally, RemoteId } from '@handmake/core';

export interface ClosingPoll {
  tenantId: string;
  week: string;
  postId: string;
  channel: string;
  pollId: RemoteId;
  entryRefs: string[];
}

/** Snapshot only fully published polls; delivery IDs are never inferred by rendering again. */
export async function findClosingPoll(
  db: D1Database,
  tenant: string,
  week: string,
  channel: string,
): Promise<ClosingPoll | undefined> {
  const rows = await db
    .prepare(
      `SELECT d.id, d.extras, c.message_ids FROM drafts d
    JOIN channel_deliveries c ON c.tenant_id = d.tenant_id AND c.post_id = d.id
    WHERE d.tenant_id = ? AND d.status = 'published' AND d.type = 'wotw-poll'
      AND json_extract(d.extras, '$.week') = ? AND c.channel = ? AND c.status = 'done'`,
    )
    .bind(tenant, week, channel)
    .all<{ id: string; extras: string; message_ids: string }>();
  if (!rows.results.length) return undefined;
  if (rows.results.length !== 1) throw new Error('Ambiguous published poll');
  const row = rows.results[0]!;
  const extras = JSON.parse(row.extras) as { entryRefs?: unknown; poll?: { options?: unknown } };
  const refs = extras.entryRefs;
  const pollId = (JSON.parse(row.message_ids) as { poll?: unknown }).poll;
  // A legacy delivery without its poll ID is not evidence of a published poll.
  if (pollId === undefined) return undefined;
  if (
    !(typeof pollId === 'string' && pollId.length > 0) &&
    !(typeof pollId === 'number' && Number.isSafeInteger(pollId) && pollId > 0)
  )
    throw new Error('Invalid published poll ID');
  if (
    !Array.isArray(refs) ||
    refs.length < 2 ||
    refs.length > 10 ||
    refs.some((id) => typeof id !== 'string' || !isUlid(id)) ||
    new Set(refs).size !== refs.length ||
    !Array.isArray(extras.poll?.options) ||
    extras.poll.options.length !== refs.length
  )
    throw new Error('Invalid poll candidates');
  const candidates = await db
    .prepare(
      `SELECT entry_id FROM contest_entries
    WHERE tenant_id = ? AND week = ?`,
    )
    .bind(tenant, week)
    .all<{ entry_id: string }>();
  const allowed = new Set(candidates.results.map((entry) => entry.entry_id));
  if (refs.some((id) => !allowed.has(id))) throw new Error('Poll candidate tenant/week mismatch');
  return { tenantId: tenant, week, postId: row.id, channel, pollId, entryRefs: refs };
}

export function createPollClosingStore(db: D1Database) {
  return {
    async claim(poll: ClosingPoll, now: number, leaseMs = 300_000): Promise<string | undefined> {
      const claim = crypto.randomUUID();
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO poll_closings
        (tenant_id, week, snapshot, claim, expires_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(poll.tenantId, poll.week, JSON.stringify(poll), claim, now + leaseMs)
        .run();
      return result.meta.changes === 1 ? claim : undefined;
    },
    async finish(
      tenant: string,
      week: string,
      claim: string,
      tally: ContestTally,
    ): Promise<boolean> {
      const row = await this.get(tenant, week);
      if (!row || row.claim !== claim || row.tally) return false;
      if (tally.status === 'counted')
        validateContestTally(
          { optionVotes: tally.counts, totalVotes: tally.total },
          row.poll.entryRefs.length,
        );
      const result = await db
        .prepare(
          `UPDATE poll_closings SET tally = ?
        WHERE tenant_id = ? AND week = ? AND claim = ? AND tally IS NULL`,
        )
        .bind(JSON.stringify(tally), tenant, week, claim)
        .run();
      return result.meta.changes === 1;
    },
    async recover(tenant: string, week: string, now: number): Promise<void> {
      // Never repeat the remote stop after an ambiguous interruption. No final counts
      // can be fetched reliably from an already stopped poll. T31d asks the author.
      await db
        .prepare(
          `UPDATE poll_closings SET tally = '{"status":"unreadable"}'
        WHERE tenant_id = ? AND week = ? AND tally IS NULL AND expires_at <= ?`,
        )
        .bind(tenant, week, now)
        .run();
    },
    async get(tenant: string, week: string) {
      const row = await db
        .prepare(
          `SELECT snapshot, claim, tally FROM poll_closings
        WHERE tenant_id = ? AND week = ?`,
        )
        .bind(tenant, week)
        .first<{ snapshot: string; claim: string; tally: string | null }>();
      return row
        ? {
            poll: JSON.parse(row.snapshot) as ClosingPoll,
            claim: row.claim,
            tally: row.tally ? (JSON.parse(row.tally) as ContestTally) : undefined,
          }
        : undefined;
    },
  };
}
