import type { Draft, DraftState, DraftStore } from '@handmake/core';

/**
 * D1 implementation of the core DraftStore port (ADR 006: every query is
 * keyed by tenant_id). Rows carry the content columns added in migration
 * 0002: `texts` (JSON object) and `photos` (JSON array of Telegram file_ids).
 *
 * The port's `save` knows nothing about chats, but D1 rows key collection by
 * `chat_id` (migration 0001). So inserts go through `create` with the chat,
 * and `save` updates the content of an existing row (a draft never changes
 * chats).
 */

export interface D1DraftStore extends DraftStore {
  /** Insert a new draft, remembering which chat is collecting it. */
  create(draft: Draft, chatId: string): Promise<void>;
  /** The one draft this chat may still add content to, if any. */
  findCollectingForChat(tenantId: string, chatId: string): Promise<Draft | undefined>;
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

export function createD1DraftStore(db: D1Database): D1DraftStore {
  return {
    async get(tenantId, draftId) {
      const row = await db
        .prepare(`${selectDraft} AND id = ?`)
        .bind(tenantId, draftId)
        .first<DraftRow>();
      return row ? toDraft(row) : undefined;
    },

    async create(draft, chatId) {
      await db
        .prepare(
          `INSERT INTO drafts (tenant_id, id, chat_id, status, texts, photos, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

    async save(draft) {
      const result = await db
        .prepare(
          `UPDATE drafts SET status = ?, texts = ?, photos = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
        )
        .bind(
          draft.state,
          JSON.stringify(draft.texts),
          JSON.stringify(draft.photoRefs),
          draft.updatedAt,
          draft.tenantId,
          draft.draftId,
        )
        .run();
      if (result.meta.changes === 0) {
        throw new Error(`draft ${draft.tenantId}/${draft.draftId} does not exist; use create`);
      }
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
      return (result.results ?? []).map(toDraft);
    },

    async findCollectingForChat(tenantId, chatId) {
      const row = await db
        .prepare(
          `${selectDraft} AND chat_id = ? AND status = 'collecting' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(tenantId, chatId)
        .first<DraftRow>();
      return row ? toDraft(row) : undefined;
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

const selectDraft = `SELECT tenant_id, id, chat_id, status, texts, photos, created_at, updated_at
  FROM drafts WHERE tenant_id = ?`;

function toDraft(row: DraftRow): Draft {
  if (!draftStates.has(row.status)) {
    throw new Error(`draft row has unknown status "${row.status}"`);
  }
  return {
    tenantId: row.tenant_id,
    draftId: row.id,
    state: row.status as DraftState,
    texts: parseTexts(row.texts),
    photoRefs: parsePhotos(row.photos),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
