import { readFile } from 'node:fs/promises';
import { contestWeek, newUlid, parseTenantConfig } from '@handmake/core';
import { Bot } from 'grammy';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/context';
import { createApp } from '../src/composition';
import { AuthorEntrySource, createContestEntryStore } from '../src/contest-store';
import { readEntryNames } from '../src/contest-names';
import { createD1DraftStore } from '../src/draft-store';
import type { Env } from '../src/env';
import { runPollCron } from '../src/poll-cron';
import { createPollOpeningStore } from '../src/poll-opening-store';
import { botTexts } from '../src/texts';
import { callbackQueryUpdate, makeD1, mockTelegramApi, sentTexts } from './helpers';

const tenant = 'faden-und-stimmung';
const author = 111;
const tick = new Date('2026-11-09T09:00:00Z');
const yaml = await readFile(
  new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
  'utf8',
);
const config = parseTenantConfig(yaml);
config.featureFlags.wotwPoll = true;
afterEach(() => vi.restoreAllMocks());

async function fixture(now = tick, count = 2) {
  const db = await makeD1();
  const entries = createContestEntryStore(db);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const entryId = newUlid();
    ids.push(entryId);
    const createdAt = new Date(now.getTime() - 60_000 + i);
    await entries.submit({
      tenantId: tenant,
      entryId,
      photoRef: `photo-${i}`,
      displayName: `Private fixture ${i}`,
      consent: true,
      consentAt: createdAt,
      createdAt,
    });
  }
  const bot = new Bot<AppContext>('fixture-token');
  const calls = mockTelegramApi(bot);
  const drafts = createD1DraftStore(db);
  const options = {
    openings: createPollOpeningStore(db),
    source: new AuthorEntrySource(entries),
    bot,
    tenantConfigs: { load: async () => structuredClone(config) },
    allowList: new Map([
      [author, tenant],
      [222, tenant],
    ]),
    texts: botTexts,
    lookupNames: (t: string, refs: string[]) => readEntryNames(db, t, refs),
    publishesLive: true,
  };
  return { db, ids, drafts, calls, options, run: (date = now) => runPollCron(date, options) };
}

it('creates an ordered bilingual poll with private preview names and publishes only on approval', async () => {
  const fx = await fixture();
  await fx.run();
  const rows = await fx.drafts.listByState(tenant, 'ready');
  expect(rows).toHaveLength(1);
  const draft = rows[0]!.draft;
  expect(draft).toMatchObject({
    kind: 'post',
    type: 'wotw-poll',
    photoRefs: ['photo-0', 'photo-1'],
    extras: { week: '2026-11-09', entryRefs: fx.ids, poll: { options: ['No 1', 'No 2'] } },
  });
  for (const text of Object.values(draft.texts)) {
    expect(text).toContain(`1. {entry:${fx.ids[0]}}\n2. {entry:${fx.ids[1]}}`);
  }
  expect(JSON.stringify(draft)).not.toContain('Private fixture');
  expect(sentTexts(fx.calls)).toHaveLength(2);
  expect(sentTexts(fx.calls)[0]).toContain('Private fixture 0');
  expect(sentTexts(fx.calls)[0]).toContain(botTexts.pollQuestionText);
  expect(fx.calls.every((c) => c.method === 'sendMessage')).toBe(true);
  expect(fx.calls[0]!.payload).toHaveProperty('reply_markup');
  expect(await fx.drafts.getChatSession(tenant, String(author))).toBeUndefined();

  // Exercise the real publish callback routing against the cron's persisted extras.
  const app = createApp(
    {
      DB: fx.db,
      TELEGRAM_BOT_TOKEN: 'fixture-token',
      TELEGRAM_ALLOWED_USER_IDS: JSON.stringify({ [author]: tenant }),
      GITHUB_REPO: 'fixture/repo',
      GITHUB_DISPATCH_TOKEN: 'fixture-key',
      PUBLISH_LIVE: 'false',
    } as Env,
    botTexts,
  );
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 204 }));
  mockTelegramApi(app.bot);
  await app.bot.init();
  await app.bot.handleUpdate(callbackQueryUpdate(author, author, `draft:${draft.draftId}:publish`));
  expect(fetchMock).not.toHaveBeenCalled();
  await app.bot.handleUpdate(
    callbackQueryUpdate(author, author, `draft:${draft.draftId}:publish:confirm`),
  );
  const dispatch = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/dispatches'));
  expect(dispatch).toBeDefined();
  const body = JSON.parse(String(dispatch![1]!.body));
  expect(JSON.stringify(body)).not.toContain('Private fixture');
  expect(JSON.stringify(body)).toContain('No 2');
});

it('deduplicates concurrent ticks, schedule edits and a discarded draft', async () => {
  const fx = await fixture();
  await Promise.all([fx.run(), fx.run(), fx.run(new Date('2026-11-09T09:15:00Z'))]);
  const rows = await fx.drafts.listByState(tenant, 'ready');
  expect(rows).toHaveLength(1);
  expect(sentTexts(fx.calls)).toHaveLength(2);
  await fx.drafts.delete(tenant, rows[0]!.draft.draftId);
  fx.options.tenantConfigs.load = async () => ({
    ...config,
    workOfWeek: { ...config.workOfWeek, opens: { weekday: 'monday', time: '10:15' } },
  });
  await fx.run(new Date('2026-11-09T09:30:00Z'));
  expect(await fx.drafts.listByState(tenant, 'ready')).toHaveLength(0);
  expect(sentTexts(fx.calls)).toHaveLength(2);
});

it.each([0, 1])('notifies once and creates no draft for %i entries', async (count) => {
  const fx = await fixture(tick, count);
  await Promise.all([fx.run(), fx.run()]);
  expect(await fx.drafts.listByState(tenant, 'ready')).toHaveLength(0);
  expect(sentTexts(fx.calls)).toEqual([
    botTexts.pollTooFewEntriesText,
    botTexts.pollTooFewEntriesText,
  ]);
});

it('does no source or names lookup with the flag off or outside the opening window', async () => {
  const fx = await fixture();
  const source = vi.spyOn(fx.options.source, 'listSubmissions');
  const names = vi.spyOn(fx.options, 'lookupNames');
  fx.options.tenantConfigs.load = async () => ({
    ...config,
    featureFlags: { ...config.featureFlags, wotwPoll: false },
  });
  await fx.run();
  fx.options.tenantConfigs.load = async () => config;
  await fx.run(new Date('2026-11-09T08:59:59Z'));
  await fx.run(new Date('2026-11-09T09:45:00Z'));
  expect(source).not.toHaveBeenCalled();
  expect(names).not.toHaveBeenCalled();
  expect(sentTexts(fx.calls)).toEqual([]);
});

it.each([
  ['2026-03-23T09:00:00Z', '2026-03-23'],
  ['2026-03-30T08:00:00Z', '2026-03-30'],
  ['2026-10-19T08:00:00Z', '2026-10-19'],
  ['2026-10-26T09:00:00Z', '2026-10-26'],
])('uses local Monday 10:00 across DST: %s', async (instant, week) => {
  const now = new Date(instant);
  const fx = await fixture(now);
  await fx.run(new Date(now.getTime() - 1));
  expect(sentTexts(fx.calls)).toEqual([]);
  await fx.run(new Date(now.getTime() + 44 * 60_000));
  const rows = await fx.drafts.listByState(tenant, 'ready');
  expect(rows).toHaveLength(1);
  expect(rows[0]!.draft.extras['week']).toBe(week);
  expect(contestWeek(now)).toBe(week);
});

it('allows a retry after names lookup failure without leaking diagnostics or creating a draft', async () => {
  const fx = await fixture();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const lookup = fx.options.lookupNames;
  fx.options.lookupNames = async () => {
    throw new Error('Private fixture');
  };
  await fx.run();
  expect(await fx.drafts.listByState(tenant, 'ready')).toEqual([]);
  expect(log).toHaveBeenCalledWith(`poll cron failed for tenant ${tenant}`);
  expect(JSON.stringify(log.mock.calls)).not.toContain('Private fixture');
  fx.options.lookupNames = lookup;
  await fx.run();
  expect(await fx.drafts.listByState(tenant, 'ready')).toHaveLength(1);
});

it('wires the opening into the scheduled handler and stays idempotent on the next tick', async () => {
  const fx = await fixture();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(yaml.replace('wotwPoll: false', 'wotwPoll: true')),
    );
  const app = createApp(
    {
      DB: fx.db,
      TELEGRAM_BOT_TOKEN: 'fixture-token',
      TELEGRAM_ALLOWED_USER_IDS: JSON.stringify({ [author]: tenant }),
      GITHUB_REPO: 'fixture/repo',
      PUBLISH_LIVE: 'false',
    } as Env,
    botTexts,
  );
  const calls = mockTelegramApi(app.bot);
  for (const delta of [0, 15 * 60_000]) {
    await app.scheduled({
      cron: '*/15 * * * *',
      scheduledTime: tick.getTime() + delta,
    } as ScheduledEvent);
  }
  expect(await fx.drafts.listByState(tenant, 'ready')).toHaveLength(1);
  expect(sentTexts(calls).filter((text) => text.includes(botTexts.pollQuestionText))).toHaveLength(
    1,
  );
  expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/config/tenants/'))).toBe(
    true,
  );
});

it('limits the real source to ten submitted entries of the selected tenant and week', async () => {
  const fx = await fixture(tick, 12);
  await fx.db
    .prepare('UPDATE contest_entries SET status = ? WHERE entry_id = ?')
    .bind('withdrawn', fx.ids[0])
    .run();
  await fx.run();
  const [row] = await fx.drafts.listByState(tenant, 'ready');
  expect(row!.draft.photoRefs).toEqual(Array.from({ length: 10 }, (_, i) => `photo-${i + 1}`));
  expect(row!.draft.extras['entryRefs']).toEqual(fx.ids.slice(1, 11));
});
