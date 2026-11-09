import type { ChannelCommentsContext } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { FacebookAdapter, FacebookAdapterError } from '../src/facebook/adapter';
import { InstagramAdapter, InstagramAdapterError } from '../src/instagram/adapter';

const IG_USER_ID = 'ig-user-1';
const FB_PAGE_ID = 'page-1';
const TOKEN = 'token-1';
const REFRESHED_TOKEN = 'token-refreshed';
const READER_HANDLE = 'anna_reader';
const READER_TEXT = 'Wunderschöne Stickerei!';

const IG_SECRETS: Record<string, string> = {
  INSTAGRAM_USER_ID: IG_USER_ID,
  INSTAGRAM_ACCESS_TOKEN: TOKEN,
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'app-secret-1',
};
const FB_SECRETS: Record<string, string> = {
  FACEBOOK_PAGE_ID: FB_PAGE_ID,
  FACEBOOK_PAGE_ACCESS_TOKEN: TOKEN,
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'app-secret-1',
};

interface RecordedRequest {
  method: string;
  url: string;
  json?: Record<string, unknown>;
}

/** Records requests and serves canned responses; no network. */
function fakeFetch(handler: (req: RecordedRequest, n: number) => Response) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const record: RecordedRequest = { method: init?.method ?? 'GET', url: String(input) };
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

const makeCtx = (secrets: Record<string, string>): ChannelCommentsContext => ({
  secrets: { resolve: async (name: string) => secrets[name] ?? '' },
});

const igAdapter = (
  handler: (req: RecordedRequest, n: number) => Response,
  options: ConstructorParameters<typeof InstagramAdapter>[0] = {},
) =>
  new InstagramAdapter({ fetchImpl: fakeFetch(handler).fetchImpl, sleep: sleepNoop, ...options });

/**
 * Routes an Instagram comments-capability run: /{user}/media (posts),
 * /{media}/comments, /{comment}/replies and /oauth/access_token (exchange).
 */
function igHandler(
  behavior: { fail?: (req: RecordedRequest, n: number) => Response | undefined } = {},
) {
  return (req: RecordedRequest, n: number): Response => {
    const failed = behavior.fail?.(req, n);
    if (failed) return failed;
    const url = new URL(req.url);
    const path = url.pathname;
    if (path.endsWith('/oauth/access_token')) {
      return jsonResponse({ access_token: REFRESHED_TOKEN });
    }
    if (path.endsWith('/replies')) {
      return jsonResponse({ id: 'reply-1' });
    }
    if (path.endsWith('/comments')) {
      return jsonResponse({
        data: [
          {
            id: 'c1',
            username: READER_HANDLE,
            text: READER_TEXT,
            timestamp: '2026-11-09T10:05:00+0000',
          },
        ],
      });
    }
    if (path.endsWith('/media')) {
      return jsonResponse({
        data: [
          { id: 'media-2', timestamp: '2026-11-08T09:00:00+0000' },
          { id: 'media-1', timestamp: '2026-11-07T09:00:00+0000' },
        ],
      });
    }
    return jsonResponse({}, 404);
  };
}

/** Routes a Facebook comments-capability run: /{page}/posts, /{post}/comments, /{comment}/comments. */
function fbHandler() {
  return (req: RecordedRequest, _n: number): Response => {
    const path = new URL(req.url).pathname;
    if (req.method === 'POST' && path.endsWith('/comments')) {
      return jsonResponse({ id: 'reply-1' });
    }
    if (path.endsWith('/posts')) {
      return jsonResponse({
        data: [
          {
            id: 'post-2',
            created_time: '2026-11-08T09:00:00+0000',
            from: { id: FB_PAGE_ID },
          },
          { id: 'post-1', created_time: '2026-11-07T09:00:00+0000', from: { id: FB_PAGE_ID } },
        ],
      });
    }
    if (path.endsWith('/comments')) {
      return jsonResponse({
        data: [
          {
            id: 'post-1_c2',
            message: READER_TEXT,
            created_time: '2026-11-09T10:05:00+0000',
            from: { id: 'reader-1', name: READER_HANDLE },
          },
          {
            id: 'post-1_c1',
            message: 'Danke!',
            created_time: '2026-11-09T10:00:00+0000',
            from: { id: FB_PAGE_ID },
          },
          { id: 'post-1_c0', message: 'ohne absender', created_time: '2026-11-09T09:45:00+0000' },
        ],
      });
    }
    return jsonResponse({}, 404);
  };
}

describe('comments capability: Instagram', () => {
  it('lists our recent media posts newest first', async () => {
    const { fetchImpl, requests } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const posts = await adapter.comments.listPosts(10, makeCtx(IG_SECRETS));

    expect(posts).toEqual([
      { id: 'media-2', createdAt: '2026-11-08T09:00:00+0000' },
      { id: 'media-1', createdAt: '2026-11-07T09:00:00+0000' },
    ]);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe(`/v21.0/${IG_USER_ID}/media`);
    expect(url.searchParams.get('fields')).toBe('id,timestamp');
    expect(url.searchParams.get('access_token')).toBe(TOKEN);
  });

  it('rejects a non-positive or non-integer posts limit before any network call', async () => {
    const { fetchImpl, requests } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    await expect(adapter.comments.listPosts(0, makeCtx(IG_SECRETS))).rejects.toThrowError(
      /limit must be a positive integer/,
    );
    await expect(adapter.comments.listPosts(1.5, makeCtx(IG_SECRETS))).rejects.toThrowError(
      /limit must be a positive integer/,
    );
    expect(requests).toHaveLength(0);
  });

  it('stops collecting posts once the limit is reached, without the next page', async () => {
    const paged = igHandler();
    const handler = (req: RecordedRequest, n: number): Response => {
      const response = paged(req, n);
      if (new URL(req.url).pathname.endsWith('/media')) {
        return jsonResponse({
          data: [
            { id: 'media-2', timestamp: '2026-11-08T09:00:00+0000' },
            { id: 'media-1', timestamp: '2026-11-07T09:00:00+0000' },
          ],
          paging: { next: 'https://graph.facebook.com/v21.0/ig-user-1/media?after=cursor' },
        });
      }
      return response;
    };
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const posts = await adapter.comments.listPosts(1, makeCtx(IG_SECRETS));

    expect(posts).toEqual([{ id: 'media-2', createdAt: '2026-11-08T09:00:00+0000' }]);
    expect(requests).toHaveLength(1);
  });

  it('follows cursor paging only up to the page bound', async () => {
    const handler = (req: RecordedRequest): Response => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/media')) {
        const page = url.searchParams.get('after') ?? 'p0';
        return jsonResponse({
          data: [{ id: `media-${page}`, timestamp: '2026-11-08T09:00:00+0000' }],
          paging: {
            next: `https://graph.facebook.com/v21.0/ig-user-1/media?after=${page}-next`,
          },
        });
      }
      return jsonResponse({}, 404);
    };
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new InstagramAdapter({
      fetchImpl,
      sleep: sleepNoop,
      commentsMaxPages: 2,
    });

    const posts = await adapter.comments.listPosts(50, makeCtx(IG_SECRETS));

    expect(posts.map((post) => post.id)).toEqual(['media-p0', 'media-p0-next']);
    expect(requests).toHaveLength(2);
    // The real-shaped next URL repeats the version segment; following it
    // must not request /v21.0/v21.0/... .
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      `/v21.0/${IG_USER_ID}/media`,
      `/v21.0/${IG_USER_ID}/media`,
    ]);
    expect(new URL(requests[1]!.url).searchParams.get('after')).toBe('p0-next');
  });

  it('strips the version prefix and any token from a real-shaped paging.next URL', async () => {
    const staleToken = 'stale-token-in-next-url';
    const handler = (req: RecordedRequest): Response => {
      const url = new URL(req.url);
      if (url.pathname !== `/v21.0/${IG_USER_ID}/media`) return jsonResponse({}, 404);
      if (url.searchParams.get('after') === null) {
        return jsonResponse({
          data: [{ id: 'media-p0', timestamp: '2026-11-08T09:00:00+0000' }],
          paging: {
            next: `https://graph.facebook.com/v21.0/${IG_USER_ID}/media?access_token=${staleToken}&after=c1`,
          },
        });
      }
      return jsonResponse({ data: 'corrupted' });
    };
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    let caught: unknown;
    await adapter.comments.listPosts(50, makeCtx(IG_SECRETS)).catch((error) => {
      caught = error;
    });

    expect(caught).toBeInstanceOf(InstagramAdapterError);
    const message = (caught as Error).message;
    // The error names the path only — never the query that carried the token.
    expect(message).toContain('/media returned a malformed result');
    expect(message).not.toContain(staleToken);
    expect(message).not.toContain(TOKEN);
    // The followed request re-authenticated with the current token only.
    expect(new URL(requests[1]!.url).searchParams.get('access_token')).toBe(TOKEN);
  });

  it('rejects a paging.next URL on a foreign origin', async () => {
    const handler = (req: RecordedRequest): Response =>
      new URL(req.url).pathname.endsWith('/media')
        ? jsonResponse({
            data: [{ id: 'media-p0', timestamp: '2026-11-08T09:00:00+0000' }],
            paging: { next: 'https://evil.example/v21.0/ig-user-1/media?after=c1' },
          })
        : jsonResponse({}, 404);
    const { fetchImpl } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    await expect(adapter.comments.listPosts(50, makeCtx(IG_SECRETS))).rejects.toThrowError(
      /paging.next URL has an unexpected origin/,
    );
  });

  it('lists comments newer than the watermark as unix seconds', async () => {
    const { fetchImpl, requests } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });
    const since = new Date('2026-11-09T10:00:00Z');

    const comments = await adapter.comments.listComments('media-1', since, makeCtx(IG_SECRETS));

    expect(comments).toEqual([
      {
        id: 'c1',
        handle: READER_HANDLE,
        text: READER_TEXT,
        createdAt: '2026-11-09T10:05:00+0000',
      },
    ]);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/v21.0/media-1/comments');
    expect(url.searchParams.get('fields')).toBe('id,text,username,timestamp');
    expect(url.searchParams.get('since')).toBe(String(Math.floor(since.getTime() / 1000)));
  });

  it('omits the since filter when no watermark is given', async () => {
    const { fetchImpl, requests } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    await adapter.comments.listComments('media-1', undefined, makeCtx(IG_SECRETS));

    expect(new URL(requests[0]!.url).searchParams.get('since')).toBeNull();
  });

  it('applies the watermark client-side when the edge ignores since', async () => {
    // The Instagram comments edge may drop the since filter: an entry at the
    // watermark, an older one and one without a timestamp all come back.
    const since = new Date('2026-11-09T10:00:00Z');
    const handler = (req: RecordedRequest): Response =>
      new URL(req.url).pathname.endsWith('/comments')
        ? jsonResponse({
            data: [
              {
                id: 'c-old',
                username: 'old_reader',
                text: 'älter',
                timestamp: '2026-11-09T09:00:00+0000',
              },
              {
                id: 'c-new',
                username: READER_HANDLE,
                text: READER_TEXT,
                timestamp: '2026-11-09T10:05:00+0000',
              },
              { id: 'c-notime', username: 'mystery', text: 'ohne Zeit' },
            ],
          })
        : jsonResponse({}, 404);
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const comments = await adapter.comments.listComments('media-1', since, makeCtx(IG_SECRETS));

    expect(comments.map((comment) => comment.id)).toEqual(['c-new', 'c-notime']);
    expect(new URL(requests[0]!.url).searchParams.get('since')).toBe(
      String(Math.floor(since.getTime() / 1000)),
    );
  });

  it('keeps watermark entries at exactly the watermark and drops strictly older ones', async () => {
    const since = new Date('2026-11-09T10:05:00Z');
    const { fetchImpl } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const comments = await adapter.comments.listComments('media-1', since, makeCtx(IG_SECRETS));

    // c1 sits exactly at the watermark: the inclusive client-side filter keeps
    // it (Graph timestamps have second resolution) and the caller dedupes the
    // repeat by id; strictly older entries are dropped.
    expect(comments.map((comment) => comment.id)).toEqual(['c1']);
  });

  it('replies to one comment and returns the reply id', async () => {
    const { fetchImpl, requests } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const replyId = await adapter.comments.replyToComment('c1', 'Danke!', makeCtx(IG_SECRETS));

    expect(replyId).toBe('reply-1');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(new URL(requests[0]!.url).pathname).toBe('/v21.0/c1/replies');
    expect(requests[0]!.json).toEqual({ message: 'Danke!' });
  });

  it('rejects an empty post id, comment id or reply text before any network call', async () => {
    const { fetchImpl, requests } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });
    const ctx = makeCtx(IG_SECRETS);

    await expect(adapter.comments.listComments('', undefined, ctx)).rejects.toThrowError(
      /post id must be a non-empty value/,
    );
    await expect(adapter.comments.replyToComment('  ', 'Danke!', ctx)).rejects.toThrowError(
      /comment id must be a non-empty value/,
    );
    await expect(adapter.comments.replyToComment('c1', '', ctx)).rejects.toThrowError(
      /reply text must be a non-empty string/,
    );
    expect(requests).toHaveLength(0);
  });

  it('retries a 429 per call like the publishing path', async () => {
    const { sleeps, sleep } = sleepRecorder();
    let attempts = 0;
    const handler = igHandler({
      fail: (req) => {
        if (new URL(req.url).pathname.endsWith('/comments') && attempts === 0) {
          attempts += 1;
          return jsonResponse({ error: { message: 'Too Many Requests' } }, 429);
        }
        return undefined;
      },
    });
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep, rateLimitBackoffMs: 500 });

    const comments = await adapter.comments.listComments('media-1', undefined, makeCtx(IG_SECRETS));

    expect(comments).toHaveLength(1);
    expect(sleeps).toEqual([500]);
    expect(requests).toHaveLength(2);
  });

  it('gives up a persistent 429 after maxAttempts', async () => {
    const handler = igHandler({
      fail: (req) =>
        new URL(req.url).pathname.endsWith('/comments')
          ? jsonResponse({ error: { message: 'Too Many Requests' } }, 429)
          : undefined,
    });
    let attempts = 0;
    const counting = (req: RecordedRequest, n: number): Response => {
      if (new URL(req.url).pathname.endsWith('/comments')) attempts += 1;
      return handler(req, n);
    };
    const adapter = igAdapter(counting, { maxAttempts: 3 });

    await expect(
      adapter.comments.listComments('media-1', undefined, makeCtx(IG_SECRETS)),
    ).rejects.toThrowError(/rate limited/);
    expect(attempts).toBe(3);
  });

  it('exchanges an expired token once per operation and retries with the new token', async () => {
    const { fetchImpl, requests } = fakeFetch(
      igHandler({
        fail: (req) =>
          new URL(req.url).searchParams.get('access_token') === TOKEN &&
          new URL(req.url).pathname.endsWith('/comments')
            ? jsonResponse(
                { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
                400,
              )
            : undefined,
      }),
    );
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    const comments = await adapter.comments.listComments('media-1', undefined, makeCtx(IG_SECRETS));

    expect(comments).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe('/v21.0/media-1/comments');
    expect(new URL(requests[1]!.url).pathname).toBe('/v21.0/oauth/access_token');
    expect(new URL(requests[2]!.url).searchParams.get('access_token')).toBe(REFRESHED_TOKEN);
  });

  it('does not refresh twice in one operation', async () => {
    let exchanges = 0;
    const handler = (req: RecordedRequest, n: number): Response => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/oauth/access_token')) exchanges += 1;
      return igHandler({
        fail: (failReq) =>
          new URL(failReq.url).pathname.endsWith('/comments')
            ? jsonResponse(
                { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
                400,
              )
            : undefined,
      })(req, n);
    };
    const adapter = igAdapter(handler);

    await expect(
      adapter.comments.listComments('media-1', undefined, makeCtx(IG_SECRETS)),
    ).rejects.toThrowError(/access token expired/);
    expect(exchanges).toBe(1);
  });

  it('maps Graph errors to the adapter error class without reader data', async () => {
    const readerDataHandler = igHandler({
      fail: () => jsonResponse({ error: { code: 100, message: 'Invalid appsecret' } }, 400),
    });
    const { fetchImpl } = fakeFetch(readerDataHandler);
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });

    let caught: unknown;
    await adapter.comments
      .listComments('media-1', undefined, makeCtx(IG_SECRETS))
      .catch((error) => {
        caught = error;
      });
    expect(caught).toBeInstanceOf(InstagramAdapterError);
    const message = (caught as Error).message;
    expect(message).toContain('/comments failed: Invalid appsecret');
    expect(message).not.toContain(READER_HANDLE);
    expect(message).not.toContain(READER_TEXT);
    expect(message).not.toContain(TOKEN);
  });

  it('fails closed on malformed pages and reply results, naming no reader data', async () => {
    const noData = igAdapter(() => jsonResponse({ data: 'nope' }));
    await expect(noData.comments.listPosts(5, makeCtx(IG_SECRETS))).rejects.toThrowError(
      /returned a malformed result/,
    );

    const entryNotObject = igAdapter((req) =>
      new URL(req.url).pathname.endsWith('/media')
        ? jsonResponse({ data: ['x'] })
        : jsonResponse({}, 404),
    );
    await expect(entryNotObject.comments.listPosts(5, makeCtx(IG_SECRETS))).rejects.toThrowError(
      /returned a malformed result/,
    );

    const badNext = igAdapter((req) =>
      new URL(req.url).pathname.endsWith('/media')
        ? jsonResponse({
            data: [{ id: 'media-1', timestamp: '2026-11-08T09:00:00+0000' }],
            paging: { next: 42 },
          })
        : jsonResponse({}, 404),
    );
    await expect(badNext.comments.listPosts(5, makeCtx(IG_SECRETS))).rejects.toThrowError(
      /returned a malformed result/,
    );

    const noReplyId = igAdapter(() => jsonResponse({}));
    await expect(
      noReplyId.comments.replyToComment('c1', 'Danke!', makeCtx(IG_SECRETS)),
    ).rejects.toThrowError(/comment reply returned a malformed result/);
  });

  it('rejects empty resolved secrets by name, without network calls', async () => {
    const { fetchImpl, requests } = fakeFetch(igHandler());
    const adapter = new InstagramAdapter({ fetchImpl, sleep: sleepNoop });
    const emptyOwner = makeCtx({ ...IG_SECRETS, INSTAGRAM_USER_ID: '' });
    const emptyToken = makeCtx({ ...IG_SECRETS, INSTAGRAM_ACCESS_TOKEN: '' });

    await expect(adapter.comments.listPosts(5, emptyOwner)).rejects.toThrowError(
      /"INSTAGRAM_USER_ID" resolved to an empty value/,
    );
    await expect(
      adapter.comments.listComments('media-1', undefined, emptyToken),
    ).rejects.toThrowError(/"INSTAGRAM_ACCESS_TOKEN" resolved to an empty value/);
    await expect(adapter.comments.replyToComment('c1', 'Danke!', emptyToken)).rejects.toThrowError(
      /"INSTAGRAM_ACCESS_TOKEN" resolved to an empty value/,
    );
    expect(requests).toHaveLength(0);
  });
});

describe('comments capability: Facebook', () => {
  it("lists the Page's own posts from the /{page}/posts edge", async () => {
    const { fetchImpl, requests } = fakeFetch(fbHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    const posts = await adapter.comments.listPosts(10, makeCtx(FB_SECRETS));

    expect(posts).toEqual([
      { id: 'post-2', createdAt: '2026-11-08T09:00:00+0000' },
      { id: 'post-1', createdAt: '2026-11-07T09:00:00+0000' },
    ]);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe(`/v21.0/${FB_PAGE_ID}/posts`);
    expect(url.searchParams.get('fields')).toBe('id,created_time');
  });

  it('lists reader comments only: our own replies are skipped, from-less comments keep an empty handle', async () => {
    const { fetchImpl, requests } = fakeFetch(fbHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });
    const since = new Date('2026-11-09T09:30:00Z');

    const comments = await adapter.comments.listComments('post-1', since, makeCtx(FB_SECRETS));

    expect(comments).toEqual([
      {
        id: 'post-1_c2',
        handle: READER_HANDLE,
        text: READER_TEXT,
        createdAt: '2026-11-09T10:05:00+0000',
      },
      {
        id: 'post-1_c0',
        handle: '',
        text: 'ohne absender',
        createdAt: '2026-11-09T09:45:00+0000',
      },
    ]);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/v21.0/post-1/comments');
    expect(url.searchParams.get('fields')).toBe('id,message,created_time,from{id,name}');
    expect(url.searchParams.get('since')).toBe(String(Math.floor(since.getTime() / 1000)));
  });

  it('replies to one comment and returns the reply id', async () => {
    const { fetchImpl, requests } = fakeFetch(fbHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    const replyId = await adapter.comments.replyToComment(
      'post-1_c2',
      'Danke!',
      makeCtx(FB_SECRETS),
    );

    expect(replyId).toBe('reply-1');
    expect(requests[0]!.method).toBe('POST');
    expect(new URL(requests[0]!.url).pathname).toBe('/v21.0/post-1_c2/comments');
    expect(requests[0]!.json).toEqual({ message: 'Danke!' });
  });

  it('retries a 429 per call like the publishing path', async () => {
    const { sleeps, sleep } = sleepRecorder();
    let attempts = 0;
    const base = fbHandler();
    const handler = (req: RecordedRequest, n: number): Response => {
      if (new URL(req.url).pathname.endsWith('/comments') && attempts === 0) {
        attempts += 1;
        return jsonResponse({ error: { message: 'Too Many Requests' } }, 429);
      }
      return base(req, n);
    };
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new FacebookAdapter({ fetchImpl, sleep, rateLimitBackoffMs: 500 });

    const comments = await adapter.comments.listComments('post-1', undefined, makeCtx(FB_SECRETS));

    expect(comments).toHaveLength(2);
    expect(sleeps).toEqual([500]);
    expect(requests).toHaveLength(2);
  });

  it('exchanges an expired token once per operation and retries with the new token', async () => {
    const base = fbHandler();
    const handler = (req: RecordedRequest, n: number): Response => {
      const url = new URL(req.url);
      if (url.searchParams.get('access_token') === TOKEN && url.pathname.endsWith('/posts')) {
        return jsonResponse(
          { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
          400,
        );
      }
      if (url.pathname.endsWith('/oauth/access_token')) {
        return jsonResponse({ access_token: REFRESHED_TOKEN });
      }
      return base(req, n);
    };
    const { fetchImpl, requests } = fakeFetch(handler);
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    const posts = await adapter.comments.listPosts(10, makeCtx(FB_SECRETS));

    expect(posts.map((post) => post.id)).toEqual(['post-2', 'post-1']);
    expect(new URL(requests[1]!.url).pathname).toBe('/v21.0/oauth/access_token');
    expect(new URL(requests[2]!.url).searchParams.get('access_token')).toBe(REFRESHED_TOKEN);
  });

  it('maps Graph errors to the adapter error class without reader data', async () => {
    const base = fbHandler();
    const handler = (req: RecordedRequest, n: number): Response => {
      if (new URL(req.url).pathname.endsWith('/comments')) {
        return jsonResponse({ error: { code: 100, message: 'Invalid appsecret' } }, 400);
      }
      return base(req, n);
    };
    const { fetchImpl } = fakeFetch(handler);
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });

    let caught: unknown;
    await adapter.comments.listComments('post-1', undefined, makeCtx(FB_SECRETS)).catch((error) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(FacebookAdapterError);
    const message = (caught as Error).message;
    expect(message).toContain('/comments failed: Invalid appsecret');
    expect(message).not.toContain(READER_HANDLE);
    expect(message).not.toContain(READER_TEXT);
    expect(message).not.toContain(TOKEN);
  });

  it('rejects empty resolved secrets by name, without network calls', async () => {
    const { fetchImpl, requests } = fakeFetch(fbHandler());
    const adapter = new FacebookAdapter({ fetchImpl, sleep: sleepNoop });
    const emptyOwner = makeCtx({ ...FB_SECRETS, FACEBOOK_PAGE_ID: '' });

    await expect(adapter.comments.listPosts(5, emptyOwner)).rejects.toThrowError(
      /"FACEBOOK_PAGE_ID" resolved to an empty value/,
    );
    expect(requests).toHaveLength(0);
  });
});

it('fails closed when comment pagination is truncated', async () => {
  const adapter = igAdapter(() =>
    jsonResponse({
      data: [],
      paging: { next: 'https://graph.facebook.com/v22.0/p1/comments?after=next' },
    }),
  );
  await expect(
    adapter.comments!.listComments('p1', undefined, makeCtx(IG_SECRETS)),
  ).rejects.toThrow('pagination limit');
});
