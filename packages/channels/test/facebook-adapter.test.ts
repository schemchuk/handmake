import type { DeliverContext, RemoteId, SendOperation } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { FacebookAdapter } from '../src/facebook/adapter';

const PAGE_ID = 'fb-page-1';
const TOKEN = 'page-token-1';
const REFRESHED_TOKEN = 'page-token-refreshed';

const SECRETS: Record<string, string> = {
  FACEBOOK_PAGE_ID: PAGE_ID,
  FACEBOOK_PAGE_ACCESS_TOKEN: TOKEN,
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
  idempotencyBase: 't:p:facebook',
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
  /** Pre-router hook: return a Response to short-circuit (error injection). */
  fail?: (req: RecordedRequest, n: number) => Response | undefined;
  /** Token the fake exchange endpoint returns. */
  exchangedToken?: string;
}

/**
 * Routes the adapter's Graph API calls: /oauth/access_token (token
 * exchange), /{page}/photos (published photo post or unpublished upload),
 * /{page}/feed (multi-photo post).
 */
function graphHandler(behavior: GraphBehavior = {}) {
  const state = { photos: 0, feeds: 0 };
  const handler = (req: RecordedRequest, n: number): Response => {
    const failed = behavior.fail?.(req, n);
    if (failed) return failed;
    const path = new URL(req.url).pathname;
    if (path.endsWith('/oauth/access_token')) {
      return jsonResponse({ access_token: behavior.exchangedToken ?? REFRESHED_TOKEN });
    }
    if (path.endsWith('/photos')) {
      state.photos += 1;
      return jsonResponse({ id: `photo-${state.photos}` });
    }
    if (path.endsWith('/feed')) {
      state.feeds += 1;
      return jsonResponse({ id: `post-${state.feeds}` });
    }
    return jsonResponse({ error: { message: `unrouted ${path}` } }, 404);
  };
  return handler;
}

const adapterWith = (
  handler: (req: RecordedRequest, n: number) => Response,
  options: ConstructorParameters<typeof FacebookAdapter>[0] = {},
) => new FacebookAdapter({ fetchImpl: fakeFetch(handler).fetchImpl, sleep: sleepNoop, ...options });

describe('FacebookAdapter', () => {
  it('delivers one photo as one published photo post', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    const ids = await adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] }), {
      startAt: 0,
      knownIds: [],
      onDelivered: () => {},
    });

    expect(ids).toEqual(['photo-1']);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.json).toEqual({ url: PHOTO_1, caption: 'Hallo!' });
    expect(new URL(requests[0]!.url).pathname).toBe(`/v21.0/${PAGE_ID}/photos`);
    expect(new URL(requests[0]!.url).searchParams.get('access_token')).toBe(TOKEN);
  });

  it('omits the caption key when the op has none', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    await adapter.deliver([onePhotoOp({ caption: undefined })], makeCtx({ photoUrls: [PHOTO_1] }));

    expect(requests[0]!.json).toEqual({ url: PHOTO_1 });
  });

  it('delivers 2-10 photos as unpublished uploads plus one attaching feed post', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });
    const op = onePhotoOp({ photoIndexes: [0, 1, 2] });

    const ids = await adapter.deliver([op], makeCtx({ photoUrls: PHOTO_URLS }));

    expect(ids).toEqual(['post-1']);
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      `/v21.0/${PAGE_ID}/photos`,
      `/v21.0/${PAGE_ID}/photos`,
      `/v21.0/${PAGE_ID}/photos`,
      `/v21.0/${PAGE_ID}/feed`,
    ]);
    // Uploads carry no caption and stay unpublished; the feed post carries
    // the caption and attaches every upload id.
    expect(requests[0]!.json).toEqual({ url: PHOTO_1, published: false });
    expect(requests[1]!.json).toEqual({ url: PHOTO_2, published: false });
    expect(requests[2]!.json).toEqual({ url: PHOTO_3, published: false });
    expect(requests[3]!.json).toEqual({
      message: 'Hallo!',
      attached_media: [
        { media_fbid: 'photo-1' },
        { media_fbid: 'photo-2' },
        { media_fbid: 'photo-3' },
      ],
    });
  });

  it('omits the message key on a multi-photo op without a caption', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });
    const op = onePhotoOp({ photoIndexes: [0, 1], caption: undefined });

    await adapter.deliver([op], makeCtx({ photoUrls: PHOTO_URLS }));

    expect(requests.at(-1)!.json).toEqual({
      attached_media: [{ media_fbid: 'photo-1' }, { media_fbid: 'photo-2' }],
    });
  });

  it('resumes at startAt, keeping the known prefix and sending only the rest', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });
    const reported: { opIndex: number; remoteId: RemoteId }[] = [];
    const ops = [onePhotoOp(), onePhotoOp({ photoIndexes: [1], caption: 'Zweites' })];

    const ids = await adapter.deliver(ops, makeCtx({ photoUrls: PHOTO_URLS }), {
      startAt: 1,
      knownIds: ['photo-0'],
      onDelivered: (opIndex, remoteId) => void reported.push({ opIndex, remoteId }),
    });

    expect(ids).toEqual(['photo-0', 'photo-1']);
    expect(reported).toEqual([{ opIndex: 1, remoteId: 'photo-1' }]);
    // Op 0 is not re-sent: one photo post for op 1 only.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.json).toEqual({ url: PHOTO_2, caption: 'Zweites' });
  });

  it('awaits onDelivered before sending the next op', async () => {
    const events: string[] = [];
    const graph = graphHandler();
    const handler = (req: RecordedRequest, n: number): Response => {
      events.push(`request:${n}`);
      return graph(req, n);
    };
    const { fetchImpl } = fakeFetch(handler);
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });
    const ops = [onePhotoOp(), onePhotoOp({ photoIndexes: [1], caption: 'Zweites' })];

    await adapter.deliver(ops, makeCtx({ photoUrls: PHOTO_URLS }), {
      startAt: 0,
      knownIds: [],
      onDelivered: (opIndex) => void events.push(`delivered:${opIndex}`),
    });

    expect(events).toEqual(['request:1', 'delivered:0', 'request:2', 'delivered:1']);
  });

  it('rejects missing photoUrls before any network call', async () => {
    const { fetchImpl, requests } = fakeFetch(graphHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

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
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: ['http://example.com/01.jpg'] })),
    ).rejects.toThrowError(/must be a public https URL/);
    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: ['/relative/01.jpg'] })),
    ).rejects.toThrowError(/must be a public https URL/);
    expect(requests).toHaveLength(0);
  });

  it('retries a 429 on the feed post without re-uploading the photos', async () => {
    const { sleeps, sleep } = sleepRecorder();
    let feedAttempts = 0;
    const handler = graphHandler({
      fail: (req) => {
        if (new URL(req.url).pathname.endsWith('/feed')) {
          feedAttempts += 1;
          if (feedAttempts === 1) {
            return jsonResponse({ error: { message: 'Too Many Requests' } }, 429);
          }
        }
        return undefined;
      },
    });
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new FacebookAdapter({ fetchImpl, sleep, rateLimitBackoffMs: 500 });
    const op = onePhotoOp({ photoIndexes: [0, 1] });

    const ids = await adapter.deliver([op], makeCtx({ photoUrls: PHOTO_URLS }));

    expect(ids).toEqual(['post-1']);
    // 2 uploads + 2 feed attempts: the uploads made before the 429 are
    // reused, not re-uploaded (call-level retry).
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      `/v21.0/${PAGE_ID}/photos`,
      `/v21.0/${PAGE_ID}/photos`,
      `/v21.0/${PAGE_ID}/feed`,
      `/v21.0/${PAGE_ID}/feed`,
    ]);
    expect(sleeps).toEqual([500]);
  });

  it('stops retrying a persistent 429 after maxAttempts', async () => {
    const handler = graphHandler({
      fail: (req) =>
        new URL(req.url).pathname.endsWith('/photos')
          ? jsonResponse({ error: { message: 'Too Many Requests' } }, 429)
          : undefined,
    });
    let photoAttempts = 0;
    const counting = (req: RecordedRequest, n: number): Response => {
      if (new URL(req.url).pathname.endsWith('/photos')) photoAttempts += 1;
      return handler(req, n);
    };
    const adapter = adapterWith(counting, { maxAttempts: 3 });

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/rate limited/);
    expect(photoAttempts).toBe(3);
  });

  it('exchanges an expired token once per deliver and retries with the new token', async () => {
    const { fetchImpl, requests } = fakeFetch(
      graphHandler({
        fail: (req) =>
          new URL(req.url).searchParams.get('access_token') === TOKEN &&
          new URL(req.url).pathname.endsWith('/photos')
            ? jsonResponse(
                { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
                400,
              )
            : undefined,
      }),
    );
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    const ids = await adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] }));

    expect(ids).toEqual(['photo-1']);
    // photos (190) → exchange → photos (new token).
    expect(requests).toHaveLength(3);
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
      if (url.pathname.endsWith('/photos') && url.searchParams.has('access_token')) {
        // Every photo post fails with an expired token, old or new.
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
      if (url.pathname.endsWith('/photos')) {
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
          new URL(req.url).pathname.endsWith('/photos')
            ? jsonResponse({ error: { code: 100, message: 'Invalid image URL format' } }, 400)
            : undefined,
      }),
    );
    await expect(
      failing.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/\/photos failed: Invalid image URL format/);

    const generic = adapterWith(
      graphHandler({
        fail: (req) =>
          new URL(req.url).pathname.endsWith('/photos')
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
          new URL(req.url).pathname.endsWith('/photos') ? jsonResponse({}, 500) : undefined,
      }),
    );
    await expect(
      httpOnly.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/\/photos failed: HTTP 500/);
  });

  it('reports malformed JSON and network failures per call', async () => {
    const malformed = adapterWith(() => new Response('not json', { status: 200 }));
    await expect(
      malformed.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/returned malformed JSON/);

    const network = new FacebookAdapter({
      fetchImpl: (async () => {
        throw new Error('socket hangup');
      }) as typeof fetch,
      sleep: sleepNoop,
    });
    await expect(
      network.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/request failed: socket hangup/);
  });

  it('rejects malformed photo-post and feed-post results', async () => {
    const noPhotoId = adapterWith((req) =>
      new URL(req.url).pathname.endsWith('/photos') ? jsonResponse({}) : graphHandler()(req, 0),
    );
    await expect(
      noPhotoId.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1] })),
    ).rejects.toThrowError(/photo post returned a malformed result/);

    const noFeedId = adapterWith((req) =>
      new URL(req.url).pathname.endsWith('/feed') ? jsonResponse({}) : graphHandler()(req, 0),
    );
    await expect(
      noFeedId.deliver([onePhotoOp({ photoIndexes: [0, 1] })], makeCtx({ photoUrls: PHOTO_URLS })),
    ).rejects.toThrowError(/feed post returned a malformed result/);
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
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });
    const emptySecrets = {
      resolve: async (name: string) =>
        name === 'FACEBOOK_PAGE_ACCESS_TOKEN' ? '' : (SECRETS[name] ?? ''),
    };

    await expect(
      adapter.deliver([onePhotoOp()], makeCtx({ photoUrls: [PHOTO_1], secrets: emptySecrets })),
    ).rejects.toThrowError(/"FACEBOOK_PAGE_ACCESS_TOKEN" resolved to an empty access token/);
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
