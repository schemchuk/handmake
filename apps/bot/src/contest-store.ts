import { contestWeek, isUlid } from '@handmake/core';
import type { ContestSubmission, SubmissionSource } from '@handmake/core';

export interface NewContestEntry {
  entryId: string;
  tenantId: string;
  /** Network-independent media reference; the Telegram adapter stores it as D1 file_id. */
  photoRef: string;
  displayName?: string;
  /** Explicit author confirmation; a timestamp alone does not imply consent. */
  consent: true;
  consentAt: Date;
  createdAt: Date;
}

export interface ContestEntryStore {
  /** Returns false for an existing id; retries never overwrite its original consent or content. */
  submit(entry: NewContestEntry): Promise<boolean>;
  listSubmissions(tenantId: string, week: string): Promise<ContestSubmission[]>;
}

function validDate(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime());
}

/** No errors from this adapter may carry bound names or media references into runtime logs. */
export function createContestEntryStore(db: D1Database): ContestEntryStore {
  return {
    async submit(entry) {
      if (
        entry.consent !== true ||
        !validDate(entry.consentAt) ||
        !validDate(entry.createdAt) ||
        entry.consentAt.getTime() > entry.createdAt.getTime() ||
        !isUlid(entry.entryId) ||
        typeof entry.tenantId !== 'string' ||
        !entry.tenantId.trim() ||
        typeof entry.photoRef !== 'string' ||
        !entry.photoRef.trim() ||
        (entry.displayName !== undefined &&
          (typeof entry.displayName !== 'string' ||
            !entry.displayName.trim() ||
            Array.from(entry.displayName).length > 30))
      )
        throw new Error('Invalid contest entry');
      try {
        const result = await db
          .prepare(
            `INSERT INTO contest_entries
          (entry_id, tenant_id, week, file_id, display_name, consent_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, entry_id) DO NOTHING`,
          )
          .bind(
            entry.entryId,
            entry.tenantId,
            contestWeek(entry.createdAt),
            entry.photoRef,
            entry.displayName ?? null,
            entry.consentAt.toISOString(),
            entry.createdAt.toISOString(),
          )
          .run();
        return result.meta.changes === 1;
      } catch {
        throw new Error('Contest entry storage failed');
      }
    },
    async listSubmissions(tenantId, week) {
      const date = new Date(`${week}T12:00:00.000Z`);
      if (
        !tenantId.trim() ||
        !/^\d{4}-\d{2}-\d{2}$/.test(week) ||
        !validDate(date) ||
        contestWeek(date) !== week
      )
        throw new Error('Invalid contest query');
      try {
        const result = await db
          .prepare(
            `SELECT entry_id AS entryId, tenant_id AS tenantId,
          week, file_id AS photoRef, created_at AS createdAt FROM contest_entries
          WHERE tenant_id = ? AND week = ? AND status = 'submitted'
          ORDER BY created_at, entry_id LIMIT 10`,
          )
          .bind(tenantId, week)
          .all<ContestSubmission>();
        return result.results;
      } catch {
        throw new Error('Contest entry lookup failed');
      }
    },
  };
}

/** D1-backed adapter for the network-independent contest source port (ADR 010). */
export class AuthorEntrySource implements SubmissionSource {
  constructor(private readonly store: ContestEntryStore) {}
  listSubmissions(tenantId: string, week: string): Promise<ContestSubmission[]> {
    return this.store.listSubmissions(tenantId, week);
  }
}
