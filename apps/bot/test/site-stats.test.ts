import { expect, it, vi } from 'vitest';
import { formatSiteStats, reportMessages, runSiteStatsCron, siteSummary } from '../src/site-stats';
import { makeD1 } from './helpers';

const monday = new Date('2027-01-04T03:29:00Z');
async function visit(
  db: D1Database,
  day: string,
  source = 'tg',
  views = 1,
  tenant = 'one',
  path = '/',
  country = 'DE',
) {
  await db
    .prepare('INSERT INTO site_visits VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tenant, day, path, source, country, views)
    .run();
}

it('aggregates completed UTC windows, sorted sources, percentages and tenant isolation', async () => {
  const db = await makeD1();
  await visit(db, '2026-12-07', 'tg', 6);
  await visit(db, '2027-01-03', 'internal', 2);
  await visit(db, '2027-01-03', 'direct', 2);
  await visit(db, '2026-11-09', 'tg', 4);
  await visit(db, '2026-12-06', 'tg', 3);
  await visit(db, '2026-11-08', 'tg', 100);
  await visit(db, '2027-01-04', 'tg', 100);
  await visit(db, '2027-01-03', 'tg', 100, 'other');
  const summary = await siteSummary(db, 'one', monday);
  expect(summary).toEqual({
    days: 28,
    total: 10,
    previous: 7,
    internal: 2,
    sources: [
      { label: 'tg', views: 6 },
      { label: 'direct', views: 2 },
    ],
    pages: [{ label: '/', views: 10 }],
    countries: [{ label: 'DE', views: 10 }],
  });
  expect(formatSiteStats(summary)).toContain('Telegram: 6 (75.0%)');
  expect(formatSiteStats(summary)).toContain('напряму / без джерела: 2 (25.0%)');
  expect(formatSiteStats(summary)).toContain('Переходи всередині сайту: 2');
  expect(formatSiteStats(await siteSummary(db, 'empty', monday))).toContain(
    'За цей період переглядів немає.',
  );
  const weekly = await siteSummary(db, 'one', monday, 7);
  expect(weekly).toMatchObject({ total: 4, previous: 0, days: 7 });
});

it('limits pages and countries to five with deterministic ties and handles internal-only views', async () => {
  const db = await makeD1();
  for (let i = 0; i < 7; i++)
    await visit(db, '2027-01-03', 'internal', 1, 'one', `/page${i}`, `X${i}`);
  const summary = await siteSummary(db, 'one', monday);
  expect(summary.pages.map((r) => r.label)).toEqual([
    '/page0',
    '/page1',
    '/page2',
    '/page3',
    '/page4',
  ]);
  expect(summary.countries).toHaveLength(5);
  expect(formatSiteStats(summary)).toContain('Зовнішніх переходів немає.');
  expect(formatSiteStats(summary)).not.toContain('NaN');
});

it('sends on Monday once per tenant and ISO week, including concurrent retries and year boundaries', async () => {
  const db = await makeD1();
  const list = new Map([
    [11, 'one'],
    [12, 'one'],
    [21, 'two'],
  ]);
  const send = vi.fn().mockResolvedValue(undefined);
  await visit(db, '2027-01-03', 'tg', 8);
  await visit(db, '2027-01-03', 'direct', 3, 'two');
  await runSiteStatsCron(db, new Date('2027-01-03T03:29:00Z'), list, send);
  expect(send).not.toHaveBeenCalled();
  await Promise.all([
    runSiteStatsCron(db, monday, list, send),
    runSiteStatsCron(db, monday, list, send),
  ]);
  expect(send).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenCalledWith(11, expect.stringContaining('Перегляди: 8'));
  expect(send).toHaveBeenCalledWith(12, expect.stringContaining('Сайт (7 днів)'));
  expect(send).toHaveBeenCalledWith(21, expect.stringContaining('Перегляди: 3'));
  expect((await db.prepare('SELECT week FROM site_stats_reports').all()).results).toEqual([
    { week: '2027-W01' },
    { week: '2027-W01' },
  ]);
  await runSiteStatsCron(db, new Date('2027-01-11T03:29:00Z'), list, send);
  expect(send).toHaveBeenCalledTimes(6);
  await runSiteStatsCron(db, new Date('2026-12-28T03:29:00Z'), list, send);
  expect(send).toHaveBeenCalledTimes(6);
});

it('retains the 400-day boundary and cleans all tenants on non-Mondays', async () => {
  const db = await makeD1();
  const now = new Date('2027-01-05T03:29:00Z');
  const cutoff = new Date(now.getTime() - 400 * 86400000).toISOString().slice(0, 10);
  const old = new Date(now.getTime() - 401 * 86400000).toISOString().slice(0, 10);
  for (const tenant of ['one', 'two']) {
    await visit(db, cutoff, 'tg', 1, tenant);
    await visit(db, old, 'tg', 1, tenant);
  }
  await runSiteStatsCron(db, now, new Map(), vi.fn());
  expect((await db.prepare('SELECT day FROM site_visits').all()).results).toEqual([
    { day: cutoff },
    { day: cutoff },
  ]);
});

it('does not retry ambiguous delivery and still reaches other allow-listed chats', async () => {
  const db = await makeD1();
  const list = new Map([
    [11, 'one'],
    [12, 'one'],
    [21, 'two'],
  ]);
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('private detail'))
    .mockResolvedValue(undefined);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await runSiteStatsCron(db, monday, list, send);
    await runSiteStatsCron(db, monday, list, send);
    expect(send).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith('Site weekly report delivery failed');
  } finally {
    log.mockRestore();
  }
});

it('preserves all source lines across Telegram-sized messages', () => {
  const text = Array.from({ length: 200 }, (_, i) => `other:source${i}.example: 1 (0.5%)`).join(
    '\n',
  );
  const messages = reportMessages(text);
  expect(messages.length).toBeGreaterThan(1);
  expect(messages.every((s) => s.length <= 4000)).toBe(true);
  expect(messages.join('\n')).toBe(text);
});

it('formats totals, previous period, percentages excluding internal traffic, and empty data', () => {
  const summary = {
    days: 28,
    total: 10,
    previous: 7,
    internal: 2,
    sources: [
      { label: 'tg', views: 6 },
      { label: 'direct', views: 2 },
    ],
    pages: [{ label: '/', views: 10 }],
    countries: [{ label: 'DE', views: 10 }],
  };
  expect(formatSiteStats(summary)).toBe(
    [
      'Сайт (28 днів)',
      'Завершені дні, UTC',
      'Перегляди: 10',
      'Попередні 28 днів: 7',
      'Переходи всередині сайту: 2',
      'Джерела (без переходів всередині сайту):',
      'Telegram: 6 (75.0%)',
      'напряму / без джерела: 2 (25.0%)',
      'Топ 5 сторінок:',
      '/: 10',
      'Топ 5 країн:',
      'DE: 10',
    ].join('\n'),
  );
  expect(
    formatSiteStats({ ...summary, total: 0, internal: 0, sources: [], pages: [], countries: [] }),
  ).toContain('За цей період переглядів немає.');
  const internal = formatSiteStats({ ...summary, total: 2, sources: [] });
  expect(internal).toContain('Зовнішніх переходів немає.');
  expect(internal).not.toContain('NaN');
});
