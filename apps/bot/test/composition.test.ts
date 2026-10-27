import { describe, expect, it } from 'vitest';

import { createApp, secretTokenHeader } from '../src/composition';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { fakeDb, mockTelegramApi, sentTexts, textUpdate } from './helpers';

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
