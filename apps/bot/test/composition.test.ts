import { createDraft } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { createApp, secretTokenHeader, secretsEqual } from '../src/composition';
import { createD1DraftStore } from '../src/draft-store';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { fakeDb, makeD1, mockTelegramApi, sentTexts, textUpdate } from './helpers';

const webhookUrl = 'https://handmake-bot.workers.dev/webhook';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: fakeDb(),
    TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_ALLOWED_USER_IDS: '{"11":"faden-und-stimmung"}',
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

  it('processes a signed update end to end: start reply, no D1 write for strangers', async () => {
    const env = makeEnv();
    const app = createApp(env, botTexts);
    const calls = mockTelegramApi(app.bot);

    const allowed = await app.handle(webhookRequest(env, textUpdate(11, '/start')));
    const stranger = await app.handle(webhookRequest(env, textUpdate(999, '/start')));

    expect(allowed.status).toBe(200);
    expect(stranger.status).toBe(200);
    expect(sentTexts(calls)).toEqual([botTexts.startText, botTexts.refusalText]);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });
});

describe('scheduled draft cleanup', () => {
  it('deletes drafts untouched for 30 days and keeps recent ones', async () => {
    const db = await makeD1();
    const env = makeEnv({ DB: db });
    const app = createApp(env, botTexts);
    const store = createD1DraftStore(db);
    const tenant = 'faden-und-stimmung';
    await store.create(createDraft(tenant, 'old', new Date('2026-10-01T00:00:00.000Z')), '11');
    await store.create(createDraft(tenant, 'fresh', new Date('2026-11-20T00:00:00.000Z')), '11');

    // The 03:29 UTC daily cron firing on 2026-11-27; cutoff = 30 days back.
    const scheduledTime = new Date('2026-11-27T03:29:00.000Z').getTime();
    const removed = await app.scheduled({ scheduledTime } as ScheduledEvent);

    expect(removed).toBe(1);
    expect(await store.get(tenant, 'old')).toBeUndefined();
    expect(await store.get(tenant, 'fresh')).toBeDefined();
  });
});
