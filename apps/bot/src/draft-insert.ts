import type { Draft } from '@handmake/core';

/** Return an unexecuted statement so callers can include insertion in a D1 transaction. */
export function draftInsertStatement(
  db: D1Database,
  draft: Draft,
  chatId: string,
  options: { ignoreExisting?: boolean; unopenedWeek?: string; unresultedWeek?: string } = {},
): D1PreparedStatement {
  const guarded = options.unopenedWeek !== undefined;
  return db
    .prepare(
      `INSERT ${options.ignoreExisting ? 'OR IGNORE ' : ''}INTO drafts
       (tenant_id, id, chat_id, status, kind, type, extras, texts, photos, version, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
       ${guarded ? 'WHERE NOT EXISTS (SELECT 1 FROM poll_openings WHERE tenant_id = ? AND week = ?)' : ''}
       ${options.unresultedWeek !== undefined ? `${guarded ? 'AND' : 'WHERE'} NOT EXISTS (SELECT 1 FROM poll_results WHERE tenant_id = ? AND week = ?)` : ''}`,
    )
    .bind(
      draft.tenantId,
      draft.draftId,
      chatId,
      draft.state,
      draft.kind,
      draft.type,
      JSON.stringify(draft.extras),
      JSON.stringify(draft.texts),
      JSON.stringify(draft.photoRefs),
      draft.createdAt,
      draft.updatedAt,
      ...(guarded ? [draft.tenantId, options.unopenedWeek!] : []),
      ...(options.unresultedWeek !== undefined ? [draft.tenantId, options.unresultedWeek] : []),
    );
}
