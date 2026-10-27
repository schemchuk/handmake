import { createDraft } from '@handmake/core';
import type { Draft, DraftState } from '@handmake/core';

/**
 * D1 persistence for drafts (ADR 006: every query is keyed by tenant_id).
 * Rows carry the content columns from migration 0002 (`texts` JSON object,
 * `photos` JSON array of Telegram file_ids) and the concurrency guards from
 * migration 0003: a `version` optimistic-lock counter and a partial unique
 * index enforcing one collecting draft per chat.
 *
 * Why the extra machinery: Telegram delivers an album as several messages
 * and the Worker handles updates concurrently, so "read the draft, change
 * it, write it back" races — photos get lost, a chat gets two collecting
 * drafts, or the 10-photo limit is bypassed. Content appends are therefore
 * single atomic UPDATE statements whose WHERE clause carries the state and
 * limit guards (no read-modify-write window at all), and first-content
 * creation goes through `getOrCreateCollecting`, made atomic by the unique
 * index: the INSERT either wins or the existing row is returned. Whole-state
 * transitions (translation results, publishing, T15/T16) use `update`, an
 * optimistic version check the caller retries on conflict — a retry loop
 * cannot be used for collection, where N parallel messages would livelock
 * it; single statements serialize at SQLite instead.
 */

/** A draft plus the row version the caller must quote on the next update. */
export interface StoredDraft {
  draft: Draft;
  version: number;
}

export interface D1DraftStore {
  get(tenantId: string, draftId: string): Promise<StoredDraft | undefined>;
  /** Insert a new draft, remembering which chat is collecting it. */
  create(draft: Draft, chatId: string): Promise<void>;
  /**
   * Optimistic update: writes the draft only if the row version still
   * matches. Returns false on interference — re-read and retry. Used for
   * whole-state transitions (translation results, publishing); content
   * collection goes through the atomic appends below instead.
   */
  update(draft: Draft, expectedVersion: number): Promise<boolean>;
  /**
   * Atomically appends one photo file_id to a collecting draft. The
   * 10-photo limit and the state guard live in the UPDATE itself, so
   * parallel album messages cannot bypass them; 'not-collecting' covers a
   * racing /discard (row gone or no longer collecting).
   */
  appendPhoto(
    tenantId: string,
    draftId: string,
    fileId: string,
    limit: number,
    now: Date,
  ): Promise<'added' | 'limit' | 'not-collecting'>;
  /** Atomically appends text to the UA version. False if not collecting. */
  appendText(tenantId: string, draftId: string, text: string, now: Date): Promise<boolean>;
  delete(tenantId: string, draftId: string): Promise<void>;
  listByState(tenantId: string, state: DraftState): Promise<StoredDraft[]>;
  findCollectingForChat(tenantId: string, chatId: string): Promise<StoredDraft | undefined>;
  /** One collecting draft per chat, created on the spot if missing. */
  getOrCreateCollecting(tenantId: string, chatId: string, now: Date): Promise<StoredDraft>;
  /** Delete every draft untouched since the cutoff; returns the row count. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

interface DraftRow {
  tenant_id: string;
  id: string;
  chat_id: string;
  status: string;
  texts: string;
  photos: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const draftStates: ReadonlySet<string> = new Set([
  'collecting',
  'translating',
  'ready',
  'publishing',
  'published',
  'failed',
]);

const selectDraft = `SELECT tenant_id, id, chat_id, status, texts, photos, version, created_at, updated_at
  FROM drafts WHERE tenant_id = ?`;

/** D1/SQLite report UNIQUE violations with this message; we treat them as
 * expected contention, not errors (the partial unique index on collecting
 * drafts and the processed_updates primary key both rely on it). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function createD1DraftStore(db: D1Database): D1DraftStore {
  return {
    async get(tenantId, draftId) {
      const row = await db
        .prepare(`${selectDraft} AND id = ?`)
        .bind(tenantId, draftId)
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async create(draft, chatId) {
      await db
        .prepare(
          `INSERT INTO drafts (tenant_id, id, chat_id, status, texts, photos, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(
          draft.tenantId,
          draft.draftId,
          chatId,
          draft.state,
          JSON.stringify(draft.texts),
          JSON.stringify(draft.photoRefs),
          draft.createdAt,
          draft.updatedAt,
        )
        .run();
    },

    async update(draft, expectedVersion) {
      const result = await db
        .prepare(
          `UPDATE drafts SET status = ?, texts = ?, photos = ?, updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND version = ?`,
        )
        .bind(
          draft.state,
          JSON.stringify(draft.texts),
          JSON.stringify(draft.photoRefs),
          draft.updatedAt,
          draft.tenantId,
          draft.draftId,
          expectedVersion,
        )
        .run();
      return result.meta.changes === 1;
    },

    async appendPhoto(tenantId, draftId, fileId, limit, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET photos = json_insert(photos, '$[#]', ?), updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status = 'collecting'
             AND json_array_length(photos) < ?`,
        )
        .bind(fileId, now.toISOString(), tenantId, draftId, limit)
        .run();
      if (result.meta.changes === 1) {
        return 'added';
      }
      const stored = await this.get(tenantId, draftId);
      return stored?.draft.state === 'collecting' ? 'limit' : 'not-collecting';
    },

    async appendText(tenantId, draftId, text, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET texts = json_set(texts, '$.ua', CASE
                 WHEN json_extract(texts, '$.ua') IS NULL THEN ?
                 ELSE json_extract(texts, '$.ua') || char(10) || char(10) || ?
               END),
               updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status = 'collecting'`,
        )
        .bind(text, text, now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes === 1;
    },

    async delete(tenantId, draftId) {
      await db
        .prepare('DELETE FROM drafts WHERE tenant_id = ? AND id = ?')
        .bind(tenantId, draftId)
        .run();
    },

    async listByState(tenantId, state) {
      const result = await db
        .prepare(`${selectDraft} AND status = ? ORDER BY created_at`)
        .bind(tenantId, state)
        .all<DraftRow>();
      return (result.results ?? []).map(toStoredDraft);
    },

    async findCollectingForChat(tenantId, chatId) {
      const row = await db
        .prepare(
          `${selectDraft} AND chat_id = ? AND status = 'collecting' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(tenantId, chatId)
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async getOrCreateCollecting(tenantId, chatId, now) {
      const draft = createDraft(tenantId, crypto.randomUUID(), now);
      try {
        await db
          .prepare(
            `INSERT INTO drafts (tenant_id, id, chat_id, status, texts, photos, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, '{}', '[]', 0, ?, ?)`,
          )
          .bind(tenantId, draft.draftId, chatId, draft.state, draft.createdAt, draft.updatedAt)
          .run();
        return { draft, version: 0 };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // Another request created the chat's collecting draft first; the
        // unique index guarantees it exists (discards between the failed
        // INSERT and this SELECT are a race we accept: the caller's update
        // then fails its version check and retries from a fresh read).
        const existing = await this.findCollectingForChat(tenantId, chatId);
        if (!existing) {
          throw new Error(`no collecting draft for chat ${chatId} after unique conflict`);
        }
        return existing;
      }
    },

    async deleteOlderThan(cutoff) {
      const result = await db
        .prepare('DELETE FROM drafts WHERE updated_at < ?')
        .bind(cutoff.toISOString())
        .run();
      return result.meta.changes;
    },
  };
}

function toStoredDraft(row: DraftRow): StoredDraft {
  if (!draftStates.has(row.status)) {
    throw new Error(`draft row has unknown status "${row.status}"`);
  }
  return {
    draft: {
      tenantId: row.tenant_id,
      draftId: row.id,
      state: row.status as DraftState,
      texts: parseTexts(row.texts),
      photoRefs: parsePhotos(row.photos),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    version: row.version,
  };
}

function parseTexts(json: string): Record<string, string> {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('draft row has invalid texts JSON');
  }
  for (const value of Object.values(parsed)) {
    if (typeof value !== 'string') {
      throw new Error('draft row has invalid texts JSON');
    }
  }
  return parsed as Record<string, string>;
}

function parsePhotos(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error('draft row has invalid photos JSON');
  }
  return parsed as string[];
}
