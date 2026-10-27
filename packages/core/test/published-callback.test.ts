import { describe, expect, it } from 'vitest';

import {
  publishedCallbackBodySchema,
  signCallbackBody,
  verifyCallbackSignature,
} from '../src/published-callback';

const secret = 'callback-secret';

describe('signCallbackBody / verifyCallbackSignature', () => {
  it('round-trips: a signature verifies against the same body and secret', async () => {
    const body = JSON.stringify({ tenantId: 't', postId: 'p' });
    const signature = await signCallbackBody(secret, body);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyCallbackSignature(secret, body, signature)).toBe(true);
  });

  it('rejects a signature made with a different secret', async () => {
    const body = JSON.stringify({ tenantId: 't', postId: 'p' });
    const signature = await signCallbackBody('other-secret', body);

    expect(await verifyCallbackSignature(secret, body, signature)).toBe(false);
  });

  it('rejects a tampered body (the signature stays valid for the original)', async () => {
    const original = JSON.stringify({ tenantId: 't', postId: 'p', photos: ['a.jpg'] });
    const signature = await signCallbackBody(secret, original);
    const tampered = JSON.stringify({ tenantId: 't', postId: 'p', photos: ['b.jpg'] });

    expect(await verifyCallbackSignature(secret, tampered, signature)).toBe(false);
  });

  it('rejects a re-serialized body: the signature covers the exact bytes', async () => {
    const sent = '{"tenantId":"t","postId":"p","photos":["a.jpg"]}';
    const resent = JSON.stringify(JSON.parse(sent), null, 2);
    const signature = await signCallbackBody(secret, sent);

    expect(resent).not.toBe(sent);
    expect(await verifyCallbackSignature(secret, resent, signature)).toBe(false);
  });

  it('rejects a malformed or wrong-length signature', async () => {
    const body = JSON.stringify({ tenantId: 't' });

    expect(await verifyCallbackSignature(secret, body, 'not-hex-at-all')).toBe(false);
    expect(await verifyCallbackSignature(secret, body, 'abcd')).toBe(false);
    expect(await verifyCallbackSignature(secret, body, '')).toBe(false);
  });
});

describe('publishedCallbackBodySchema', () => {
  const valid = {
    tenantId: 'faden-und-stimmung',
    postId: '01J8ZEXAMPLE00000000000000',
    date: '2026-10-27',
    photos: ['content/posts/2026-10-27-a/photo-1.jpg'],
    channels: { telegram: 'done', instagram: 'failed' },
  };

  it('accepts the publisher-shaped body', () => {
    expect(publishedCallbackBodySchema.parse(valid)).toEqual(valid);
  });

  it('rejects a missing channel outcome value outside done/failed', () => {
    expect(
      publishedCallbackBodySchema.safeParse({ ...valid, channels: { telegram: 'partial' } })
        .success,
    ).toBe(false);
  });

  it('rejects extra fields and empty ids', () => {
    expect(publishedCallbackBodySchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(publishedCallbackBodySchema.safeParse({ ...valid, tenantId: '' }).success).toBe(false);
    expect(publishedCallbackBodySchema.safeParse({ ...valid, photos: [42] }).success).toBe(false);
  });
});
