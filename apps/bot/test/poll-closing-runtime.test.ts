import { readFile } from 'node:fs/promises';
import { newUlid, parseTenantConfig } from '@handmake/core';
import type { ChannelAdapter, DeliverContext } from '@handmake/core';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/composition';
import type { Env } from '../src/env';
import { createD1DraftStore } from '../src/draft-store';
import { readEntryNames } from '../src/contest-names';
import { createPollClosingStore } from '../src/poll-closing-store';
import { createPollResultStore } from '../src/poll-result';
import { closingEntryWeek, runPollClosingCron } from '../src/poll-closing-runtime';
import type { TenantConfigSource } from '../src/tenant-config-source';
import type { ContestVoteSource } from '../src/contest-votes';
import { botTexts } from '../src/texts';
import { callbackQueryUpdate, makeD1, mockTelegramApi, sentTexts } from './helpers';

const tenant = 'faden-und-stimmung';
const week = '2026-11-02';
const tick = new Date('2026-11-11T19:00:00Z');
const yaml = await readFile(
  new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
  'utf8',
);
const base = parseTenantConfig(yaml);
base.featureFlags.wotwPoll = true;
afterEach(() => vi.restoreAllMocks());

async function fixture(counts = [1, 2]) {
  const db = await makeD1();
  const refs = counts.map(() => newUlid());
  const id = newUlid();
  for (const ref of refs)
    await db
      .prepare(
        `INSERT INTO contest_entries
    (tenant_id, entry_id, week, file_id, display_name, consent_at, created_at)
    VALUES (?, ?, ?, 'photo', 'Private name', 'now', 'now')`,
      )
      .bind(tenant, ref, week)
      .run();
  await db
    .prepare(
      `INSERT INTO drafts (tenant_id, id, chat_id, status, type, extras)
    VALUES (?, ?, '111', 'published', 'wotw-poll', ?)`,
    )
    .bind(
      tenant,
      id,
      JSON.stringify({
        week,
        entryRefs: refs,
        poll: { options: refs.map((_, i) => `No ${i + 1}`) },
      }),
    )
    .run();
  await db
    .prepare(`INSERT INTO channel_deliveries VALUES (?, ?, 'telegram', 'done', '{"poll":11}')`)
    .bind(tenant, id)
    .run();
  const config = structuredClone(base);
  const fetchConfig = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('config/tenants/'))
      return new Response(
        yaml.replace('wotwPoll: false', `wotwPoll: ${config.featureFlags.wotwPoll}`),
      );
    throw new Error('Unexpected external request');
  });
  const app = createApp(
    {
      DB: db,
      TELEGRAM_BOT_TOKEN: 'fixture-token',
      TELEGRAM_CHANNEL_ID: '-100123',
      TELEGRAM_ALLOWED_USER_IDS: JSON.stringify({ 111: tenant, 222: tenant, 333: 'other' }),
      GITHUB_REPO: 'fixture/repo',
      PUBLISH_LIVE: 'true',
    } as Env,
    botTexts,
  );
  const calls = mockTelegramApi(app.bot);
  await app.bot.init();
  const load = vi.fn(async () => structuredClone(config));
  // Both bot callback and cron use current tenant configuration.
  const close = vi.fn(async () => ({
    optionVotes: counts,
    totalVotes: counts.reduce((a, b) => a + b, 0),
  }));
  const drafts = createD1DraftStore(db);
  const options = {
    db,
    drafts,
    bot: app.bot,
    tenantConfigs: { load } as TenantConfigSource,
    texts: botTexts,
    lookupNames: (t: string, ids: string[]) => readEntryNames(db, t, ids),
    publishesLive: true,
    allowList: new Map([
      [111, tenant],
      [222, tenant],
    ]),
    adapter: {
      key: 'telegram',
      capabilities: { polls: true },
      closePoll: close,
    } as unknown as ChannelAdapter,
    context: () => ({}) as DeliverContext,
    sources: (): ContestVoteSource[] => [],
  };
  const run = (date = tick) => runPollClosingCron(date, options);
  const choice = () => {
    const call = calls.find((c) => String(c.payload.text).includes('Оберіть роботу'))!;
    return (
      call.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard
      .flat()
      .map((b) => b.callback_data);
  };
  return {
    db,
    refs,
    id,
    config,
    app,
    calls,
    close,
    drafts,
    options,
    run,
    choice,
    fetchConfig,
    results: createPollResultStore(db),
    closings: createPollClosingStore(db),
    press: (data: string, user = 111, chat = user) =>
      app.bot.handleUpdate(callbackQueryUpdate(user, chat, data)),
  };
}

it.each([
  ['2026-03-25T19:00:00Z', '2026-03-16'],
  ['2026-04-01T18:00:00Z', '2026-03-23'],
  ['2026-10-28T19:00:00Z', '2026-10-19'],
  ['2027-01-06T19:00:00Z', '2026-12-28'],
])('maps configured closing %s to entry week %s', (date, expected) => {
  expect(closingEntryWeek(base, new Date(date))).toBe(expected);
  expect(closingEntryWeek(base, new Date(Date.parse(date) + 46 * 60_000))).toBeUndefined();
});

it('closes once under competing ticks and sends the usual private-name preview without publishing', async () => {
  const f = await fixture();
  await Promise.all([f.run(), f.run()]);
  expect(f.close).toHaveBeenCalledTimes(1);
  const receipt = await f.results.get(tenant, week);
  expect(receipt).toMatchObject({ entryId: f.refs[1], source: 'readers' });
  const drafts = await f.drafts.listByState(tenant, 'ready');
  expect(drafts).toHaveLength(1);
  expect(JSON.stringify(drafts)).not.toContain('Private name');
  expect(
    sentTexts(f.calls).some((t) => t.includes('Private name') && t.includes('за вибором читачів')),
  ).toBe(true);
  expect(
    f.calls
      .filter((c) => c.method === 'sendMessage')
      .some((c) =>
        JSON.stringify(c.payload.reply_markup).includes(`draft:${receipt!.draftId}:publish`),
      ),
  ).toBe(true);
});

it('shows combined totals, authenticates callbacks and keeps the first competing decision', async () => {
  const f = await fixture([1, 1]);
  await f.db
    .prepare(`INSERT INTO channel_deliveries VALUES (?, ?, 'instagram', 'done', '{"main":"ig"}')`)
    .bind(tenant, f.id)
    .run();
  const comments = vi.fn(async () => [
    { id: 'a', text: '1', handle: 'reader', createdAt: '2026-11-11' },
  ]);
  f.options.sources = () => [
    {
      adapter: {
        key: 'instagram',
        comments: { listComments: comments },
      } as unknown as ChannelAdapter,
      context: { secrets: { resolve: async () => '' } },
    },
  ];
  await f.run();
  expect(comments).toHaveBeenCalledTimes(1);
  expect(sentTexts(f.calls)[0]).toContain('Усього голосів: 3');
  expect(sentTexts(f.calls)[0]).toContain('instagram: 1');
  const buttons = f.choice();
  expect(buttons).toHaveLength(2);
  expect(buttons.every((b) => b.length <= 64)).toBe(true);
  await f.press(buttons[0]!, 999);
  await f.press(buttons[0]!, 333);
  await f.press(buttons[0]!, 111, 222);
  await f.press(buttons[0]!.replace(/.$/, '9'));
  await f.press(buttons[0]!.replace(/:[0-9a-f-]{36}:/, ':00000000-0000-0000-0000-000000000000:'));
  expect(await f.results.get(tenant, week)).toBeUndefined();
  await Promise.all([f.press(buttons[0]!), f.press(buttons[1]!, 222), f.run()]);
  const result = await f.results.get(tenant, week);
  expect(result?.source).toBe('author');
  expect(await f.drafts.listByState(tenant, 'ready')).toHaveLength(1);
  await f.press(buttons[1]!);
  expect(await f.results.get(tenant, week)).toEqual(result);
  expect(sentTexts(f.calls).some((t) => t.includes('за вибором авторки'))).toBe(true);
});

it('checks the current flag in cron and in old callbacks', async () => {
  const f = await fixture([0, 0]);
  f.config.featureFlags.wotwPoll = false;
  await f.run();
  expect(f.close).not.toHaveBeenCalled();
  f.config.featureFlags.wotwPoll = true;
  await f.run();
  const [button] = f.choice();
  f.config.featureFlags.wotwPoll = false;
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000);
  await f.press(button!);
  expect(await f.results.get(tenant, week)).toBeUndefined();
});

it('preserves a committed result after notification failure and retries a ready preview', async () => {
  const f = await fixture();
  const send = vi
    .spyOn(f.app.bot.api, 'sendMessage')
    .mockRejectedValue(new Error('notification failure'));
  await f.run();
  const receipt = await f.results.get(tenant, week);
  expect(receipt).toBeDefined();
  send.mockRestore();
  await f.run();
  expect(sentTexts(f.calls).some((t) => t.includes('за вибором читачів'))).toBe(true);
  expect(await f.results.get(tenant, week)).toEqual(receipt);
  expect(await f.drafts.listByState(tenant, 'ready')).toHaveLength(1);
  expect(f.close).toHaveBeenCalledTimes(1);
});

it('recovers an expired interrupted claim outside the closing window and allows author selection', async () => {
  const f = await fixture();
  const claim = await f.closings.claim(
    { tenantId: tenant, week, postId: f.id, channel: 'telegram', pollId: 11, entryRefs: f.refs },
    tick.getTime(),
  );
  expect(claim).toBeDefined();
  await f.run(new Date(tick.getTime() + 60 * 60_000));
  expect(f.close).not.toHaveBeenCalled();
  expect((await f.closings.get(tenant, week))?.tally).toEqual({ status: 'unreadable' });
  await f.press(f.choice()[0]!);
  expect((await f.results.get(tenant, week))?.source).toBe('author');
});

it('isolates tenant errors so remaining scheduled closing work succeeds', async () => {
  const f = await fixture();
  f.options.allowList = new Map([
    [333, 'broken'],
    [111, tenant],
  ]);
  f.options.tenantConfigs.load = async (id?: string) => {
    if (id === 'broken') throw new Error('bad config');
    return structuredClone(f.config);
  };
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await f.run();
  expect(log).toHaveBeenCalledWith('poll closing cron failed for tenant broken');
  expect(await f.results.get(tenant, week)).toBeDefined();
});

it('restricts a Telegram tie to the tied candidates even with forged buttons', async () => {
  const f = await fixture([2, 2, 1]);
  await f.run();
  const buttons = f.choice();
  expect(buttons).toHaveLength(2);
  await f.press(buttons[0]!.replace(/.$/, '2'));
  expect(await f.results.get(tenant, week)).toBeUndefined();
  await f.press(buttons[1]!);
  expect((await f.results.get(tenant, week))?.entryId).toBe(f.refs[1]);
});

it('uses the production scheduler, Telegram adapter and configured channel to close a ballot', async () => {
  const f = await fixture();
  const stop = vi.fn();
  f.fetchConfig.mockImplementation(async (url, init) => {
    if (String(url).includes('config/tenants/'))
      return new Response(yaml.replace('wotwPoll: false', 'wotwPoll: true'));
    if (String(url).endsWith('/stopPoll')) {
      stop(JSON.parse(String(init?.body)));
      return Response.json({
        ok: true,
        result: { options: [{ voter_count: 1 }, { voter_count: 2 }], total_voter_count: 3 },
      });
    }
    throw new Error('Unexpected external request');
  });
  await f.app.scheduled({ cron: '*/15 * * * *', scheduledTime: tick.getTime() } as ScheduledEvent);
  expect(stop).toHaveBeenCalledWith({ chat_id: '-100123', message_id: 11 });
  expect((await f.results.get(tenant, week))?.source).toBe('readers');
  expect(sentTexts(f.calls).some((t) => t.includes('за вибором читачів'))).toBe(true);
});

it('recovers a callback preview failure by pressing the same old decision button', async () => {
  const f = await fixture([0, 0]);
  await f.run();
  const [button] = f.choice();
  let fail = true;
  // A failed Telegram response happens after the atomic decision.
  f.app.bot.api.config.use(async (prev, method, payload, signal) => {
    if (
      fail &&
      method === 'sendMessage' &&
      String((payload as { text?: string }).text).includes('за вибором авторки')
    ) {
      fail = false;
      throw new Error('lost notification');
    }
    return prev(method, payload, signal);
  });
  await f.press(button!);
  const result = await f.results.get(tenant, week);
  expect(result).toBeDefined();
  await f.press(f.choice()[1]!);
  expect(await f.results.get(tenant, week)).toEqual(result);
  expect(await f.drafts.listByState(tenant, 'ready')).toHaveLength(1);
  expect(sentTexts(f.calls).some((t) => t.includes('за вибором авторки'))).toBe(true);
});
