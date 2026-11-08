import type { DeliverContext, RemoteId, SendOperation } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { InstagramAdapter } from '../src/instagram/adapter';

const USER_ID = 'ig-user-1';
const TOKEN = 'token-1';
const REFRESHED_TOKEN = 'token-refreshed';

const SECRETS: Record<string, string> = {
  INSTAGRAM_USER_ID: USER_ID,
  INSTAGRAM_ACCESS_TOKEN: TOKEN,
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'app-secret-1',
};

const PHOTO_1 = 'https://raw.example/01.jpg';
const PHOTO_2 = 'https://raw.example/02.jpg';
const PHOTO_3 = 'https://raw.example/03.jpg';
const PHOTO_URLS = [PHOTO_1, PHOTO_2, PHOTO_3];

interface RecordedRequest {
  url: string;
  form?: FormData;
  json?: Record<string, unknown>;
}

/** Records requests and serves canned responses; no network. */
function fakeFetch(handler: (req: RecordedRequest, n: number) => Response) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const record: RecordedRequest = { url: String(input) };
    if (init?.body instanceof FormData) record.form = init.body;
    if (typeof init?.body === 'string') record.json = JSON.parse(init.body);
    requests.push(record);
    return handler(record, requests.length);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const sleepNoop = async (): Promise<void> => {};

const sleepRecorder = () => {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
};

const makeCtx = (overrides: Partial<DeliverContext> = {}): DeliverContext => ({
  secrets: {
    resolve: async (name: string) => SECRETS[name] ?? '',
  },
  idempotencyBase: 't:p:instagram',
  settings: { language: 'de' },
  photos: [],
  ...overrides,
});

const onePhotoOp = (overrides: Partial<Extract<SendOperation, { kind: 'mediaGroup' }>> = {}) => ({
  kind: 'mediaGroup' as const,
  photoIndexes: [0],
  caption: 'Hallo!',
  captionLang: 'de',
  ...overrides,
});

interface GraphBehavior {
  /** Per-container status sequence for the status polls; default ['FINISHED']. */
  statuses?: Record<string, string[]>;
  /** Pre-router hook: return a Response to short-circuit (error injection). */
  fail?: (req: RecordedRequest, n: number) => Response | undefined;
  /** Token the fake exchange endpoint returns. */
  exchangedToken?: string;
}

/**
 * Routes the adapter's Graph API calls: /oauth/access_token, /{user}/media
 * (container creation), /{container} (status polls), /{user}/media_publish.
 */
function graphHandler(behavior: GraphBehavior = {}) {
  const state = { containers: 0, publishes: 0, polls: new Map<string, number>() };
  const handler = (req: RecordedRequest, n: number): Response => {
    const failed = behavior.fail?.(req, n);
    if (failed) return failed;
    const path = new URL(req.url).pathname;
    if (path.endsWith('/oauth/access_token')) {
      return jsonResponse({ access_token: behavior.exchangedToken ?? REFRESHED_TOKEN });
    }
    if (path.endsWith('/media_publish')) {
      state.publishes += 1;
      return jsonResponse({ id: `media-${state.publishes}` });
    }
    if (path.endsWith('/media')) {
      state.containers += 1;
      return jsonResponse({ id: `container-${state.containers}` });
    }
    const id = path.split('/').pop()!;
    const seq = behavior.statuses?.[id] ?? ['FINISHED'];
    const poll = state.polls.get(id) ?? 0;
    state.polls.set(id, poll + 1);
    return jsonResponse({ status_code: seq[Math.min(poll, seq.length - 1)] });
  };
  return handler;
}

const adapterWith = (
  handler: (req: RecordedRequest, n: number) => Response,
  options: ConstructorParameters<typeof InstagramAdapter>[0] = {},
) =>
  new InstagramAdapter({ fetchImpl: fakeFetch(handler).fetchImpl, sleep: sleepNoop, ...options });

describe('InstagramAdapter', () => {
  it('delivers one photo as a single image container, polls status, publishes', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const ids = await adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] }), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });

    expect(ids).toEqual(['media-1']);
    expect(requests).toHaveLength(3);
    expect(requests[0]!.json).toEqual({
      image_url: PHOTO_1,
      caption: 'Hallo!',
    });
    expect(new URL(requests[0]!.url).pathname).toBe(`/v21.0/${USER_ID}/media`);
    expect(new URL(requests[0]!.url).searchParams.get('access_token')).toBe(TOKEN);
    expect(new URL(requests[1]!.url).pathname).toBe('/v21.0/container-1');
    expect(new URL(requests[1]!.url).searchParams.get('fields')).toBe('status_code');
    expect(requests[2]!.json).toEqual({ creation_id: 'container-1' });
  });

  it('omits the caption key when the op has none', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    await adapter.deliver([onePhotoOp({ caption: undefined })], makeCtx({ photoUrls: [PHOTO_1] }));

    expect(requests[0]!.json).toEqual({ image_url: PHOTO_1 });
  });

  it('delivers 2-10 photos as carousel children plus one carousel container', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });
    const op = onePhotoOp({ photoIndexes: [0, 1, 2] });

    const ids = await adapter.deliver([op], makeCtx({ photoUrls: PHOTO_URLS }));

    expect(ids).toEqual(['media-1']);
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      '/v21.0/container-4',
      `/v21.0/${USER_ID}/media_publish`,
    ]);
    // Children carry no caption; the carousel container carries it and the child ids.
    expect(requests[0]!.json).toEqual({ image_url: PHOTO_1, is_carousel_item: true });
    expect(requests[1]!.json).toEqual({ image_url: PHOTO_2, is_carousel_item: true });
    expect(requests[2]!.json).toEqual({ image_url: PHOTO_3, is_carousel_item: true });
    expect(requests[3]!.json).toEqual({
      children: ['container-1', 'container-2', 'container-3'],
      caption: 'Hallo!',
    });
    // Only the carousel container is polled and published.
    expect(requests[4]!.url).toContain('container-4');
    expect(requests[5]!.json).toEqual({ creation_id: 'container-4' });
  });

  it('polls an in-progress container until FINISHED, sleeping between polls', async () => {
    const { sleeps, sleep } = sleepRecorder();
    const adapter = adapterWith(
      graphHandler({ statuses: { 'container-1': ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'] } }),
      { sleep, statusPollIntervalMs: 250 },
    );

    const ids = await adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] }));

    expect(ids).toEqual(['media-1']);
    expect(sleeps).toEqual([250, 250]);
  });

  it('fails the op when the container ends EXPIRED or ERROR', async () => {
    const adapter = adapterWith(graphHandler({ statuses: { 'container-1': ['EXPIRED'] } }));
    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/media container expired/);

    const errorAdapter = adapterWith(graphHandler({ statuses: { 'container-1': ['ERROR'] } }));
    await expect(
      errorAdapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/media container error/);
  });

  it('gives up polling after statusPollMaxAttempts', async () => {
    const { sleeps, sleep } = sleepRecorder();
    const adapter = adapterWith(graphHandler({ statuses: { 'container-1': ['IN_PROGRESS'] } }), {
      sleep,
      statusPollIntervalMs: 100,
      statusPollMaxAttempts: 3,
    });

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/did not finish after 3 status polls/);
    expect(sleeps).toEqual([100, 100]);
  });

  it('resumes at startAt, keeping the known prefix and sending only the rest', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });
    const reported: { opIndex: number; remoteId: RemoteId }[] = [];
    const ops = [onePhotoOp(), onePhotoOp({ photoIndexes: [1], caption: 'Zweites' })];

    const ids = await adapter.deliver(ops, makeCtx({ photoUrls: PHOTO_URLS }), {
      startAt: 1,
      knownIds: ['media-0'],
      onDelivered: (opIndex, remoteId) => void reported.push({ opIndex, remoteId }),
    });

    expect(ids).toEqual(['media-0', 'media-1']);
    expect(reported).toEqual([{ opIndex: 1, remoteId: 'media-1' }]);
    // Op 0 is not re-sent: one container (op 1's photo), one poll, one publish.
    expect(requests).toHaveLength(3);
    expect(requests[0]!.json).toEqual({
      image_url: PHOTO_2,
      caption: 'Zweites',
    });
  });

  it('awaits onDelivered before sending the next op', async () => {
    const events: string[] = [];
    const graph = graphHandler();
    const handler = (req: RecordedRequest, n: number): Response => {
      events.push(`request:${n}`);
      return graph(req, n);
    };
    const { fetchImpl } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });
    const ops = [onePhotoOp(), onePhotoOp({ photoIndexes: [1], caption: 'Zweites' })];

    await adapter.deliver(ops, makeCtx({ photoUrls: PHOTO_URLS }), {
      startAt: 0,
      knownIds: [],
      onDelivered: (opIndex) => void events.push(`delivered:${opIndex}`),
    });

    expect(events).toEqual([
      'request:1',
      'request:2',
      'request:3',
      'delivered:0',
      'request:4',
      'request:5',
      'request:6',
      'delivered:1',
    ]);
  });

  it('rejects missing photoUrls before any network call', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    await expect(adapter.deliver([onePhotoOp()], makeCtx())).rejects.toThrowError(
      /missing photo URL at index 0/,
    );
    await expect(
      adapter.deliver([onePhotoOp({ photoIndexes: [0, 1] })], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/missing photo URL at index 1/);
    expect(requests).toHaveLength(0);
  });

  it('rejects non-https photoUrls before any network call', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: ['http://example.com/01.jpg'] })),
    ).rejects.toThrowError(/must be a public https URL/);
    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: ['/relative/01.jpg'] })),
    ).rejects.toThrowError(/must be a public https URL/);
    expect(requests).toHaveLength(0);
  });

  it('retries a 429 like Telegram, bounded by maxAttempts', async () => {
    const { sleeps, sleep } = sleepRecorder();
    let mediaAttempts = 0;
    const handler = graphHandler({
      fail: (req) => {
        if (new URL(req.url).pathname.endsWith('/media') && req.json?.is_carousel_item !== true) {
          mediaAttempts += 1;
          if (mediaAttempts === 1) {
            return jsonResponse({ error: { message: 'Too Many Requests' } }, 429);
          }
        }
        return undefined;
      },
    });
    const adapter = adapterWith(handler, { sleep, rateLimitBackoffMs: 500 });

    const ids = await adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] }));

    expect(ids).toEqual(['media-1']);
    expect(sleeps).toEqual([500]);
  });

  it('stops retrying a persistent 429 after maxAttempts', async () => {
    const handler = graphHandler({
      fail: (req) =>
        new URL(req.url).pathname.endsWith('/media') && req.json?.is_carousel_item !== true
          ? jsonResponse({ error: { message: 'Too Many Requests' } }, 429)
          : undefined,
    });
    let mediaAttempts = 0;
    const counting = (req: RecordedRequest, n: number): Response => {
      if (new URL(req.url).pathname.endsWith('/media')) mediaAttempts += 1;
      return handler(req, n);
    };
    const adapter = adapterWith(counting, { maxAttempts: 3 });

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/rate limited/);
    expect(mediaAttempts).toBe(3);
  });

  it('retries a 429 on the carousel container without recreating the children', async () => {
    const { sleeps, sleep } = sleepRecorder();
    let carouselAttempts = 0;
    const handler = graphHandler({
      fail: (req) => {
        // The carousel container is the only non-child /media POST.
        if (new URL(req.url).pathname.endsWith('/media') && req.json?.is_carousel_item !== true) {
          carouselAttempts += 1;
          if (carouselAttempts === 1) {
            return jsonResponse({ error: { message: 'Too Many Requests' } }, 429);
          }
        }
        return undefined;
      },
    });
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep, rateLimitBackoffMs: 500 });
    const op = onePhotoOp({ photoIndexes: [0, 1, 2] });

    const ids = await adapter.deliver([op], makeCtx({ photoUrls: PHOTO_URLS }));

    expect(ids).toEqual(['media-1']);
    // 3 children + 2 carousel attempts; the children created before the 429
    // are reused, not recreated (call-level retry).
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      '/v21.0/container-4',
      `/v21.0/${USER_ID}/media_publish`,
    ]);
    expect(requests[3]!.json).toEqual({
      children: ['container-1', 'container-2', 'container-3'],
      caption: 'Hallo!',
    });
    expect(sleeps).toEqual([500]);
  });

  it('retries a 429 on one carousel child without recreating the earlier children', async () => {
    const { sleeps, sleep } = sleepRecorder();
    let secondChildAttempts = 0;
    const handler = graphHandler({
      fail: (req) => {
        if (new URL(req.url).pathname.endsWith('/media') && req.json?.is_carousel_item === true) {
          secondChildAttempts += 1;
          if (secondChildAttempts === 2) {
            return jsonResponse({ error: { message: 'Too Many Requests' } }, 429);
          }
        }
        return undefined;
      },
    });
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep, rateLimitBackoffMs: 700 });
    const op = onePhotoOp({ photoIndexes: [0, 1] });

    const ids = await adapter.deliver([op], makeCtx({ photoUrls: PHOTO_URLS }));

    expect(ids).toEqual(['media-1']);
    // child 1, child 2 (429), child 2 retried, carousel, poll, publish:
    // exactly two child creations, never three.
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      `/v21.0/${USER_ID}/media`,
      '/v21.0/container-3',
      `/v21.0/${USER_ID}/media_publish`,
    ]);
    expect(requests[3]!.json).toEqual({
      children: ['container-1', 'container-2'],
      caption: 'Hallo!',
    });
    expect(sleeps).toEqual([700]);
  });

  it('exchanges an expired token once per deliver and retries with the new token', async () => {
    const { fetchImpl, requests } = fakeFetch(
      graphHandler({
        fail: (req) =>
          new URL(req.url).searchParams.get('access_token') === TOKEN &&
          new URL(req.url).pathname.endsWith('/media')
            ? jsonResponse(
                { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
                400,
              )
            : undefined,
      }),
    );
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const ids = await adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] }));

    expect(ids).toEqual(['media-1']);
    // media (190) → exchange → media (new token) → poll → publish.
    expect(requests).toHaveLength(5);
    const exchange = new URL(requests[1]!.url);
    expect(exchange.pathname).toBe('/v21.0/oauth/access_token');
    expect(exchange.searchParams.get('grant_type')).toBe('fb_exchange_token');
    expect(exchange.searchParams.get('client_id')).toBe('app-1');
    expect(exchange.searchParams.get('client_secret')).toBe('app-secret-1');
    expect(exchange.searchParams.get('fb_exchange_token')).toBe(TOKEN);
    expect(new URL(requests[2]!.url).searchParams.get('access_token')).toBe(REFRESHED_TOKEN);
  });

  it('refreshes the token at most once per deliver', async () => {
    let exchanges = 0;
    const graph = graphHandler();
    const handler = (req: RecordedRequest, n: number): Response => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/oauth/access_token')) exchanges += 1;
      if (
        url.pathname.endsWith('/media') &&
        url.searchParams.get('access_token') !== undefined &&
        req.json?.is_carousel_item !== true
      ) {
        // Every container creation fails with an expired token, old or new.
        return jsonResponse(
          { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
          400,
        );
      }
      return graph(req, n);
    };
    const adapter = adapterWith(handler);

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/access token expired/);
    expect(exchanges).toBe(1);
  });

  it('fails cleanly when the token exchange itself fails', async () => {
    const handler = (req: RecordedRequest, n: number): Response => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/oauth/access_token')) {
        return jsonResponse({ error: { message: 'Invalid appsecret' } }, 400);
      }
      if (url.pathname.endsWith('/media') && req.json?.is_carousel_item !== true) {
        return jsonResponse(
          { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
          400,
        );
      }
      return graphHandler()(req, n);
    };
    const adapter = adapterWith(handler);

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/token refresh failed: Meta token exchange failed: Invalid appsecret/);
  });

  it('maps Graph API errors without ever leaking the token', async () => {
    const failing = adapterWith(
      graphHandler({
        fail: (req) =>
          new URL(req.url).pathname.endsWith('/media') && req.json?.is_carousel_item !== true
            ? jsonResponse({ error: { code: 100, message: 'Invalid image URL format' } }, 400)
            : undefined,
      }),
    );
    await expect(
      failing.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/\/media failed: Invalid image URL format/);

    const generic = adapterWith(
      graphHandler({
        fail: (req) =>
          new URL(req.url).pathname.endsWith('/media') && req.json?.is_carousel_item !== true
            ? jsonResponse({ error: { code: 190, message: 'Invalid OAuth access token.' } }, 400)
            : undefined,
      }),
    );
    // A non-expired 190 is a plain error; the message must not contain the token.
    let message = '';
    await generic.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })).catch((e) => {
      message = (e as Error).message;
    });
    expect(message).toContain('Invalid OAuth access token.');
    expect(message).not.toContain(TOKEN);

    const httpOnly = adapterWith(
      graphHandler({
        fail: (req) =>
          new URL(req.url).pathname.endsWith('/media') && req.json?.is_carousel_item !== true
            ? jsonResponse({}, 500)
            : undefined,
      }),
    );
    await expect(
      httpOnly.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/\/media failed: HTTP 500/);
  });

  it('reports malformed JSON and network failures per call', async () => {
    const malformed = adapterWith(() => new Response('not json', { status: 200 }));
    await expect(
      malformed.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/returned malformed JSON/);

    const network = new InstagramAdapter({
      fetchImpl: (async () => {
        throw new Error('socket hangup');
      }) as typeof fetch,
      sleep: sleepNoop,
    });
    await expect(
      network.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/request failed: socket hangup/);
  });

  it('rejects non-mediaGroup ops, replies, empty and oversized groups', async () => {
    const adapter = adapterWith(graphHandler());

    await expect(
      adapter.deliver(
        [{ kind: 'message', text: 'Hallo!', lang: 'de' }],
        makeCtx({ photoUrls: PHOTO_URLS }),
      ),
    ).rejects.toThrowError(/only mediaGroup ops/);
    await expect(
      adapter.deliver([onePhotoOp({ replyToOp: 0 })], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/replyToOp is not supported/);
    await expect(
      adapter.deliver([onePhotoOp({ photoIndexes: [] })], makeCtx({ photoUrls: [] })),
    ).rejects.toThrowError(/no photos to send/);
    await expect(
      adapter.deliver(
        [onePhotoOp({ photoIndexes: Array.from({ length: 11 }, (_, i) => i) })],
        makeCtx({ photoUrls: Array.from({ length: 11 }, (_, i) => `https://x.example/${i}.jpg`) }),
      ),
    ).rejects.toThrowError(/more than 10 photos/);
  });

  it('rejects empty resolved secrets by name, without network calls', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });
    const emptySecrets = {
      resolve: async (name: string) =>
        name === 'INSTAGRAM_ACCESS_TOKEN' ? '' : (SECRETS[name] ?? ''),
    };

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1], secrets: emptySecrets })),
    ).rejects.toThrowError(/"INSTAGRAM_ACCESS_TOKEN" resolved to an empty access token/);
    expect(requests).toHaveLength(0);
  });

  it('rejects an inconsistent progress prefix', async () => {
    const adapter = adapterWith(graphHandler());

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] }), {
        startAt: 1,
        knownIds: [],
        onDelivered: () => {},
      }),
    ).rejects.toThrowError(/invalid progress/);
  });
});
