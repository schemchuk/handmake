import { createDraft, signCallbackBody } from '@handmake/core';
import { expect, it, vi } from 'vitest';
import { usageSummary } from '../src/usage-metrics';
import { createD1DraftStore } from '../src/draft-store';
import { createBot } from '../src/bot';
import { handlePublishedCallback } from '../src/published-callback';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { makeD1, mockTelegramApi, sentTexts, textUpdate } from './helpers';

const now = new Date('2026-11-13T12:00:00Z');
const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const at = (minutes: number) => new Date(now.getTime() - minutes * 60000);

it('records guarded ready/edit/regeneration mutations and survives draft deletion', async () => {
  const db = await makeD1();
  const store = createD1DraftStore(db);
  await store.create(createDraft('one', id, at(60)), '11');
  await store.claimTranslation('one', id, ['collecting'], at(55));
  await store.markTranslated('one', id, 'DE', at(50));
  expect(await store.markTranslated('one', id, 'duplicate', at(49))).toBe(false);
  for (const target of ['uk', 'de'] as const) {
    await store.setPendingEdit('one', id, target, at(45));
    expect(await store.replaceText('one', id, target, `Edited ${target}`, at(44))).toBe(true);
    expect(await store.replaceText('one', id, target, 'duplicate', at(43))).toBe(false);
  }
  await store.claimTranslation('one', id, ['ready'], at(40));
  await store.claimTranslation('one', id, ['ready'], at(39));
  await store.markTranslated('one', id, 'Regenerated', at(38));
  const row = await db.prepare('SELECT * FROM draft_usage').first();
  expect(row).toMatchObject({
    first_ready_at: at(50).toISOString(),
    uk_edits: 1,
    de_edits: 1,
    regenerations: 1,
    tracked_from_creation: 1,
  });
  await store.delete('one', id);
  expect(await db.prepare('SELECT * FROM draft_usage').first()).toEqual(row);
});

it('aggregates exact rolling boundaries, median, edits, failures and tenant isolation', async () => {
  const db = await makeD1();
  const start = new Date(now.getTime() - 28 * 86400000).toISOString();
  for (const [post, minutes, edits] of [
    ['a', 10, 2],
    ['b', 30, 4],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO draft_usage
      (tenant_id, draft_id, created_at, first_ready_at, tracked_from_creation, uk_edits)
      VALUES ('one', ?, ?, ?, 1, ?)`,
      )
      .bind(post, at(minutes + 1).toISOString(), at(minutes).toISOString(), edits)
      .run();
  }
  for (const [tenant, post, status, time] of [
    ['one', 'a', 'done', at(1).toISOString()],
    ['one', 'b', 'done', at(1).toISOString()],
    ['one', 'unmeasured', 'done', start],
    ['one', 'partial', 'done', at(1).toISOString()],
    ['one', 'partial', 'failed', at(1).toISOString()],
    ['one', 'old', 'done', new Date(Date.parse(start) - 1).toISOString()],
    ['one', 'future', 'done', now.toISOString()],
    ['other', 'a', 'done', at(1).toISOString()],
  ])
    await db
      .prepare('INSERT INTO usage_deliveries VALUES (?, ?, ?, ?, ?)')
      .bind(tenant, post, status === 'failed' ? 'second' : 'first', status, time)
      .run();
  await db
    .prepare(
      `INSERT INTO usage_publications
    SELECT tenant_id, draft_id, MIN(observed_at) FROM usage_deliveries GROUP BY tenant_id, draft_id`,
    )
    .run();
  expect(await usageSummary(db, 'one', now)).toEqual({
    published: 3,
    measured: 2,
    medianMinutes: 20,
    editsPerPost: 3,
    deliverySuccessRate: 4 / 5,
  });
  expect(await usageSummary(db, 'empty', now)).toEqual({
    published: 0,
    measured: 0,
    medianMinutes: null,
    editsPerPost: null,
    deliverySuccessRate: null,
  });
});

it('uses authenticated callback outcomes idempotently, recovering failures without regression', async () => {
  const db = await makeD1();
  const secret = 'fixture-secret';
  const send = async (channels: Record<string, string>, valid = true) => {
    const body = JSON.stringify({
      tenantId: 'one',
      postId: id,
      date: '2026-11-13',
      photos: [],
      channels,
    });
    return handlePublishedCallback(
      { DB: db, PUBLISH_CALLBACK_SECRET: secret } as Env,
      new Request('https://bot.example/callbacks/published', {
        method: 'POST',
        body,
        headers: { 'x-handmake-signature': valid ? await signCallbackBody(secret, body) : 'bad' },
      }),
    );
  };
  expect((await send({ telegram: 'done' }, false)).status).toBe(401);
  expect((await db.prepare('SELECT * FROM usage_deliveries').all()).results).toEqual([]);
  expect((await send({ telegram: 'done', instagram: 'failed' })).status).toBe(200);
  const before = (await db.prepare('SELECT * FROM usage_deliveries').all()).results;
  await send({ telegram: 'done', instagram: 'failed' });
  expect((await db.prepare('SELECT * FROM usage_deliveries').all()).results).toEqual(before);
  await send({ instagram: 'done' });
  await send({ instagram: 'failed' });
  await send({});
  const report = await usageSummary(db, 'one', new Date(Date.now() + 1000));
  expect(report).toMatchObject({ published: 1, deliverySuccessRate: 1, measured: 0 });
});

it('allows private operator reports only, scopes the query and sanitizes failures', async () => {
  const usage = vi.fn().mockResolvedValue({
    published: 2,
    measured: 2,
    medianMinutes: 10,
    editsPerPost: 1,
    deliverySuccessRate: 0.5,
  });
  const bot = createBot({
    token: 'TEST_TOKEN',
    drafts: createD1DraftStore(await makeD1()),
    resolveTenant: (id) => (id === 11 ? 'one' : undefined),
    texts: botTexts,
    translator: { translate: vi.fn() },
    publishRunner: { run: vi.fn() },
    background: vi.fn(),
    usage,
  });
  const calls = mockTelegramApi(bot);
  await bot.init();
  await bot.handleUpdate(textUpdate(999, '/stats'));
  expect(usage).not.toHaveBeenCalled();
  const group = textUpdate(11, '/stats');
  Object.assign(group.message!.chat, { type: 'group' });
  await bot.handleUpdate(group);
  expect(usage).not.toHaveBeenCalled();
  await bot.handleUpdate(textUpdate(11, '/stats'));
  expect(usage).toHaveBeenCalledExactlyOnceWith('one', expect.any(Date));
  expect(sentTexts(calls).at(-1)).toContain('Успішні доставки: 50.0%');
  usage.mockRejectedValueOnce(new Error('private backend detail'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await bot.handleUpdate(textUpdate(11, '/stats'));
  expect(sentTexts(calls).at(-1)).toBe('Не вдалося отримати статистику. Спробуй /stats пізніше.');
  expect(log).toHaveBeenCalledWith('Usage report failed');
  log.mockRestore();
});

it('counts site-only callbacks without inventing a channel delivery', async () => {
  const db = await makeD1();
  const body = JSON.stringify({
    tenantId: 'one',
    postId: id,
    date: '2026-11-13',
    photos: [],
    kind: 'work',
    channels: {},
  });
  const response = await handlePublishedCallback(
    { DB: db, PUBLISH_CALLBACK_SECRET: 'fixture' } as Env,
    new Request('https://bot.example/callbacks/published', {
      method: 'POST',
      body,
      headers: { 'x-handmake-signature': await signCallbackBody('fixture', body) },
    }),
  );
  expect(response.status).toBe(200);
  expect(await usageSummary(db, 'one', new Date(Date.now() + 1000))).toMatchObject({
    published: 1,
    deliverySuccessRate: null,
  });
});
