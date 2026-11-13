/** Tenant-scoped, anonymous workflow metrics, independent of draft retention. */
export interface UsageSummary {
  published: number;
  measured: number;
  medianMinutes: number | null;
  editsPerPost: number | null;
  deliverySuccessRate: number | null;
}

export async function usageSummary(
  db: D1Database,
  tenant: string,
  now: Date,
): Promise<UsageSummary> {
  const end = now.toISOString();
  const start = new Date(now.getTime() - 28 * 86400000).toISOString();
  // A post is published only when every reported channel is done. The latest
  // completion puts it in the rolling window; content dates are not publish times.
  const rows = await db
    .prepare(
      `
    SELECT p.draft_id, COALESCE(MAX(d.observed_at), p.observed_at) AS completed_at,
      u.created_at, u.first_ready_at, u.tracked_from_creation,
      u.uk_edits + u.de_edits + u.regenerations AS edits
    FROM usage_publications p LEFT JOIN usage_deliveries d
      ON d.tenant_id = p.tenant_id AND d.draft_id = p.draft_id
    LEFT JOIN draft_usage u ON u.tenant_id = p.tenant_id AND u.draft_id = p.draft_id
    WHERE p.tenant_id = ?
    GROUP BY p.draft_id
    HAVING (COUNT(d.channel) = 0 OR MIN(d.status = 'done') = 1)
      AND COALESCE(MAX(d.observed_at), p.observed_at) >= ?
      AND COALESCE(MAX(d.observed_at), p.observed_at) < ?
  `,
    )
    .bind(tenant, start, end)
    .all<{
      completed_at: string;
      created_at: string | null;
      first_ready_at: string | null;
      edits: number | null;
      tracked_from_creation: number | null;
    }>();
  const measured = rows.results.filter(
    (r) => r.tracked_from_creation === 1 && r.first_ready_at && r.created_at,
  );
  const durations = measured
    .map((r) => Math.max(0, (Date.parse(r.completed_at) - Date.parse(r.created_at!)) / 60000))
    .sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const delivery = await db
    .prepare(
      `
    SELECT COUNT(*) AS total, COALESCE(SUM(status = 'done'), 0) AS done
    FROM usage_deliveries WHERE tenant_id = ? AND observed_at >= ? AND observed_at < ?
  `,
    )
    .bind(tenant, start, end)
    .first<{ total: number; done: number }>();
  return {
    published: rows.results.length,
    measured: measured.length,
    medianMinutes: durations.length
      ? (durations[middle]! + durations[Math.floor((durations.length - 1) / 2)]!) / 2
      : null,
    editsPerPost: measured.length
      ? measured.reduce((sum, r) => sum + (r.edits ?? 0), 0) / measured.length
      : null,
    deliverySuccessRate: delivery?.total ? delivery.done / delivery.total : null,
  };
}

export function formatUsage(s: UsageSummary): string {
  const number = (n: number | null) => (n === null ? '—' : n.toFixed(1));
  return [
    'Статистика за останні 4 тижні (28 днів, UTC)',
    `Опубліковано: ${s.published}`,
    `Медіана від створення до публікації: ${number(s.medianMinutes)} хв`,
    `Редагувань на публікацію (UA, DE, регенерації): ${number(s.editsPerPost)}`,
    `Успішні доставки: ${number(s.deliverySuccessRate === null ? null : s.deliverySuccessRate * 100)}%`,
    `Публікацій із виміряним процесом: ${s.measured}`,
  ].join('\n');
}
