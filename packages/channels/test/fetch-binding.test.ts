import { afterEach, describe, expect, it, vi } from 'vitest';

import { MetaGraphClient } from '../src/meta/graph';
import { TelegramAdapter } from '../src/telegram/adapter';

describe('default fetch receiver', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWorkerFetch(body: unknown) {
    const requests: { input: unknown; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async function (this: unknown, input: unknown, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      requests.push({ input, init });
      return new Response(JSON.stringify(body));
    });
    return requests;
  }

  it('calls the global fetch without binding it to MetaGraphClient', async () => {
    const body = { data: [{ id: 'comment-1' }] };
    const requests = stubWorkerFetch(body);
    const client = new MetaGraphClient('Instagram');

    await expect(client.call({ token: 'test-token' }, 'GET', '/media-1/comments')).resolves.toEqual(
      body,
    );
    expect(requests).toEqual([
      {
        input: 'https://graph.facebook.com/v21.0/media-1/comments?access_token=test-token',
        init: { method: 'GET' },
      },
    ]);
  });

  it('calls the global fetch without binding it to TelegramAdapter', async () => {
    const requests = stubWorkerFetch({ ok: true, result: { message_id: 1 } });
    const adapter = new TelegramAdapter({ token: 'test-token' });

    await expect(
      adapter.deliver(
        [{ kind: 'message', text: 'Hello', lang: 'de' }],
        {
          secrets: { resolve: async () => 'chat-1' },
          idempotencyBase: 'tenant:post:telegram',
          settings: { channelId: 'TEST_CHANNEL' },
          photos: [],
        },
        { startAt: 0, knownIds: [], onDelivered: () => {} },
      ),
    ).resolves.toEqual([1]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('https://api.telegram.org/bottest-token/sendMessage');
  });
});
