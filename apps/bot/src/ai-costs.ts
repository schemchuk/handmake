import { botTexts } from './texts';
import { zonedTimeToUtc } from './announcements';

export interface AiCost {
  id: string;
  at: Date;
  service: string;
  unit: string;
  amountEur: number;
  /** `show:<id>` for shows, `post:<id>` for translations of regular posts. */
  ref: string;
}

export function costMonth(now: Date, offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => Number(parts.find((p) => p.type === name)!.value);
  const wall = new Date(Date.UTC(part('year'), part('month') - 1 + offset, 1));
  const next = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1));
  return {
    key: wall.toISOString().slice(0, 7),
    firstDay: part('day') === 1,
    start: zonedTimeToUtc(wall, 'Europe/Berlin').toISOString(),
    end: zonedTimeToUtc(next, 'Europe/Berlin').toISOString(),
  };
}

export function createAiCostLedger(db: D1Database) {
  return {
    /** Deduplicates caller-supplied (id, unit), never the post reference. */
    async recordCost(tenantId: string, cost: AiCost) {
      if (!Number.isFinite(cost.amountEur) || cost.amountEur < 0) {
        throw new Error('AI cost must be a finite non-negative EUR amount');
      }
      const { id, at, service, unit, amountEur, ref } = cost;
      await db
        .prepare(
          `INSERT OR IGNORE INTO ai_costs
        (tenant_id, id, at, service, unit, amount_eur, ref) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(tenantId, id, at.toISOString(), service, unit, amountEur, ref)
        .run();
    },
    async summary(tenantId: string, now: Date, offset = 0) {
      const month = costMonth(now, offset);
      const { results } = await db
        .prepare(
          `SELECT service, ref, SUM(amount_eur) AS amount
        FROM ai_costs WHERE tenant_id = ? AND at >= ? AND at < ? GROUP BY service, ref`,
        )
        .bind(tenantId, month.start, month.end)
        .all<{ service: string; ref: string; amount: number }>();
      const services: Record<string, number> = {};
      const shows: Record<string, number> = {};
      let total = 0;
      for (const row of results) {
        total += row.amount;
        services[row.service] = (services[row.service] ?? 0) + row.amount;
        if (row.ref.startsWith('show:')) shows[row.ref] = (shows[row.ref] ?? 0) + row.amount;
      }
      return { month: month.key, total: Number(total.toFixed(9)), services, shows };
    },
    async claimNotice(tenantId: string, notice: string) {
      const result = await db
        .prepare('INSERT OR IGNORE INTO ai_cost_notices (tenant_id, notice) VALUES (?, ?)')
        .bind(tenantId, notice)
        .run();
      return result.meta.changes > 0;
    },
    async releaseNotice(tenantId: string, notice: string) {
      await db
        .prepare('DELETE FROM ai_cost_notices WHERE tenant_id = ? AND notice = ?')
        .bind(tenantId, notice)
        .run();
    },
  };
}

export type AiCostLedger = ReturnType<typeof createAiCostLedger>;
export interface AiBudget {
  monthlyTargetEur: number;
  toleranceEur: number;
}

export async function assertCanStartShow(
  ledger: AiCostLedger,
  tenantId: string,
  budget: AiBudget,
  now = new Date(),
) {
  const { total } = await ledger.summary(tenantId, now);
  if (total >= budget.monthlyTargetEur + budget.toleranceEur) {
    throw new Error(botTexts.costLimitText);
  }
}

export function formatCosts(
  summary: Awaited<ReturnType<AiCostLedger['summary']>>,
  budget: AiBudget,
) {
  return botTexts.costReport(summary, budget);
}
