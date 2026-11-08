import { describe, expect, it } from 'vitest';

import { exchangeLongLivedToken, MetaTokenError } from '../src/meta/token';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('exchangeLongLivedToken', () => {
  it('exchanges via fb_exchange_token and returns the new token', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      seen.push(String(input));
      return jsonResponse({ access_token: 'long-lived-token', token_type: 'bearer' });
    }) as typeof fetch;

    const token = await exchangeLongLivedToken({
      appId: 'app-1',
      appSecret: 'app-secret-1',
      accessToken: 'short-lived-token',
      fetchImpl,
    });

    expect(token).toBe('long-lived-token');
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!);
    expect(url.pathname).toBe('/v21.0/oauth/access_token');
    expect(url.searchParams.get('grant_type')).toBe('fb_exchange_token');
    expect(url.searchParams.get('client_id')).toBe('app-1');
    expect(url.searchParams.get('client_secret')).toBe('app-secret-1');
    expect(url.searchParams.get('fb_exchange_token')).toBe('short-lived-token');
  });

  it('honours a custom apiBase', async () => {
    let seen = '';
    const fetchImpl = (async (input: unknown) => {
      seen = String(input);
      return jsonResponse({ access_token: 'token' });
    }) as typeof fetch;

    await exchangeLongLivedToken({
      appId: 'a',
      appSecret: 'b',
      accessToken: 'c',
      fetchImpl,
      apiBase: 'https://graph.example.test/v99.9',
    });

    expect(seen.startsWith('https://graph.example.test/v99.9/oauth/access_token')).toBe(true);
  });

  it('maps an error body to MetaTokenError with the server message', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: { message: 'Invalid appsecret' } }, 400)) as typeof fetch;

    await expect(
      exchangeLongLivedToken({ appId: 'a', appSecret: 'b', accessToken: 'c', fetchImpl }),
    ).rejects.toThrowError(MetaTokenError);
    await expect(
      exchangeLongLivedToken({ appId: 'a', appSecret: 'b', accessToken: 'c', fetchImpl }),
    ).rejects.toThrowError(/Meta token exchange failed: Invalid appsecret/);
  });

  it('falls back to the HTTP status when the error body has no message', async () => {
    const fetchImpl = (async () => jsonResponse({}, 500)) as typeof fetch;

    await expect(
      exchangeLongLivedToken({ appId: 'a', appSecret: 'b', accessToken: 'c', fetchImpl }),
    ).rejects.toThrowError(/HTTP 500/);
  });

  it('rejects malformed JSON and network failures', async () => {
    const malformed = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    await expect(
      exchangeLongLivedToken({
        appId: 'a',
        appSecret: 'b',
        accessToken: 'c',
        fetchImpl: malformed,
      }),
    ).rejects.toThrowError(/malformed JSON/);

    const failing = (async () => {
      throw new Error('socket hangup');
    }) as typeof fetch;
    await expect(
      exchangeLongLivedToken({ appId: 'a', appSecret: 'b', accessToken: 'c', fetchImpl: failing }),
    ).rejects.toThrowError(/request failed: socket hangup/);
  });

  it('rejects a response whose access_token is not a non-empty string', async () => {
    const fetchImpl = (async () => jsonResponse({ access_token: '' })) as typeof fetch;

    await expect(
      exchangeLongLivedToken({ appId: 'a', appSecret: 'b', accessToken: 'c', fetchImpl }),
    ).rejects.toThrowError(MetaTokenError);
  });
});
