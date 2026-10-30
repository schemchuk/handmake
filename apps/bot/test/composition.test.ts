import { createDraft } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { createApp, secretTokenHeader, secretsEqual } from '../src/composition';
import { createD1DraftStore } from '../src/draft-store';
import type { Env } from '../src/env';
import { createProcessedUpdateTracker } from '../src/processed-updates';
import { botTexts } from '../src/texts';
import { fakeDb, makeD1, mockTelegramApi, sentTexts, textUpdate, voiceUpdate } from './helpers';

const webhookUrl = 'https://handmake-bot.workers.dev/webhook';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeDb(),
    TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_ALLOWED_USER_IDS: '{"11":"faden-und-stimmung"}',
    ANTHROPIC_API_KEY: 'test-key',
    GITHUB_DISPATCH_TOKEN: 'test-dispatch-token',
    GITHUB_REPO: 'owner/repo',
    PUBLISH_LIVE: 'false',
    PUBLISH_CALLBACK_SECRET: 'callback-secret',
    ...overrides,
  };
}

function webhookRequest(env: Env, update: unknown, secret?: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) {
    headers[secretTokenHeader] = secret ?? env.TELEGRAM_WEBHOOK_SECRET;
  }
  return new Request(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(update),
  });
}

describe('secretsEqual', () => {
  it('accepts equal strings', () => {
    expect(secretsEqual('webhook-secret', 'webhook-secret')).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    expect(secretsEqual('webhook-secret', 'webhook-secreu')).toBe(false);
  });

  it('rejects a different length', () => {
    expect(secretsEqual('webhook-secret', 'short')).toBe(false);
  });
});

describe('worker handle (composition root)', () => {
  it('answers 401 when the secret token header is missing', async () => {
    const env = makeEnv();
    const response = await createApp(env, botTexts).handle(
      webhookRequest(env, textUpdate(11, '/start'), null),
    );

    expect(response.status).toBe(401);
  });

  it('answers 401 when the secret token is wrong', async () => {
    const env = makeEnv();
    const response = await createApp(env, botTexts).handle(
      webhookRequest(env, textUpdate(11, '/start'), 'wrong-secret'),
    );

    expect(response.status).toBe(401);
  });

  it('fails closed when no webhook secret is configured', async () => {
    const env = makeEnv({ TELEGRAM_WEBHOOK_SECRET: '' });
    const response = await createApp(env, botTexts).handle(
      webhookRequest(env, textUpdate(11, '/start')),
    );

    expect(response.status).toBe(401);
  });

  it('checks the secret BEFORE parsing the allow-list (review note 2)', async () => {
    // A malformed allow-list must not turn an unauthenticated call into a
    // 500: the 401 comes first.
    const env = makeEnv({ TELEGRAM_ALLOWED_USER_IDS: 'not json at all' });
    const response = await createApp(env, botTexts).handle(
      webhookRequest(env, textUpdate(11, '/start'), 'wrong-secret'),
    );

    expect(response.status).toBe(401);
  });

  it('answers 405 to non-POST requests', async () => {
    const env = makeEnv();
    const response = await createApp(env, botTexts).handle(new Request(webhookUrl));

    expect(response.status).toBe(405);
  });

  it('processes a signed update end to end: start reply, nothing stored for strangers', async () => {
    const db = await makeD1();
    const env = makeEnv({ DB: db });
    const app = createApp(env, botTexts);
    const calls = mockTelegramApi(app.bot);

    const allowed = await app.handle(
      webhookRequest(env, { ...textUpdate(11, '/start'), update_id: 1 }),
    );
    const stranger = await app.handle(
      webhookRequest(env, { ...textUpdate(999, '/start'), update_id: 2 }),
    );

    expect(allowed.status).toBe(200);
    expect(stranger.status).toBe(200);
    expect(sentTexts(calls)).toEqual([botTexts.startText, botTexts.refusalText]);
    const store = createD1DraftStore(db);
    expect(await store.listByState('faden-und-stimmung', 'collecting')).toEqual([]);
  });
});

describe('webhook retry dedupe', () => {
  it('a redelivered update_id is acknowledged but not processed twice', async () => {
    const db = await makeD1();
    const env = makeEnv({ DB: db });
    const app = createApp(env, botTexts);
    const calls = mockTelegramApi(app.bot);
    const update = { ...textUpdate(11, 'hello'), update_id: 42 };

    const first = await app.handle(webhookRequest(env, update));
    const retry = await app.handle(webhookRequest(env, update));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    // One answer, one stored copy of the text.
    expect(sentTexts(calls)).toEqual([botTexts.textSavedText(0)]);
    const store = createD1DraftStore(db);
    const open = await store.findCollectingForChat('faden-und-stimmung', '11', 'post');
    expect(open?.draft.texts['uk']).toBe('hello');
  });

  it('refused strangers leave no trace in the dedupe table (A6)', async () => {
    const db = await makeD1();
    const env = makeEnv({ DB: db });
    const app = createApp(env, botTexts);
    const calls = mockTelegramApi(app.bot);
    const update = { ...textUpdate(999, '/start'), update_id: 44 };

    await app.handle(webhookRequest(env, update));
    await app.handle(webhookRequest(env, update));

    // No dedupe for strangers: each delivery is processed (two refusals)…
    expect(sentTexts(calls)).toEqual([botTexts.refusalText, botTexts.refusalText]);
    // …and nothing was recorded in D1.
    const tracker = createProcessedUpdateTracker(db);
    expect(await tracker.wasProcessed(44)).toBe(false);
  });

  it('a failed update is not recorded, so an error-retry re-runs it', async () => {
    const db = await makeD1();
    const env = makeEnv({ DB: db });
    const app = createApp(env, botTexts);
    const flaky = { fail: true };
    app.bot.api.config.use((async (_p: unknown, method: string) => {
      if (method === 'getMe') {
        return { ok: true, result: { id: 1, is_bot: true, first_name: 'B' } };
      }
      if (flaky.fail) {
        return { ok: false, error_code: 500, description: 'telegram hiccup' };
      }
      return {
        ok: true,
        result: { message_id: 1, date: 1_700_000_000, chat: { id: 11, type: 'private' } },
      };
    }) as never);
    // A voice message writes nothing to D1: it only gets a refusal reply,
    // so the API failure happens before any side effect.
    const update = { ...voiceUpdate(11, 'voice-1'), update_id: 43 };
    const tracker = createProcessedUpdateTracker(db);

    // First delivery fails inside the handler (Telegram API error).
    await app.handle(webhookRequest(env, update)).catch(() => undefined);
    expect(await tracker.wasProcessed(43)).toBe(false);

    // Telegram retries the same update_id; it must run again, not be dropped.
    flaky.fail = false;
    const retry = await app.handle(webhookRequest(env, update));
    expect(retry.status).toBe(200);
    expect(await tracker.wasProcessed(43)).toBe(true);
  });

  it('processed update ids are purged after their retention window', async () => {
    const db = await makeD1();
    const tracker = createProcessedUpdateTracker(db);
    await tracker.markProcessed(100);
    await db
      .prepare(
        "UPDATE processed_updates SET processed_at = '2026-10-20T00:00:00.000Z' WHERE update_id = 100",
      )
      .run();

    const env = makeEnv({ DB: db });
    const app = createApp(env, botTexts);
    const scheduledTime = new Date('2026-10-27T03:29:00.000Z').getTime();
    await app.scheduled({ scheduledTime } as ScheduledEvent);

    expect(await tracker.wasProcessed(100)).toBe(false);
  });
});

describe('scheduled draft cleanup', () => {
  it('deletes drafts untouched for 30 days and keeps recent ones', async () => {
    const db = await makeD1();
    const env = makeEnv({ DB: db });
    const app = createApp(env, botTexts);
    const store = createD1DraftStore(db);
    const tenant = 'faden-und-stimmung';
    await store.create(
      createDraft(tenant, 'old', new Date('2026-10-01T00:00:00.000Z')),
      'chat-old',
    );
    await store.create(
      createDraft(tenant, 'fresh', new Date('2026-11-20T00:00:00.000Z')),
      'chat-new',
    );

    // The 03:29 UTC daily cron firing on 2026-11-27; cutoff = 30 days back.
    const scheduledTime = new Date('2026-11-27T03:29:00.000Z').getTime();
    const removed = await app.scheduled({ scheduledTime } as ScheduledEvent);

    expect(removed).toBe(1);
    expect(await store.get(tenant, 'old')).toBeUndefined();
    expect(await store.get(tenant, 'fresh')).toBeDefined();
  });
});
