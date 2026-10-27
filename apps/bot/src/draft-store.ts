import { createDraft, newUlid } from '@handmake/core';
import type { Draft, DraftState } from '@handmake/core';

/** A 'translating' draft older than this may be claimed again: the background
 * task that claimed it died (e.g. runtime cancellation) without recording a
 * result. Two minutes cover any healthy translation with a wide margin. */
export const translationStaleMs = 2 * 60 * 1000;

/** A 'publishing' draft older than this may be claimed again: the background
 * dispatch died without a result. Five minutes are far beyond a healthy
 * `repository_dispatch` round trip; reclaiming re-dispatches the same draft
 * id, and the pipeline dedupes on it (F11), so a late reclaim is safe. */
export const publishingStaleMs = 5 * 60 * 1000;

const staleEpoch = new Date(0);

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
  /** Set while the bot waits for the author's replacement text (ADR 005). */
  pendingEdit: DraftEditTarget | null;
}

/** Which language version an edit replaces; the canonical draft keys. */
export type DraftEditTarget = 'uk' | 'de';

const editTargetPattern = /^[a-z]{2}$/;

function editJsonPath(lang: string): string {
  if (!editTargetPattern.test(lang)) {
    throw new Error(`invalid edit target "${lang}"`);
  }
  return `$.${lang}`;
}

export interface D1DraftStore {
  get(tenantId: string, draftId: string): Promise<StoredDraft | undefined>;
  /** Insert a new draft, remembering which chat is collecting it. */
  create(draft: Draft, chatId: string): Promise<void>;
  /**
   * Optimistic update: writes the draft only if the row version still
   * matches. Returns false on interference — re-read and retry. Used for
   * whole-state transitions; content collection goes through the atomic
   * statements below instead.
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
  /** Atomically appends text to the Ukrainian version. False if not collecting. */
  appendText(tenantId: string, draftId: string, text: string, now: Date): Promise<boolean>;
  delete(tenantId: string, draftId: string): Promise<void>;
  listByState(tenantId: string, state: DraftState): Promise<StoredDraft[]>;
  findCollectingForChat(tenantId: string, chatId: string): Promise<StoredDraft | undefined>;
  /** The chat's most recent draft in any state, for /done and the buttons. */
  latestForChat(tenantId: string, chatId: string): Promise<StoredDraft | undefined>;
  /** One collecting draft per chat, created on the spot if missing. */
  getOrCreateCollecting(tenantId: string, chatId: string, now: Date): Promise<StoredDraft>;
  /**
   * Claims the draft for one translation run: moves it to 'translating' in
   * a single statement if it is in one of `from`, or if it is stuck in
   * 'translating' since before `staleBefore` (the previous background task
   * died without a result). Returns the claimed row, or undefined if someone
   * else got there first — the caller then backs off instead of running a
   * duplicate (paid) AI call.
   */
  claimTranslation(
    tenantId: string,
    draftId: string,
    from: DraftState[],
    now: Date,
    staleBefore?: Date,
  ): Promise<StoredDraft | undefined>;
  /** Stores the German text and moves 'translating' → 'ready'. */
  markTranslated(tenantId: string, draftId: string, german: string, now: Date): Promise<boolean>;
  /** Moves 'translating' → 'failed'; the old texts stay for a retry. */
  markTranslationFailed(tenantId: string, draftId: string, now: Date): Promise<boolean>;
  /** Stores the author's own German text and moves 'failed' → 'ready'. */
  writeGermanByHand(tenantId: string, draftId: string, german: string, now: Date): Promise<boolean>;
  /** Arms reply-based editing; the next text message replaces `target`. */
  setPendingEdit(
    tenantId: string,
    draftId: string,
    target: DraftEditTarget | null,
    now: Date,
  ): Promise<boolean>;
  /**
   * Claims the draft for publishing: moves it to 'publishing' in a single
   * statement if it is 'ready', or if it is stuck in 'publishing' since
   * before `staleBefore` (the background dispatch died). A losing caller gets
   * undefined — a double press or a webhook retry must never dispatch twice
   * (A4).
   */
  claimPublishing(
    tenantId: string,
    draftId: string,
    now: Date,
    staleBefore?: Date,
  ): Promise<StoredDraft | undefined>;
  /** Moves 'publishing' → 'ready' when the dispatch itself failed. */
  revertPublishing(tenantId: string, draftId: string, now: Date): Promise<boolean>;
  /**
   * Replaces one language version with the author's message and disarms the
   * edit. Atomic and guarded on the pending target, so a stray message
   * cannot overwrite an edit meant for the other version.
   */
  replaceText(
    tenantId: string,
    draftId: string,
    target: DraftEditTarget,
    text: string,
    now: Date,
  ): Promise<boolean>;
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
  pending_edit: string | null;
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

const selectDraft = `SELECT tenant_id, id, chat_id, status, texts, photos, version, pending_edit, created_at, updated_at
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
           SET texts = json_set(texts, '$.uk', CASE
                 WHEN json_extract(texts, '$.uk') IS NULL THEN ?
                 ELSE json_extract(texts, '$.uk') || char(10) || char(10) || ?
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
      // The draft id must be a ULID: on publish it becomes the post id and
      // the pipeline's idempotency key, and the publisher refuses non-ULIDs.
      const draft = createDraft(tenantId, newUlid(now), now);
      try {
        await db
          .prepare(
            `INSERT INTO drafts (tenant_id, id, chat_id, status, texts, photos, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, '{}', '[]', 0, ?, ?)`,
          )
          .bind(tenantId, draft.draftId, chatId, draft.state, draft.createdAt, draft.updatedAt)
          .run();
        return { draft, version: 0, pendingEdit: null };
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

    async latestForChat(tenantId, chatId) {
      const row = await db
        .prepare(`${selectDraft} AND chat_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(tenantId, chatId)
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async claimTranslation(tenantId, draftId, from, now, staleBefore) {
      const guards = from.map(() => '?').join(', ');
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'translating', updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ?
             AND (status IN (${guards}) OR (status = 'translating' AND updated_at < ?))`,
        )
        .bind(
          now.toISOString(),
          tenantId,
          draftId,
          ...from,
          (staleBefore ?? staleEpoch).toISOString(),
        )
        .run();
      return result.meta.changes === 1 ? this.get(tenantId, draftId) : undefined;
    },

    async claimPublishing(tenantId, draftId, now, staleBefore) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'publishing', updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ?
             AND (status = 'ready' OR (status = 'publishing' AND updated_at < ?))`,
        )
        .bind(now.toISOString(), tenantId, draftId, (staleBefore ?? staleEpoch).toISOString())
        .run();
      return result.meta.changes === 1 ? this.get(tenantId, draftId) : undefined;
    },

    async revertPublishing(tenantId, draftId, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'ready', updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status = 'publishing'`,
        )
        .bind(now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes === 1;
    },

    async markTranslated(tenantId, draftId, german, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'ready', texts = json_set(texts, '$.de', ?), updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status = 'translating'`,
        )
        .bind(german, now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes === 1;
    },

    async markTranslationFailed(tenantId, draftId, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'failed', updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status = 'translating'`,
        )
        .bind(now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes === 1;
    },

    async writeGermanByHand(tenantId, draftId, german, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'ready', texts = json_set(texts, '$.de', ?), updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status = 'failed'`,
        )
        .bind(german, now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes === 1;
    },

    async setPendingEdit(tenantId, draftId, target, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET pending_edit = ?, updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status IN ('collecting', 'ready')`,
        )
        .bind(target, now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes === 1;
    },

    async replaceText(tenantId, draftId, target, text, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET texts = json_set(texts, ?, ?), pending_edit = NULL, updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ?
             AND pending_edit = ? AND status IN ('collecting', 'ready')`,
        )
        .bind(editJsonPath(target), text, now.toISOString(), tenantId, draftId, target)
        .run();
      return result.meta.changes === 1;
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
    pendingEdit: row.pending_edit === 'uk' || row.pending_edit === 'de' ? row.pending_edit : null,
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
