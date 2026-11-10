import type { CommentDraft } from '@handmake/core';

/**
 * D1 persistence for the F34 comment inbox (T49c, ADR 006: every query is
 * keyed by tenant_id). Reader personal data (handle, text, drafts) lives
 * only here and in Telegram — never in Git or logs — and rows are deleted 30
 * days after creation by the cleanup cron (wired in T49c2b).
 *
 * Concurrency: whole-state transitions are single guarded UPDATE statements
 * (claim*), so overlapping cron ticks and (from T49c3) racing button presses
 * serialize at SQLite. Notification must be reserved before the external send;
 * uncertain deliveries and paid calls require operator reconciliation. Watermarks
 * are monotonic and inclusive; the collector owns safe pagination advancement.
 */

export const commentRetentionDays = 30;
export const commentReplyLimit = 2200;

/** Networks the comment pipeline collects; the drafter accepts exactly these. */
export type CommentNetwork = 'instagram' | 'facebook' | 'threads';

export type CommentStatus = 'new' | 'drafting' | 'drafted' | 'sending' | 'sent' | 'skipped';

export interface NewComment {
  tenantId: string;
  network: CommentNetwork;
  /** The comment's id at the network. */
  id: string;
  /** The id of our post the comment is on (at the network). */
  postId: string;
  handle: string;
  text: string;
  /** Creation instant reported by the network ('' when absent). */
  commentCreatedAt: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredComment {
  tenantId: string;
  network: CommentNetwork;
  id: string;
  postId: string;
  handle: string;
  text: string;
  status: CommentStatus;
  translationUk: string | null;
  replyDe: string | null;
  notesUk: string | null;
  notifiedAt: string | null;
  commentCreatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentStore {
  get(tenantId: string, network: CommentNetwork, id: string): Promise<StoredComment | null>;
  transition(
    tenantId: string,
    network: CommentNetwork,
    id: string,
    from: CommentStatus,
    to: CommentStatus,
    now: Date,
  ): Promise<StoredComment | null>;
  armEdit(
    tenantId: string,
    network: CommentNetwork,
    id: string,
    chatId: string,
    now: Date,
  ): Promise<boolean>;
  applyEdit(
    tenantId: string,
    chatId: string,
    text: string,
    now: Date,
  ): Promise<StoredComment | null>;
  /** Terminal quarantine: never automatically resend a possibly delivered reply. */
  reclaimSending(tenantId: string, cutoff: Date, now: Date): Promise<number>;
  /**
   * Inserts a freshly collected comment unless it is already known (INSERT OR
   * IGNORE on the primary key). A repeat is never an error: the watermark is
   * inclusive exactly so retries re-fetch known ids.
   */
  collect(comment: NewComment): Promise<boolean>;
  /**
   * 'new' → 'drafting' in one guarded statement; false means someone else
   * claimed it or it is past drafting. Ambiguous paid calls are not reclaimed
   * automatically: a crashed drafter requires operator reconciliation.
   */
  claimDrafting(tenantId: string, network: CommentNetwork, id: string, now: Date): Promise<boolean>;
  /** 'drafting' → 'new' when drafting failed; the next tick retries the paid call. */
  reopenDrafting(
    tenantId: string,
    network: CommentNetwork,
    id: string,
    now: Date,
  ): Promise<boolean>;
  /** 'drafting' → 'drafted' with the drafter's output; false when not 'drafting'. */
  storeDraft(
    tenantId: string,
    network: CommentNetwork,
    id: string,
    draft: CommentDraft,
    now: Date,
  ): Promise<boolean>;
  /** Persisted new rows, including failed drafts, independent of the API watermark. */
  listPendingDrafts(tenantId: string, network: CommentNetwork): Promise<StoredComment[]>;
  /** Drafted rows whose delivery has not been reserved yet. */
  listPendingNotify(tenantId: string): Promise<StoredComment[]>;
  /**
   * Reserves delivery before calling Telegram; false means another tick won.
   * Ambiguous delivery is not retried automatically, preserving at-most-once.
   */
  markNotified(tenantId: string, network: CommentNetwork, id: string, now: Date): Promise<boolean>;
  /** Release only a confirmed rejection; never use for ambiguous Telegram delivery. */
  reopenNotification(
    tenantId: string,
    network: CommentNetwork,
    id: string,
    claimedAt: Date,
    now?: Date,
  ): Promise<boolean>;
  /** Counts stale paid calls only; notification delivery cannot be reconciled here. */
  countUncertain(tenantId: string, cutoff: Date): Promise<{ drafting: number }>;
  getWatermark(tenantId: string, network: CommentNetwork): Promise<Date | undefined>;
  setWatermark(
    tenantId: string,
    network: CommentNetwork,
    watermark: Date,
    now: Date,
  ): Promise<void>;
  /** Delete rows created before the cutoff; returns the row count. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

const selectComment = `SELECT tenant_id AS tenantId, network, id, post_id AS postId,
  handle, text, status, translation_uk AS translationUk, reply_de AS replyDe,
  notes_uk AS notesUk, notified_at AS notifiedAt, comment_created_at AS commentCreatedAt,
  created_at AS createdAt, updated_at AS updatedAt FROM comments WHERE tenant_id = ?`;

export function createCommentStore(db: D1Database): CommentStore {
  const returning = `RETURNING tenant_id AS tenantId, network, id, post_id AS postId,
    handle, text, status, translation_uk AS translationUk, reply_de AS replyDe,
    notes_uk AS notesUk, notified_at AS notifiedAt, comment_created_at AS commentCreatedAt,
    created_at AS createdAt, updated_at AS updatedAt`;
  return {
    async get(tenantId, network, id) {
      return db
        .prepare(`${selectComment} AND network = ? AND id = ?`)
        .bind(tenantId, network, id)
        .first<StoredComment>();
    },
    async transition(tenantId, network, id, from, to, now) {
      // Keep the id tombstone until retention expires, but erase handled reader data.
      const erase = to === 'sent' || to === 'skipped';
      return db
        .prepare(
          `UPDATE comments SET status = ?, updated_at = ?,
        edit_chat_id = NULL, edit_expires_at = NULL
        ${erase ? ", handle = '', text = '', translation_uk = NULL, reply_de = NULL, notes_uk = NULL" : ''}
        WHERE tenant_id = ? AND network = ? AND id = ? AND status = ? ${returning}`,
        )
        .bind(to, now.toISOString(), tenantId, network, id, from)
        .first<StoredComment>();
    },
    async armEdit(tenantId, network, id, chatId, now) {
      const results = await db.batch([
        db
          .prepare(
            'UPDATE comments SET edit_chat_id = NULL, edit_expires_at = NULL WHERE tenant_id = ? AND edit_chat_id = ?',
          )
          .bind(tenantId, chatId),
        db
          .prepare(
            `UPDATE comments SET edit_chat_id = ?, edit_expires_at = ?, updated_at = ?
          WHERE tenant_id = ? AND network = ? AND id = ? AND status = 'drafted'`,
          )
          .bind(
            chatId,
            new Date(now.getTime() + 1800000).toISOString(),
            now.toISOString(),
            tenantId,
            network,
            id,
          ),
      ]);
      return results[1]!.meta.changes === 1;
    },
    async applyEdit(tenantId, chatId, text, now) {
      return db
        .prepare(
          `UPDATE comments SET reply_de = ?, edit_chat_id = NULL,
        edit_expires_at = NULL, updated_at = ? WHERE tenant_id = ? AND edit_chat_id = ?
        AND edit_expires_at > ? AND status = 'drafted' ${returning}`,
        )
        .bind(
          text.slice(0, commentReplyLimit).replace(/[\uD800-\uDBFF]$/u, ''),
          now.toISOString(),
          tenantId,
          chatId,
          now.toISOString(),
        )
        .first<StoredComment>();
    },
    async reclaimSending(tenantId, cutoff, now) {
      const result = await db
        .prepare(
          `UPDATE comments SET status = 'skipped', updated_at = ?,
        handle = '', text = '', translation_uk = NULL, reply_de = NULL, notes_uk = NULL,
        edit_chat_id = NULL, edit_expires_at = NULL
        WHERE tenant_id = ? AND status = 'sending' AND updated_at < ?`,
        )
        .bind(now.toISOString(), tenantId, cutoff.toISOString())
        .run();
      return result.meta.changes;
    },
    async collect(comment) {
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO comments
           (tenant_id, network, id, post_id, handle, text, status, comment_created_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
        )
        .bind(
          comment.tenantId,
          comment.network,
          comment.id,
          comment.postId,
          comment.handle,
          comment.text,
          comment.commentCreatedAt,
          comment.createdAt.toISOString(),
          comment.updatedAt.toISOString(),
        )
        .run();
      return result.meta.changes === 1;
    },

    async claimDrafting(tenantId, network, id, now) {
      const result = await db
        .prepare(
          `UPDATE comments SET status = 'drafting', updated_at = ?
           WHERE tenant_id = ? AND network = ? AND id = ? AND status = 'new'`,
        )
        .bind(now.toISOString(), tenantId, network, id)
        .run();
      return result.meta.changes === 1;
    },

    async reopenDrafting(tenantId, network, id, now) {
      const result = await db
        .prepare(
          `UPDATE comments SET status = 'new', updated_at = ?
           WHERE tenant_id = ? AND network = ? AND id = ? AND status = 'drafting'`,
        )
        .bind(now.toISOString(), tenantId, network, id)
        .run();
      return result.meta.changes === 1;
    },

    async storeDraft(tenantId, network, id, draft, now) {
      const result = await db
        .prepare(
          `UPDATE comments
           SET status = 'drafted', translation_uk = ?, reply_de = ?, notes_uk = ?, updated_at = ?
           WHERE tenant_id = ? AND network = ? AND id = ? AND status = 'drafting'`,
        )
        .bind(
          draft.translationUk,
          draft.replyDe,
          draft.notesUk,
          now.toISOString(),
          tenantId,
          network,
          id,
        )
        .run();
      return result.meta.changes === 1;
    },

    async listPendingDrafts(tenantId, network) {
      const result = await db
        .prepare(`${selectComment} AND network = ? AND status = 'new' ORDER BY created_at`)
        .bind(tenantId, network)
        .all<StoredComment>();
      return result.results ?? [];
    },

    async listPendingNotify(tenantId) {
      const result = await db
        .prepare(
          `${selectComment} AND status = 'drafted' AND notified_at IS NULL ORDER BY created_at`,
        )
        .bind(tenantId)
        .all<StoredComment>();
      return result.results ?? [];
    },

    async markNotified(tenantId, network, id, now) {
      const result = await db
        .prepare(
          `UPDATE comments SET notified_at = ?, updated_at = ?
           WHERE tenant_id = ? AND network = ? AND id = ? AND status = 'drafted' AND notified_at IS NULL`,
        )
        .bind(now.toISOString(), now.toISOString(), tenantId, network, id)
        .run();
      return result.meta.changes === 1;
    },

    async reopenNotification(tenantId, network, id, claimedAt, now = new Date()) {
      const result = await db
        .prepare(
          `UPDATE comments SET notified_at = NULL, updated_at = ?
        WHERE tenant_id = ? AND network = ? AND id = ? AND status = 'drafted' AND notified_at = ?`,
        )
        .bind(now.toISOString(), tenantId, network, id, claimedAt.toISOString())
        .run();
      return result.meta.changes === 1;
    },

    async countUncertain(tenantId, cutoff) {
      const row = await db
        .prepare(
          `SELECT
        COUNT(CASE WHEN status = 'drafting' THEN 1 END) AS drafting
        FROM comments WHERE tenant_id = ? AND updated_at < ?`,
        )
        .bind(tenantId, cutoff.toISOString())
        .first<{ drafting: number }>();
      return row ?? { drafting: 0 };
    },

    async getWatermark(tenantId, network) {
      const row = await db
        .prepare('SELECT watermark FROM comment_watermarks WHERE tenant_id = ? AND network = ?')
        .bind(tenantId, network)
        .first<{ watermark: string }>();
      if (!row) return undefined;
      const watermark = Date.parse(row.watermark);
      return Number.isNaN(watermark) ? undefined : new Date(watermark);
    },

    async setWatermark(tenantId, network, watermark, now) {
      await db
        .prepare(
          `INSERT INTO comment_watermarks (tenant_id, network, watermark, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (tenant_id, network)
           DO UPDATE SET watermark = excluded.watermark, updated_at = excluded.updated_at
           WHERE excluded.watermark > comment_watermarks.watermark`,
        )
        .bind(tenantId, network, watermark.toISOString(), now.toISOString())
        .run();
    },

    async deleteOlderThan(cutoff) {
      const result = await db
        .prepare('DELETE FROM comments WHERE created_at < ?')
        .bind(cutoff.toISOString())
        .run();
      return result.meta.changes;
    },
  };
}
