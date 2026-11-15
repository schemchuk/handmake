import type { AllowList } from './allow-list';

const dayMs = 86400000;
const dayAt = (now: Date, offset = 0) =>
  new Date(now.getTime() + offset * dayMs).toISOString().slice(0, 10);

type Count = { label: string; views: number };
export interface SiteSummary {
  days: number;
  total: number;
  previous: number;
  internal: number;
  sources: Count[];
  pages: Count[];
  countries: Count[];
}

/** Completed UTC days, since the aggregate cannot split the current day by time. */
export async function siteSummary(
  db: D1Database,
  tenant: string,
  now: Date,
  days = 28,
): Promise<SiteSummary> {
  const start = dayAt(now, -days);
  const end = dayAt(now);
  const grouped = async (column: 'source' | 'path' | 'country', limit = '') => {
    const rows = await db
      .prepare(
        `SELECT ${column} AS label, SUM(views) AS views
      FROM site_visits WHERE tenant_id = ? AND day >= ? AND day < ?
      GROUP BY ${column} ORDER BY views DESC, label ASC ${limit}`,
      )
      .bind(tenant, start, end)
      .all<Count>();
    return rows.results;
  };
  const sources = await grouped('source');
  const previous = await db
    .prepare(
      `SELECT COALESCE(SUM(views), 0) AS views
    FROM site_visits WHERE tenant_id = ? AND day >= ? AND day < ?`,
    )
    .bind(tenant, dayAt(now, -2 * days), start)
    .first<{ views: number }>();
  return {
    days,
    total: sources.reduce((sum, row) => sum + row.views, 0),
    previous: previous?.views ?? 0,
    internal: sources.find((row) => row.label === 'internal')?.views ?? 0,
    sources: sources.filter((row) => row.label !== 'internal'),
    pages: await grouped('path', 'LIMIT 5'),
    countries: await grouped('country', 'LIMIT 5'),
  };
}

const sourceNames: Record<string, string> = {
  tg: 'Telegram',
  th: 'Threads',
  ig: 'Instagram',
  fb: 'Facebook',
  gh: 'GitHub',
  li: 'LinkedIn',
  nl: 'розсилка',
  qr: 'QR-код',
  search: 'пошуковики',
  direct: 'напряму / без джерела',
};
const sourceName = (label: string) =>
  sourceNames[label] ?? (label.startsWith('other:') ? label.slice(6) : label);

export function formatSiteStats(s: SiteSummary): string {
  const external = s.total - s.internal;
  const lines = [
    `Сайт (${s.days} днів)`,
    'Завершені дні, UTC',
    `Перегляди: ${s.total}`,
    `Попередні ${s.days} днів: ${s.previous}`,
    `Переходи всередині сайту: ${s.internal}`,
  ];
  if (!s.total) lines.push('За цей період переглядів немає.');
  else {
    lines.push('Джерела (без переходів всередині сайту):');
    lines.push(
      ...s.sources.map(
        (r) => `${sourceName(r.label)}: ${r.views} (${((100 * r.views) / external).toFixed(1)}%)`,
      ),
    );
    if (!s.sources.length) lines.push('Зовнішніх переходів немає.');
    lines.push('Топ 5 сторінок:', ...s.pages.map((r) => `${r.label}: ${r.views}`));
    lines.push('Топ 5 країн:', ...s.countries.map((r) => `${r.label}: ${r.views}`));
  }
  return lines.join('\n');
}

/** Keep every source while respecting Telegram's message length limit. */
export function reportMessages(text: string): string[] {
  const messages: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > 4000) {
      messages.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) messages.push(current);
  return messages;
}

function isoWeek(now: Date): string {
  const date = new Date(`${dayAt(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / dayMs + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export async function runSiteStatsCron(
  db: D1Database,
  now: Date,
  allowList: AllowList,
  send: (chat: number, text: string) => Promise<unknown>,
): Promise<void> {
  await db.prepare('DELETE FROM site_visits WHERE day < ?').bind(dayAt(now, -400)).run();
  if (now.getUTCDay() !== 1) return;
  const week = isoWeek(now);
  for (const tenant of new Set(allowList.values())) {
    try {
      const report = reportMessages(formatSiteStats(await siteSummary(db, tenant, now, 7)));
      // Claim before external delivery: an ambiguous Telegram failure must not
      // duplicate a report on retry. A failed/partial send waits for next week.
      const claim = await db
        .prepare(
          `INSERT INTO site_stats_reports (tenant_id, week)
        VALUES (?, ?) ON CONFLICT (tenant_id) DO UPDATE SET week = excluded.week
        WHERE site_stats_reports.week < excluded.week`,
        )
        .bind(tenant, week)
        .run();
      if (!claim.meta.changes) continue;
      for (const [chat, chatTenant] of allowList) {
        if (chatTenant !== tenant) continue;
        try {
          for (const message of report) await send(chat, message);
        } catch {
          console.error('Site weekly report delivery failed');
        }
      }
    } catch {
      console.error('Site weekly report failed');
    }
  }
}
