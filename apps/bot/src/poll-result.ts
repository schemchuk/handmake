import { contestLeaders, deterministicUlid, isUlid } from '@handmake/core';
import type { ContestTally, Draft } from '@handmake/core';

import { draftInsertStatement } from './draft-insert';
import { createPollClosingStore } from './poll-closing-store';

export interface ResultDecision {
  allowed: string[];
  automatic?: string;
  source: 'readers' | 'author';
  tally: ContestTally;
}

/** A counted non-Telegram source requires the author's choice, even with zero votes. */
export function contestResultDecision(tally: ContestTally, entries: string[]): ResultDecision {
  if (
    entries.length < 2 ||
    entries.length > 10 ||
    new Set(entries).size !== entries.length ||
    entries.some((id) => !isUlid(id))
  )
    throw new Error('Invalid result candidates');
  const leaders = contestLeaders(tally, entries);
  const combined = Object.entries(tally.sources ?? {}).some(
    ([key, source]) => key !== 'telegram' && source.status === 'counted',
  );
  const automatic =
    tally.status === 'counted' && tally.total > 0 && !combined && leaders.length === 1
      ? leaders[0]
      : undefined;
  return {
    allowed:
      combined || tally.status === 'unreadable' || (tally.status === 'counted' && tally.total === 0)
        ? [...entries]
        : leaders,
    ...(automatic ? { automatic } : {}),
    source: automatic ? 'readers' : 'author',
    tally,
  };
}

export interface ResultReceipt {
  draftId: string;
  entryId: string;
  source: 'readers' | 'author';
}

export function createPollResultStore(db: D1Database) {
  return {
    async get(tenant: string, week: string): Promise<ResultReceipt | undefined> {
      return (
        (await db
          .prepare(
            `SELECT draft_id AS draftId, entry_id AS entryId, source
        FROM poll_results WHERE tenant_id = ? AND week = ?`,
          )
          .bind(tenant, week)
          .first<ResultReceipt>()) ?? undefined
      );
    },
    async decision(tenant: string, week: string): Promise<ResultDecision | undefined> {
      const closing = await createPollClosingStore(db).get(tenant, week);
      return closing?.tally
        ? contestResultDecision(closing.tally, closing.poll.entryRefs)
        : undefined;
    },
    /** The caller authenticates the author. Claim binds a callback to this immutable closing. */
    async create(input: {
      tenant: string;
      week: string;
      claim: string;
      chatId: string;
      now: Date;
      entryId?: string;
    }): Promise<{ created: boolean; result?: ResultReceipt }> {
      const { tenant, week, claim, chatId, now, entryId } = input;
      const closing = await createPollClosingStore(db).get(tenant, week);
      if (
        !closing?.tally ||
        closing.claim !== claim ||
        closing.poll.tenantId !== tenant ||
        closing.poll.week !== week
      )
        return { created: false };
      const existing = await this.get(tenant, week);
      if (existing) return { created: false, result: existing };
      const decision = contestResultDecision(closing.tally, closing.poll.entryRefs);
      const winner = entryId ?? decision.automatic;
      if (!winner || !decision.allowed.includes(winner)) return { created: false };
      const entry = await db
        .prepare(
          `SELECT file_id FROM contest_entries
        WHERE tenant_id = ? AND week = ? AND entry_id = ?`,
        )
        .bind(tenant, week, winner)
        .first<{ file_id: string }>();
      if (!entry) return { created: false };
      // Stable across cron/callback time and independent of author input.
      const draftId = await deterministicUlid(
        `${tenant}:wotw-result:${week}`,
        Date.parse(`${week}T12:00:00Z`),
      );
      const name = `{entry:${winner}}`;
      const draft: Draft = {
        tenantId: tenant,
        draftId,
        kind: 'post',
        type: 'wotw-result',
        state: 'ready',
        extras: { week, entryRefs: [winner], winnerEntryId: winner, resultSource: decision.source },
        texts:
          decision.source === 'readers'
            ? {
                uk: `Робота тижня за вибором читачів: ${name}.`,
                de: `Werk der Woche nach Wahl der Leserschaft: ${name}.`,
              }
            : {
                uk: `Робота тижня за вибором авторки: ${name}.`,
                de: `Werk der Woche nach Wahl der Autorin: ${name}.`,
              },
        photoRefs: [entry.file_id],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      // D1 serializes the batch transaction. All three statements use the durable receipt
      // guard, so a competing decision cannot insert a draft or change the winner.
      // Plain INSERT deliberately fails on an unrelated draft ID collision: no false receipt.
      const results = await db.batch([
        draftInsertStatement(db, draft, chatId, { unresultedWeek: week }),
        db
          .prepare(
            `UPDATE contest_entries SET winner = 1 WHERE tenant_id = ? AND week = ? AND entry_id = ?
          AND NOT EXISTS (SELECT 1 FROM poll_results WHERE tenant_id = ? AND week = ?)`,
          )
          .bind(tenant, week, winner, tenant, week),
        db
          .prepare(
            `INSERT INTO poll_results (tenant_id, week, draft_id, entry_id, source)
          SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS
          (SELECT 1 FROM poll_results WHERE tenant_id = ? AND week = ?)`,
          )
          .bind(tenant, week, draftId, winner, decision.source, tenant, week),
      ]);
      return { created: results[2]!.meta.changes === 1, result: await this.get(tenant, week) };
    },
  };
}
