import { createDraft, signCallbackBody } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/composition';
import { createD1DraftStore } from '../src/draft-store';
import type { Env } from '../src/env';
import { botTexts } from '../src/texts';
import { fakeDb, makeD1 } from './helpers';

const callbackUrl = 'https://handmake-bot.workers.dev/callbacks/published';
const tenant = 'faden-und-stimmung';
const secret = 'callback-secret';

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_ALLOWED_USER_IDS: '{"11":"faden-und-stimmung"}',
    ANTHROPIC_API_KEY: 'test-key',
    GITHUB_DISPATCH_TOKEN: 'test-dispatch-token',
    GITHUB_REPO: 'owner/repo',
    PUBLISH_LIVE: 'false',
    PUBLISH_CALLBACK_SECRET: secret,
    ...overrides,
  };
}

function callbackBody(postId: string, overrides: Record<string, unknown> = {}) {
  return {
    tenantId: tenant,
    postId,
    date: '2026-10-27',
    photos: [`content/posts/${postId}/photo-1.jpg`],
    channels: { telegram: 'done' },
    ...overrides,
  };
}

async function signedRequest(body: unknown, signature?: string | null): Promise<Request> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) {
    headers['X-Handmake-Signature'] = signature ?? (await signCallbackBody(secret, raw));
  }
  return new Request(callbackUrl, { method: 'POST', headers, body: raw });
}

async function indexCount(db: D1Database, postId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM published_posts WHERE tenant_id = ? AND post_id = ?')
    .bind(tenant, postId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function indexRow(db: D1Database, postId: string) {
  return db
    .prepare('SELECT published_at, photos FROM published_posts WHERE tenant_id = ? AND post_id = ?')
    .bind(tenant, postId)
    .first<{ published_at: string; photos: string }>();
}

/** A draft claimed into 'publishing', as the bot leaves it after 🚀. */
async function makePublishingDraft(db: D1Database, postId: string): Promise<void> {
  const store = createD1DraftStore(db);
  await store.create(createDraft(tenant, postId, new Date('2026-10-27T10:00:00.000Z')), '11');
  await store.claimTranslation(tenant, postId, ['collecting'], new Date());
  await store.markTranslated(tenant, postId, 'Hallo!', new Date());
  const claimed = await store.claimPublishing(tenant, postId, new Date());
  if (!claimed) {
    throw new Error('test helper failed to claim the draft');
  }
}

describe('POST /callbacks/published (T18)', () => {
  it('marks a publishing draft published and indexes the post', async () => {
    const db = await makeD1();
    const postId = '01J8ZEXAMPLE00000000000001';
    await makePublishingDraft(db, postId);
    const env = makeEnv(db);

    const response = await createApp(env, botTexts).handle(
      await signedRequest(callbackBody(postId)),
    );

    expect(response.status).toBe(200);
    const store = createD1DraftStore(db);
    expect((await store.get(tenant, postId))?.draft.state).toBe('published');
    expect(await indexCount(db, postId)).toBe(1);
    const row = await indexRow(db, postId);
    expect(row?.published_at).toBe('2026-10-27');
    expect(JSON.parse(row?.photos ?? '')).toEqual([`content/posts/${postId}/photo-1.jpg`]);
  });

  it('is idempotent: a retried callback is a no-op 200, still one index row', async () => {
    const db = await makeD1();
    const postId = '01J8ZEXAMPLE00000000000002';
    await makePublishingDraft(db, postId);
    const env = makeEnv(db);
    const request = await signedRequest(callbackBody(postId));

    const first = await createApp(env, botTexts).handle(request);
    const retry = await createApp(env, botTexts).handle(await signedRequest(callbackBody(postId)));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await indexCount(db, postId)).toBe(1);
    expect((await createD1DraftStore(db).get(tenant, postId))?.draft.state).toBe('published');
  });

  it('answers 401 and writes nothing when the signature is missing', async () => {
    const db = await makeD1();
    const postId = '01J8ZEXAMPLE00000000000003';
    await makePublishingDraft(db, postId);
    const env = makeEnv(db);

    const response = await createApp(env, botTexts).handle(
      await signedRequest(callbackBody(postId), null),
    );

    expect(response.status).toBe(401);
    expect((await createD1DraftStore(db).get(tenant, postId))?.draft.state).toBe('publishing');
    expect(await indexCount(db, postId)).toBe(0);
  });

  it('answers 401 and writes nothing when the signature is wrong', async () => {
    const db = await makeD1();
    const postId = '01J8ZEXAMPLE00000000000004';
    await makePublishingDraft(db, postId);
    const env = makeEnv(db);

    const response = await createApp(env, botTexts).handle(
      await signedRequest(callbackBody(postId), 'deadbeef'.repeat(8)),
    );

    expect(response.status).toBe(401);
    expect((await createD1DraftStore(db).get(tenant, postId))?.draft.state).toBe('publishing');
    expect(await indexCount(db, postId)).toBe(0);
  });

  it('fails closed when no callback secret is configured', async () => {
    const db = await makeD1();
    const env = makeEnv(db, { PUBLISH_CALLBACK_SECRET: '' });

    const response = await createApp(env, botTexts).handle(
      await signedRequest(callbackBody('01J8ZEXAMPLE00000000000005')),
    );

    expect(response.status).toBe(401);
    expect(await indexCount(db, '01J8ZEXAMPLE00000000000005')).toBe(0);
  });

  it('indexes an unknown post (published by hand) and answers 200', async () => {
    const db = await makeD1();
    const postId = '01J8ZEXAMPLE00000000000006';
    const env = makeEnv(db);

    const response = await createApp(env, botTexts).handle(
      await signedRequest(callbackBody(postId)),
    );

    expect(response.status).toBe(200);
    expect(await indexCount(db, postId)).toBe(1);
  });

  it('leaves a never-dispatched draft untouched but still indexes the post', async () => {
    const db = await makeD1();
    const postId = '01J8ZEXAMPLE00000000000007';
    const store = createD1DraftStore(db);
    await store.create(createDraft(tenant, postId, new Date()), '11');
    const env = makeEnv(db);

    const response = await createApp(env, botTexts).handle(
      await signedRequest(callbackBody(postId)),
    );

    expect(response.status).toBe(200);
    expect((await store.get(tenant, postId))?.draft.state).toBe('collecting');
    expect(await indexCount(db, postId)).toBe(1);
  });

  it('answers 400 to a malformed body even with a valid signature', async () => {
    const db = await makeD1();
    const postId = '01J8ZEXAMPLE00000000000008';
    await makePublishingDraft(db, postId);
    const env = makeEnv(db);

    const notJson = await signedRequest('{not json');
    const badChannel = await signedRequest(
      callbackBody(postId, { channels: { telegram: 'partial' } }),
    );

    expect((await createApp(env, botTexts).handle(notJson)).status).toBe(400);
    expect((await createApp(env, botTexts).handle(badChannel)).status).toBe(400);
    expect((await createD1DraftStore(db).get(tenant, postId))?.draft.state).toBe('publishing');
    expect(await indexCount(db, postId)).toBe(0);
  });

  it('answers 405 to non-POST requests', async () => {
    const env = makeEnv(fakeDb());
    const response = await createApp(env, botTexts).handle(new Request(callbackUrl));

    expect(response.status).toBe(405);
  });
});
