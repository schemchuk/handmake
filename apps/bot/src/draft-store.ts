import type { PublishJob } from '@handmake/core';
import { createDraft, newUlid, postTypeSchema } from '@handmake/core';
import type { Draft, DraftKind, DraftState } from '@handmake/core';

import { draftInsertStatement } from './draft-insert';

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

/**
 * The chat's explicit flow kind (T25, architecture 4.1.7): which flow the
 * author's messages and commands belong to. Entry sessions (T27) never own a
 * draft; post and work sessions point at their current draft.
 */
export type SessionKind = 'post' | 'entry' | 'work' | 'show';

export interface ChatSession {
  kind: SessionKind;
  /** The session's current draft; null when the session has none. */
  draftId: string | null;
}

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
   * Insert a cron-created draft unless its id already exists (T20): the
   * deterministic id makes an overlapping or retried cron run a no-op, so
   * exactly one announcement/reminder draft exists per meeting day. Returns
   * true when this call inserted the row — only that caller proceeds to
   * translate and notify.
   */
  createIfAbsent(draft: Draft, chatId: string): Promise<boolean>;
  /**
   * Optimistic update: writes the draft only if the row version still
   * matches. Returns false on interference — re-read and retry. Used for
   * whole-state transitions; content collection goes through the atomic
   * statements below instead.
   */
  update(draft: Draft, expectedVersion: number): Promise<boolean>;
  /** Work checkpoints/configuration: CAS protects texts and extras together without a migration. */
  updateWork(draft: Draft, expectedVersion: number): Promise<boolean>;
  freezeShowApproval(
    stored: StoredDraft,
    job: PublishJob,
    approvalChatId: string,
  ): Promise<boolean>;
  updateShow(draft: Draft, expectedVersion: number): Promise<boolean>;
  findShowForChat(tenantId: string, chatId: string): Promise<StoredDraft | undefined>;
  getSessionShow(
    tenantId: string,
    chatId: string,
    draftId: string,
  ): Promise<StoredDraft | undefined>;
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
  findCollectingForChat(
    tenantId: string,
    chatId: string,
    kind: DraftKind,
  ): Promise<StoredDraft | undefined>;
  /** One collecting draft per chat and kind, created on the spot if missing. */
  getOrCreateCollecting(
    tenantId: string,
    chatId: string,
    kind: DraftKind,
    now: Date,
  ): Promise<StoredDraft>;
  /** The chat's session (T25), or undefined when the chat never started one. */
  getChatSession(tenantId: string, chatId: string): Promise<ChatSession | undefined>;
  /** Upserts the chat's session pointer. */
  setChatSession(tenantId: string, chatId: string, session: ChatSession, now: Date): Promise<void>;
  /** The chat's draft with an armed reply-based edit, if one is waiting. */
  findPendingEditForChat(tenantId: string, chatId: string): Promise<StoredDraft | undefined>;
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
    approvalChatId?: string,
  ): Promise<StoredDraft | undefined>;
  /** Moves 'publishing' → 'ready' when the dispatch itself failed. */
  revertPublishing(tenantId: string, draftId: string, now: Date): Promise<boolean>;
  /**
   * Moves 'publishing' → 'published' in one guarded statement when the
   * publisher's callback (T18) confirms delivery. Returns false when the
   * draft is not in 'publishing' — already published, or never dispatched;
   * the callback treats that as a no-op, never an error.
   */
  markPublished(tenantId: string, draftId: string, now: Date): Promise<boolean>;
  /** The chat a draft was started from, for notices after background steps. */
  chatIdOf(tenantId: string, draftId: string): Promise<string | undefined>;
  /**
   * Idempotent index row for a published post (migration 0005). Insert or
   * ignore: a retried or duplicated callback can never index the same post
   * twice. Written even when no draft matches (a post published by hand).
   */
  indexPublished(entry: {
    tenantId: string;
    postId: string;
    publishedAt: string;
    photos: string[];
  }): Promise<void>;
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
  kind: string;
  type: string;
  extras: string;
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

const draftKinds: ReadonlySet<string> = new Set(['post', 'work', 'show']);
const sessionKinds: ReadonlySet<string> = new Set(['post', 'entry', 'work', 'show']);

const selectDraft = `SELECT tenant_id, id, chat_id, status, kind, type, extras, texts, photos, version, pending_edit, created_at, updated_at
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
      await draftInsertStatement(db, draft, chatId).run();
    },

    async createIfAbsent(draft, chatId) {
      const result = await draftInsertStatement(db, draft, chatId, { ignoreExisting: true }).run();
      return result.meta.changes === 1;
    },

    async update(draft, expectedVersion) {
      const result = await db
        .prepare(
          `UPDATE drafts SET status = ?, pending_edit = CASE WHEN ? IN ('collecting', 'ready') THEN pending_edit ELSE NULL END, texts = ?, photos = ?, updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND version = ?`,
        )
        .bind(
          draft.state,
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

    async updateWork(draft, expectedVersion) {
      if (
        draft.kind !== 'work' ||
        !['collecting', 'translating', 'failed', 'ready'].includes(draft.state)
      )
        return false;
      const result = await db
        .prepare(
          `UPDATE drafts SET status = ?, pending_edit = CASE WHEN ? IN ('collecting', 'ready') THEN pending_edit ELSE NULL END, texts = ?, extras = ?, updated_at = ?, version = version + 1
         WHERE tenant_id = ? AND id = ? AND version = ? AND kind = 'work'
           AND status IN ('collecting', 'translating', 'failed', 'ready')`,
        )
        .bind(
          draft.state,
          draft.state,
          JSON.stringify(draft.texts),
          JSON.stringify(draft.extras),
          draft.updatedAt,
          draft.tenantId,
          draft.draftId,
          expectedVersion,
        )
        .run();
      return result.meta.changes === 1;
    },

    async freezeShowApproval(stored, job, approvalChatId) {
      const { draft, version } = stored;
      if (
        draft.kind !== 'show' ||
        job.kind !== 'show' ||
        job.tenantId !== draft.tenantId ||
        job.postId !== draft.draftId
      )
        return false;
      const result = await db
        .prepare(
          `UPDATE drafts
        SET pending_edit = NULL, status = 'publishing', extras = ?, updated_at = ?, version = version + 1
        WHERE tenant_id = ? AND id = ? AND version = ? AND kind = 'show'
        AND status = 'ready' AND json_extract(extras, '$.showCancelled') IS NULL
        AND json_extract(extras, '$.showApproved') IS NULL`,
        )
        .bind(
          JSON.stringify({
            ...draft.extras,
            showApproved: job,
            showApprovalVersion: version,
            approvalChatId,
          }),
          new Date().toISOString(),
          draft.tenantId,
          draft.draftId,
          version,
        )
        .run();
      return result.meta.changes === 1;
    },

    async updateShow(draft, expectedVersion) {
      if (
        draft.kind !== 'show' ||
        !['collecting', 'translating', 'failed', 'ready'].includes(draft.state)
      )
        return false;
      const result = await db
        .prepare(
          `UPDATE drafts SET status = ?, pending_edit = CASE WHEN ? IN ('collecting', 'ready') AND json_extract(?, '$.showCancelled') IS NULL THEN pending_edit ELSE NULL END, texts = ?, extras = ?, updated_at = ?, version = version + 1
         WHERE tenant_id = ? AND id = ? AND version = ? AND kind = 'show'
           AND status IN ('collecting', 'translating', 'failed', 'ready')
           AND json_extract(extras, '$.showApproved') IS NULL`,
        )
        .bind(
          draft.state,
          draft.state,
          JSON.stringify(draft.extras),
          JSON.stringify(draft.texts),
          JSON.stringify(draft.extras),
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
        .prepare("DELETE FROM drafts WHERE tenant_id = ? AND id = ? AND kind != 'show'")
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

    async getSessionShow(tenantId, chatId, draftId) {
      const row = await db
        .prepare(
          `${selectDraft} AND id = ? AND chat_id = ? AND kind = 'show'
         AND EXISTS (SELECT 1 FROM chat_sessions s WHERE s.tenant_id = drafts.tenant_id
           AND s.chat_id = drafts.chat_id AND s.kind = 'show' AND s.draft_id = drafts.id)`,
        )
        .bind(tenantId, draftId, chatId)
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async findShowForChat(tenantId, chatId) {
      const row = await db
        .prepare(
          `${selectDraft} AND chat_id = ? AND kind = 'show'
         AND status IN ('collecting', 'translating', 'failed', 'ready', 'publishing')
         AND json_extract(extras, '$.showCancelled') IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(tenantId, chatId)
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async findCollectingForChat(tenantId, chatId, kind) {
      const row = await db
        .prepare(
          `${selectDraft} AND chat_id = ? AND kind = ? AND status = 'collecting' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(tenantId, chatId, kind)
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async getOrCreateCollecting(tenantId, chatId, kind, now) {
      // The draft id must be a ULID: on publish it becomes the post id and
      // the pipeline's idempotency key, and the publisher refuses non-ULIDs.
      const draft = createDraft(tenantId, newUlid(now), now, { kind });
      try {
        await draftInsertStatement(db, draft, chatId).run();
        return { draft, version: 0, pendingEdit: null };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // Another request created the chat's collecting draft of this kind
        // first; the unique index guarantees it exists (discards between the
        // failed INSERT and this SELECT are a race we accept: the caller's
        // update then fails its version check and retries from a fresh read).
        const existing = await this.findCollectingForChat(tenantId, chatId, kind);
        if (!existing) {
          throw new Error(`no collecting ${kind} draft for chat ${chatId} after unique conflict`);
        }
        return existing;
      }
    },

    async getChatSession(tenantId, chatId) {
      const row = await db
        .prepare('SELECT kind, draft_id FROM chat_sessions WHERE tenant_id = ? AND chat_id = ?')
        .bind(tenantId, chatId)
        .first<{ kind: string; draft_id: string | null }>();
      if (!row) {
        return undefined;
      }
      if (!sessionKinds.has(row.kind)) {
        throw new Error(`chat session has unknown kind "${row.kind}"`);
      }
      return { kind: row.kind as SessionKind, draftId: row.draft_id };
    },

    async setChatSession(tenantId, chatId, session, now) {
      // Switching flows abandons reply-based edits, including edits on older previews.
      // Batch with the pointer update so concurrent messages never see half a hand-off.
      await db.batch([
        db
          .prepare(
            `UPDATE drafts SET pending_edit = NULL, version = version + 1
           WHERE tenant_id = ? AND chat_id = ? AND pending_edit IS NOT NULL
             AND (id != ? OR ? IS NULL)`,
          )
          .bind(tenantId, chatId, session.draftId, session.draftId),
        db
          .prepare(
            `INSERT INTO chat_sessions (tenant_id, chat_id, kind, draft_id, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, chat_id)
           DO UPDATE SET kind = excluded.kind, draft_id = excluded.draft_id, updated_at = excluded.updated_at`,
          )
          .bind(tenantId, chatId, session.kind, session.draftId, now.toISOString()),
      ]);
    },

    async findPendingEditForChat(tenantId, chatId) {
      const row = await db
        .prepare(
          `${selectDraft} AND chat_id = ? AND pending_edit IS NOT NULL AND status IN ('collecting', 'ready')
           AND json_extract(extras, '$.showCancelled') IS NULL ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(tenantId, chatId)
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async claimTranslation(tenantId, draftId, from, now, staleBefore) {
      const guards = from.map(() => '?').join(', ');
      const result = await db
        .prepare(
          `UPDATE drafts
           SET pending_edit = NULL, status = 'translating', updated_at = ?, version = version + 1
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

    async claimPublishing(tenantId, draftId, now, staleBefore, approvalChatId) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET pending_edit = NULL, status = 'publishing', updated_at = ?, version = version + 1,
               extras = CASE WHEN ? IS NULL THEN extras
                 ELSE json_set(extras, '$.approvalChatId', ?) END
           WHERE tenant_id = ? AND id = ?
             AND (status = 'ready' OR (status = 'publishing' AND updated_at < ?))`,
        )
        .bind(
          now.toISOString(),
          approvalChatId ?? null,
          approvalChatId ?? null,
          tenantId,
          draftId,
          (staleBefore ?? staleEpoch).toISOString(),
        )
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

    async markPublished(tenantId, draftId, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET pending_edit = NULL, status = 'published', updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND status = 'publishing'`,
        )
        .bind(now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes === 1;
    },

    async chatIdOf(tenantId, draftId) {
      const row = await db
        .prepare('SELECT chat_id FROM drafts WHERE tenant_id = ? AND id = ?')
        .bind(tenantId, draftId)
        .first<{ chat_id: string }>();
      return row?.chat_id;
    },

    async indexPublished({ tenantId, postId, publishedAt, photos }) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO published_posts (tenant_id, post_id, published_at, photos)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(tenantId, postId, publishedAt, JSON.stringify(photos))
        .run();
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
           SET pending_edit = NULL, status = 'failed', updated_at = ?, version = version + 1
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
        .prepare("DELETE FROM drafts WHERE updated_at < ? AND kind != 'show'")
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
  if (!draftKinds.has(row.kind)) {
    throw new Error(`draft row has unknown kind "${row.kind}"`);
  }
  if (!(postTypeSchema.options as readonly string[]).includes(row.type)) {
    throw new Error(`draft row has unknown type "${row.type}"`);
  }
  return {
    draft: {
      tenantId: row.tenant_id,
      draftId: row.id,
      state: row.status as DraftState,
      kind: row.kind as DraftKind,
      type: row.type as Draft['type'],
      extras: parseExtras(row.extras),
      texts: parseTexts(row.texts),
      photoRefs: parsePhotos(row.photos),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    version: row.version,
    pendingEdit: row.pending_edit === 'uk' || row.pending_edit === 'de' ? row.pending_edit : null,
  };
}

function parseExtras(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('draft row has invalid extras JSON');
  }
  return parsed as Record<string, unknown>;
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
