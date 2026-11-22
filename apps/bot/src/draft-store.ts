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
  /** F42: the slot (UTC ISO) of a draft waiting in the release queue. */
  publishAt?: string;
  /** Failed or lost dispatches of the queued draft so far. */
  queueAttempts?: number;
  /** When GitHub accepted the queue's dispatch of this draft. */
  dispatchedAt?: string;
}

/** What happened to a queued draft whose dispatch failed (T76a). */
export type RequeueOutcome = 'requeued' | 'gave-up' | 'missing';

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
  /** False when the draft is publishing or published (or gone). */
  delete(tenantId: string, draftId: string): Promise<boolean>;
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
  /** F42: `ready` → `scheduled` at `publishAt`; records the approving chat
   * like claimPublishing. `slot-taken` when another work holds the slot. */
  schedule(
    tenantId: string,
    draftId: string,
    publishAt: Date,
    now: Date,
    approvalChatId?: string,
    /** The row version the caller validated; another version is not-ready. */
    expectedVersion?: number,
  ): Promise<'scheduled' | 'not-ready' | 'slot-taken'>;
  /** F42: `scheduled` → `ready`, slot freed; with `version`, only that row
   * version (a stale queue button never moves a newer state). */
  unschedule(tenantId: string, draftId: string, now: Date, version?: number): Promise<boolean>;
  /** Slots held by queued or publishing works (one work per slot). */
  takenSlots(tenantId: string): Promise<Date[]>;
  /** «Зараз» in the queue: the slot of that row version moves to `now`, so
   * the cron dispatches it on its next tick with all of its guards. */
  moveToNow(tenantId: string, draftId: string, version: number, now: Date): Promise<boolean>;
  /** The tenant's queue, earliest slot first. */
  listScheduled(tenantId: string): Promise<StoredDraft[]>;
  /** The next queued draft to dispatch (a due slot or an interrupted claim)
   * and whether a publish run of the tenant is in flight. */
  queueState(tenantId: string, now: Date): Promise<{ next?: StoredDraft; busy: boolean }>;
  /** Atomically claims a due (or interrupted) queued draft as `publishing`;
   * undefined if another tick or the author got there first. */
  claimDue(tenantId: string, draftId: string, now: Date): Promise<StoredDraft | undefined>;
  /** Records that the low-queue note for this draft's dispatch was sent;
   * false when it already was (a re-dispatch after a lost run). */
  claimQueueReminder(tenantId: string, draftId: string): Promise<boolean>;
  /** Takes the queue dispatch lease unless another execution holds an
   * unexpired one. */
  acquireQueueLock(holder: string, now: Date, leaseMs: number): Promise<boolean>;
  releaseQueueLock(holder: string): Promise<void>;
  /** GitHub accepted the dispatch of this claim. */
  markDispatched(tenantId: string, draftId: string, version: number, now: Date): Promise<void>;
  /** A cron dispatch failed: back to `scheduled` (next try after one tick), or
   * after `maxAttempts` failed ticks back to `ready` with the slot freed.
   * `version` is the claim's; a newer claim is never touched. */
  requeueAfterFailure(
    tenantId: string,
    draftId: string,
    version: number,
    now: Date,
    maxAttempts: number,
  ): Promise<RequeueOutcome>;
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
  publish_at: string | null;
  queue_attempts: number;
  dispatched_at: string | null;
  created_at: string;
  updated_at: string;
}

const draftStates: ReadonlySet<string> = new Set([
  'collecting',
  'translating',
  'ready',
  'scheduled',
  'publishing',
  'published',
  'failed',
]);

const draftKinds: ReadonlySet<string> = new Set(['post', 'work', 'show']);
const sessionKinds: ReadonlySet<string> = new Set(['post', 'entry', 'work', 'show']);

const draftColumns =
  'tenant_id, id, chat_id, status, kind, type, extras, texts, photos, version, pending_edit, publish_at, queue_attempts, dispatched_at, created_at, updated_at';
const selectDraft = `SELECT ${draftColumns} FROM drafts WHERE tenant_id = ?`;

/** D1/SQLite report UNIQUE violations with this message; we treat them as
 * expected contention, not errors (the partial unique index on collecting
 * drafts and the processed_updates primary key both rely on it). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

/** A queued draft the cron may claim: a due slot (after any retry wait), a
 * claim that never reached GitHub, or a dispatch whose run never called back
 * (re-dispatching is safe: the publisher skips channels already done). */
const claimable = `(
  (status = 'scheduled' AND COALESCE(retry_at, publish_at) <= ?)
  OR (status = 'publishing' AND publish_at IS NOT NULL AND (
    (dispatched_at IS NULL AND updated_at < ?) OR dispatched_at < ?)))`;
function claimableArgs(now: Date): string[] {
  return [
    now.toISOString(),
    new Date(now.getTime() - queueInterruptedMs).toISOString(),
    new Date(now.getTime() - queueLostRunMs).toISOString(),
  ];
}
/** Columns reset when a draft leaves the release queue. */
const leaveQueue = 'publish_at = NULL, retry_at = NULL, dispatched_at = NULL, queue_attempts = 0';
/** A queued claim not dispatched within this long was interrupted. Longer
 * than any cron invocation (15 min on Cloudflare), so a dispatch still
 * waiting on GitHub is never taken for an interrupted one. */
export const queueInterruptedMs = 20 * 60 * 1000;
/** A publish run younger than this blocks the next queued dispatch. */
export const queueBusyMs = 60 * 60 * 1000;
/** After a failed dispatch the next try waits about one cron tick. */
export const queueRetryMs = 14 * 60 * 1000;
/** A dispatched run with no callback after this long is dispatched again. */
export const queueLostRunMs = 2 * 60 * 60 * 1000;

// D1 meta.changes includes usage-trigger writes. Every guarded mutation below
// targets at most one draft; any positive count proves that mutation won.
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      if (result.meta.changes > 0) {
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
      return result.meta.changes > 0;
    },

    async delete(tenantId, draftId) {
      const result = await db
        // Guarded in SQL as well: the cron may claim a queued draft between the
        // handler's read and this delete (PR #187 review).
        .prepare(
          `DELETE FROM drafts WHERE tenant_id = ? AND id = ? AND kind != 'show'
             AND status NOT IN ('publishing', 'published')`,
        )
        .bind(tenantId, draftId)
        .run();
      return result.meta.changes > 0;
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
      return result.meta.changes > 0 ? this.get(tenantId, draftId) : undefined;
    },

    async claimPublishing(tenantId, draftId, now, staleBefore, approvalChatId) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET pending_edit = NULL, status = 'publishing', updated_at = ?, version = version + 1,
               ${leaveQueue},
               extras = CASE WHEN ? IS NULL THEN extras
                 ELSE json_set(extras, '$.approvalChatId', ?) END
           WHERE tenant_id = ? AND id = ?
             -- A queue-owned claim (publish_at set) is recovered by the queue
             -- only: its dispatch may still be waiting on GitHub (PR #189).
             AND (status = 'ready'
               OR (status = 'publishing' AND publish_at IS NULL AND updated_at < ?))`,
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
      return result.meta.changes > 0 ? this.get(tenantId, draftId) : undefined;
    },

    async revertPublishing(tenantId, draftId, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'ready', updated_at = ?, version = version + 1, ${leaveQueue}
           WHERE tenant_id = ? AND id = ? AND status = 'publishing'`,
        )
        .bind(now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes > 0;
    },

    async markPublished(tenantId, draftId, now) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET pending_edit = NULL, status = 'published', updated_at = ?, version = version + 1,
               ${leaveQueue}
           WHERE tenant_id = ? AND id = ?
             -- The callback reports a finished run, which is the truth: a
             -- dispatch accepted by GitHub whose response was lost left the
             -- draft requeued ('scheduled') or reverted ('ready').
             AND status IN ('publishing', 'scheduled', 'ready')`,
        )
        .bind(now.toISOString(), tenantId, draftId)
        .run();
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
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
      return result.meta.changes > 0;
    },

    async deleteOlderThan(cutoff) {
      const result = await db
        // A queued draft waits for its slot, however long the queue is.
        .prepare(
          "DELETE FROM drafts WHERE updated_at < ? AND kind != 'show' AND status != 'scheduled'",
        )
        .bind(cutoff.toISOString())
        .run();
      return result.meta.changes;
    },

    async schedule(tenantId, draftId, publishAt, now, approvalChatId, expectedVersion) {
      try {
        const result = await db
          .prepare(
            `UPDATE drafts
             SET pending_edit = NULL, status = 'scheduled', publish_at = ?, retry_at = NULL,
                 dispatched_at = NULL, queue_attempts = 0, updated_at = ?, version = version + 1,
                 -- A new queueing earns its own low-queue note.
                 extras = CASE WHEN ? IS NULL THEN json_remove(extras, '$.queueReminded')
                   ELSE json_set(json_remove(extras, '$.queueReminded'), '$.approvalChatId', ?) END
             WHERE tenant_id = ? AND id = ? AND status = 'ready'
               AND (? IS NULL OR version = ?)`,
          )
          .bind(
            publishAt.toISOString(),
            now.toISOString(),
            approvalChatId ?? null,
            approvalChatId ?? null,
            tenantId,
            draftId,
            expectedVersion ?? null,
            expectedVersion ?? null,
          )
          .run();
        return result.meta.changes > 0 ? 'scheduled' : 'not-ready';
      } catch (error) {
        // idx_drafts_one_per_slot: a racing approval took this slot.
        if (isUniqueViolation(error)) return 'slot-taken';
        throw error;
      }
    },

    async unschedule(tenantId, draftId, now, version) {
      const result = await db
        .prepare(
          `UPDATE drafts
           SET status = 'ready', updated_at = ?, version = version + 1, ${leaveQueue}
           WHERE tenant_id = ? AND id = ? AND status = 'scheduled'
             AND (? IS NULL OR version = ?)`,
        )
        .bind(now.toISOString(), tenantId, draftId, version ?? null, version ?? null)
        .run();
      return result.meta.changes > 0;
    },

    async takenSlots(tenantId) {
      const { results } = await db
        .prepare(
          `SELECT publish_at FROM drafts WHERE tenant_id = ?
             AND status IN ('scheduled', 'publishing') AND publish_at IS NOT NULL`,
        )
        .bind(tenantId)
        .all<{ publish_at: string }>();
      return results.map((row) => new Date(row.publish_at));
    },

    async moveToNow(tenantId, draftId, version, now) {
      // Another work may hold this exact instant (a slot at :30:00.000):
      // take the next millisecond instead of reporting a stale button.
      for (let offset = 0; offset < 5; offset++) {
        const at = new Date(now.getTime() + offset).toISOString();
        try {
          const result = await db
            .prepare(
              `UPDATE drafts
               SET publish_at = ?, retry_at = NULL, updated_at = ?, version = version + 1
               WHERE tenant_id = ? AND id = ? AND status = 'scheduled' AND version = ?`,
            )
            .bind(at, now.toISOString(), tenantId, draftId, version)
            .run();
          return result.meta.changes > 0;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
      return false;
    },

    async listScheduled(tenantId) {
      const { results } = await db
        .prepare(`${selectDraft} AND status = 'scheduled' ORDER BY publish_at, id`)
        .bind(tenantId)
        .all<DraftRow>();
      return results.map(toStoredDraft);
    },

    async queueState(tenantId, now) {
      const next = await db
        .prepare(`${selectDraft} AND ${claimable} ORDER BY publish_at, id LIMIT 1`)
        .bind(tenantId, ...claimableArgs(now))
        .first<DraftRow>();
      // A run in flight (or a dispatch another execution is making right
      // now): a second dispatch would replace its pending run in the shared
      // `publish` concurrency group, so the queue waits. Repository-wide,
      // not per tenant: the group is shared by every tenant (T76c dropped).
      const busy = await db
        .prepare(
          `SELECT 1 AS busy FROM drafts WHERE status = 'publishing'
             AND updated_at >= ?
             AND NOT (publish_at IS NOT NULL AND dispatched_at IS NULL AND updated_at < ?)
           LIMIT 1`,
        )
        .bind(
          new Date(now.getTime() - queueBusyMs).toISOString(),
          new Date(now.getTime() - queueInterruptedMs).toISOString(),
        )
        .first();
      return { next: next ? toStoredDraft(next) : undefined, busy: !!busy };
    },

    async claimDue(tenantId, draftId, now) {
      // RETURNING: the row exactly as this claim left it, never a later
      // writer's (PR #187 review).
      const row = await db
        .prepare(
          `UPDATE drafts
           SET status = 'publishing', dispatched_at = NULL, updated_at = ?, version = version + 1,
               queue_attempts = queue_attempts
                 + CASE WHEN status = 'publishing' AND dispatched_at IS NOT NULL THEN 1 ELSE 0 END
           WHERE tenant_id = ? AND id = ? AND ${claimable}
           RETURNING ${draftColumns}`,
        )
        .bind(now.toISOString(), tenantId, draftId, ...claimableArgs(now))
        .first<DraftRow>();
      return row ? toStoredDraft(row) : undefined;
    },

    async acquireQueueLock(holder, now, leaseMs) {
      const result = await db
        .prepare(
          `INSERT INTO queue_dispatch_lock (id, holder, held_until) VALUES (1, ?, ?)
           ON CONFLICT (id) DO UPDATE SET holder = excluded.holder, held_until = excluded.held_until
           WHERE queue_dispatch_lock.held_until < ?`,
        )
        .bind(holder, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString())
        .run();
      return result.meta.changes > 0;
    },

    async releaseQueueLock(holder) {
      await db
        .prepare(`UPDATE queue_dispatch_lock SET held_until = '' WHERE id = 1 AND holder = ?`)
        .bind(holder)
        .run();
    },

    async claimQueueReminder(tenantId, draftId) {
      const result = await db
        .prepare(
          `UPDATE drafts SET extras = json_set(extras, '$.queueReminded', json('true'))
           WHERE tenant_id = ? AND id = ?
             AND COALESCE(json_extract(extras, '$.queueReminded'), 0) = 0`,
        )
        .bind(tenantId, draftId)
        .run();
      return result.meta.changes > 0;
    },

    async markDispatched(tenantId, draftId, version, now) {
      await db
        .prepare(
          `UPDATE drafts SET dispatched_at = ?
           WHERE tenant_id = ? AND id = ? AND version = ? AND status = 'publishing'`,
        )
        .bind(now.toISOString(), tenantId, draftId, version)
        .run();
    },

    async requeueAfterFailure(tenantId, draftId, version, now, maxAttempts) {
      // Guarded by the claim's version: a manual 🚀 that took over meanwhile
      // bumped it, and its attempt is never touched here.
      const requeued = await db
        .prepare(
          `UPDATE drafts
           SET status = 'scheduled', queue_attempts = queue_attempts + 1, retry_at = ?,
               updated_at = ?, version = version + 1
           WHERE tenant_id = ? AND id = ? AND version = ? AND status = 'publishing'
             AND publish_at IS NOT NULL AND queue_attempts + 1 < ?`,
        )
        .bind(
          new Date(now.getTime() + queueRetryMs).toISOString(),
          now.toISOString(),
          tenantId,
          draftId,
          version,
          maxAttempts,
        )
        .run();
      if (requeued.meta.changes > 0) return 'requeued';
      const gaveUp = await db
        .prepare(
          `UPDATE drafts
           SET status = 'ready', updated_at = ?, version = version + 1, ${leaveQueue}
           WHERE tenant_id = ? AND id = ? AND version = ? AND status = 'publishing'
             AND publish_at IS NOT NULL`,
        )
        .bind(now.toISOString(), tenantId, draftId, version)
        .run();
      return gaveUp.meta.changes > 0 ? 'gave-up' : 'missing';
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
    ...(row.publish_at ? { publishAt: row.publish_at, queueAttempts: row.queue_attempts } : {}),
    ...(row.dispatched_at ? { dispatchedAt: row.dispatched_at } : {}),
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
