import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  showSchema,
  type DeliverContext,
  type Post,
  type RemoteId,
  type SendOperation,
} from '@handmake/core';
import {
  createThreadsAdapter,
  ThreadsAdapterError,
  renderThreads,
  renderThreadsShow,
  threadsTextLength,
} from '../src';

const post: Post = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-11-10T00:00:00Z',
  publishAt: 'now',
  type: 'free',
  photos: ['one.jpg', 'two.jpg'],
  channels: ['threads'],
  versions: { de: { provenance: 'human' } },
  texts: { de: 'Handarbeit 🧵' },
};
const canonical = {
  links: true as const,
  baseUrl: 'https://craft.example',
  defaultLanguage: 'de',
  section: 'posts' as const,
};
const settings = { language: 'de', canonical };
const context: DeliverContext = {
  settings,
  photos: [],
  photoUrls: ['https://craft.example/one.jpg', 'https://craft.example/two.jpg'],
  idempotencyBase: 'tenant:post:threads',
  secrets: { resolve: async (name) => (name === 'THREADS_USER_ID' ? '123' : 'fixture-token') },
};
const image: SendOperation = { kind: 'mediaGroup', photoIndexes: [0], caption: 'Made by hand' };
const text: SendOperation = { kind: 'message', text: 'Made by hand', lang: 'de' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function mockApi(
  hook?: (path: string, params: URLSearchParams, count: number) => Response | undefined,
) {
  let created = 100;
  const requests: { path: string; params: URLSearchParams; url: URL; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const params = new URLSearchParams(String(init?.body ?? ''));
    const path = url.pathname;
    requests.push({ path, params, url, init });
    return (
      hook?.(path, params, requests.length) ??
      (init?.method === 'GET'
        ? response({ status: 'FINISHED' })
        : response({ id: String(++created) }))
    );
  });
  const sleep = vi.fn(async () => {});
  return { fetchImpl, requests, sleep, adapter: createThreadsAdapter({ fetchImpl, sleep }) };
}

describe('Threads rendering', () => {
  it('preserves text, appends the localized canonical URL and keeps photo order', () => {
    expect(renderThreads(post, settings)).toEqual([
      {
        kind: 'mediaGroup',
        photoIndexes: [0, 1],
        caption: `${post.texts.de}\n\nOriginalarbeit\n\nhttps://craft.example/posts/${post.id.toLowerCase()}/`,
        captionLang: 'de',
      },
    ]);
    const op = renderThreads(
      { ...post, photos: [] },
      { ...settings, canonical: { ...canonical, defaultLanguage: 'uk', section: 'works' } },
    )[0]!;
    expect(op).toMatchObject({
      kind: 'message',
      text: expect.stringContaining(`/de/works/${post.id.toLowerCase()}/`),
    });
  });
  it('includes the footer in the 500-byte budget and never silently rewrites text', () => {
    expect(
      renderThreads({ ...post, texts: { de: 'x'.repeat(484) } }, { language: 'de' }),
    ).toHaveLength(1);
    expect(() => renderThreads({ ...post, texts: { de: 'x'.repeat(500) } }, settings)).toThrow(
      /500/,
    );
    expect(threadsTextLength('ä🧵')).toBe(6);
    expect(() => renderThreads({ ...post, texts: { de: '🧵'.repeat(126) } }, settings)).toThrow(
      /500/,
    );
  });
  it.each([{ siteExcluded: true }, { type: 'announcement' as const }])(
    'skips excluded/non-site content (%j)',
    (change) => {
      expect(renderThreads({ ...post, ...change }, settings)).toEqual([]);
    },
  );
  it.each([{}, { language: 'xx' }, { language: 1 }])(
    'rejects invalid settings or missing translation (%j)',
    (value) => {
      expect(() => renderThreads(post, value)).toThrow();
    },
  );
  it('enforces photo bounds and nonempty text', () => {
    expect(() => renderThreads({ ...post, photos: Array(21).fill('photo') }, settings)).toThrow(
      /20/,
    );
    expect(renderThreads({ ...post, photos: Array(20).fill('photo') }, settings)).toHaveLength(1);
    expect(() => renderThreads({ ...post, texts: { de: '' } }, { language: 'de' })).toThrow();
  });
  it('copies shows with disclosure and canonical link and enforces their total length', () => {
    const show = showSchema.parse(
      JSON.parse(
        readFileSync(new URL('../../core/test/fixtures/show.json', import.meta.url), 'utf8'),
      ),
    );
    const ctx = {
      settings: { language: 'de' },
      site: { baseUrl: canonical.baseUrl, defaultLanguage: 'de' },
      languages: ['de', 'uk'],
    };
    const op = renderThreadsShow(show, ctx)[0];
    expect(op).toMatchObject({ kind: 'mediaGroup', caption: expect.stringContaining('/shows/') });
    expect(op?.kind === 'mediaGroup' && op.caption).toMatch(/KI|AI/);
    expect(renderThreadsShow({ ...show, siteExcluded: true }, ctx)).toEqual([]);
    show.versions.de!.description = 'x'.repeat(501);
    expect(() => renderThreadsShow(show, ctx)).toThrow(/500/);
  });
});

describe('Threads delivery', () => {
  it.each([text, image])(
    'creates, checks status and publishes %j using Threads form fields',
    async (op) => {
      const api = mockApi();
      expect(await api.adapter.deliver([op], context)).toEqual(['102']);
      expect(api.requests.map((r) => r.path)).toEqual([
        '/v1.0/123/threads',
        '/v1.0/101',
        '/v1.0/123/threads_publish',
      ]);
      expect(api.requests[0]!.url.origin).toBe('https://graph.threads.com');
      expect(api.requests[0]!.params.get('media_type')).toBe(
        op.kind === 'message' ? 'TEXT' : 'IMAGE',
      );
      expect(api.requests[0]!.params.get('text')).toBe('Made by hand');
      expect(api.requests[0]!.init?.headers).toEqual({
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      expect(
        api.requests.every((r) => r.url.searchParams.get('access_token') === 'fixture-token'),
      ).toBe(true);
      expect(api.requests[2]!.params.get('creation_id')).toBe('101');
    },
  );
  it('creates and waits for every carousel child and uses comma-separated ids', async () => {
    const api = mockApi();
    await api.adapter.deliver([{ ...image, photoIndexes: [1, 0] }], context);
    const writes = api.requests.filter((r) => r.init?.method === 'POST');
    expect(writes.map((r) => r.params.get('media_type'))).toEqual([
      'IMAGE',
      'IMAGE',
      'CAROUSEL',
      null,
    ]);
    expect(writes[0]!.params.get('image_url')).toBe(context.photoUrls![1]);
    expect(writes[0]!.params.get('is_carousel_item')).toBe('true');
    expect(writes[2]!.params.get('children')).toBe('101,102');
    expect(writes[2]!.params.get('text')).toBe('Made by hand');
  });
  it('retries only a rate-limited publish call, retaining the existing containers', async () => {
    let rejected = false;
    const api = mockApi((path) => {
      if (path.endsWith('threads_publish') && !rejected) {
        rejected = true;
        return response({ error: { code: 4, message: 'secret' } }, 429);
      }
    });
    await api.adapter.deliver([image], context);
    expect(api.sleep).toHaveBeenCalledWith(60000);
    expect(api.requests.filter((r) => r.path.endsWith('/threads'))).toHaveLength(1);
    expect(api.requests.filter((r) => r.path.endsWith('/threads_publish'))).toHaveLength(2);
  });
  it('honors ledger prefixes and awaits persistence before the next operation', async () => {
    const api = mockApi();
    const persisted: RemoteId[] = [];
    const ids = await api.adapter.deliver([text, image, text], context, {
      startAt: 1,
      knownIds: ['99'],
      onDelivered: async (index, id) => {
        expect(api.requests.filter((r) => r.path.endsWith('/threads_publish'))).toHaveLength(index);
        persisted.push(id);
      },
    });
    expect(ids).toEqual(['99', ...persisted]);
    expect(api.requests.filter((r) => r.path.endsWith('/threads_publish'))).toHaveLength(2);
    api.fetchImpl.mockClear();
    expect(
      await api.adapter.deliver([text], context, {
        startAt: 1,
        knownIds: ['99'],
        onDelivered: vi.fn(),
      }),
    ).toEqual(['99']);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });
  it('does not send another op after ledger persistence fails', async () => {
    const api = mockApi();
    await expect(
      api.adapter.deliver([text, image], context, {
        startAt: 0,
        knownIds: [],
        onDelivered: () => {
          throw new Error('ledger unavailable');
        },
      }),
    ).rejects.toThrow('ledger unavailable');
    expect(api.requests.filter((r) => r.path.endsWith('/threads_publish'))).toHaveLength(1);
  });
  it.each(['ERROR', 'EXPIRED', 'PUBLISHED', 'unexpected', undefined])(
    'never publishes a container with status %s',
    async (status) => {
      const api = mockApi((path) =>
        /^\/v1.0\/\d+$/.test(path) ? response({ status, error_message: 'secret' }) : undefined,
      );
      await expect(api.adapter.deliver([text], context)).rejects.toThrow(ThreadsAdapterError);
      expect(api.requests.some((r) => r.path.endsWith('/threads_publish'))).toBe(false);
    },
  );
  it('bounds polling and waits only while IN_PROGRESS', async () => {
    let polls = 0;
    const api = mockApi((path) =>
      /^\/v1.0\/\d+$/.test(path)
        ? response({ status: ++polls === 8 ? 'FINISHED' : 'IN_PROGRESS' })
        : undefined,
    );
    await api.adapter.deliver([text], context);
    expect(api.sleep).toHaveBeenCalledTimes(7);
    const slow = mockApi((path) =>
      /^\/v1.0\/\d+$/.test(path) ? response({ status: 'IN_PROGRESS' }) : undefined,
    );
    await expect(slow.adapter.deliver([text], context)).rejects.toThrow(/timed out/);
    expect(slow.sleep.mock.calls).toEqual(Array.from({ length: 11 }, () => [5000]));
  });
  it.each([
    response({ error: { code: 190, error_subcode: 463 } }, 400),
    response({ id: 'bad' }),
    response(null),
    new Response('secret', { status: 500 }),
  ])('rejects malformed/API failures without exposing payloads', async (result) => {
    const api = mockApi(() => result.clone());
    await expect(api.adapter.deliver([image], context)).rejects.toThrow(ThreadsAdapterError);
    expect(api.requests).toHaveLength(1);
  });
  it('sanitizes fetch failures and never retries ambiguous publishing', async () => {
    const api = mockApi();
    api.fetchImpl.mockRejectedValueOnce(new Error('fixture-token and reader data'));
    await expect(api.adapter.deliver([image], context)).rejects.toThrow(
      'Threads delivery failed; check token, quota and media',
    );
    expect(api.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { kind: 'poll', question: 'x', options: [] },
    { ...image, replyToOp: 0 },
    { ...image, photoIndexes: [] },
    { ...image, photoIndexes: [5] },
    { ...text, text: 'x'.repeat(501) },
  ])('prevalidates the entire batch (%j)', async (bad) => {
    const api = mockApi();
    await expect(api.adapter.deliver([image, bad as SendOperation], context)).rejects.toThrow();
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects invalid progress and missing secrets without requests', async () => {
    const api = mockApi();
    await expect(
      api.adapter.deliver([image], context, { startAt: 1, knownIds: [], onDelivered: vi.fn() }),
    ).rejects.toThrow(/progress/);
    await expect(
      api.adapter.deliver([image], { ...context, secrets: { resolve: async () => '' } }),
    ).rejects.toThrow(/requires/);
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Threads work video carousel', () => {
  const op: SendOperation = { ...image, includeVideo: true };
  const ctx = { ...context, videoUrl: 'https://raw.example/content/works/work/video.mp4' };
  it('appends VIDEO after photos, checks every child, and publishes a single carousel', async () => {
    let rejected = false;
    const api = mockApi((_path, params) => {
      if (params.get('media_type') === 'VIDEO' && !rejected) {
        rejected = true;
        return response({ error: { code: 4 } }, 429);
      }
    });
    const persisted = vi.fn();
    await api.adapter.deliver([op], ctx, { startAt: 0, knownIds: [], onDelivered: persisted });
    const writes = api.requests.filter((r) => r.init?.method === 'POST');
    expect(writes.map((r) => r.params.get('media_type'))).toEqual([
      'IMAGE',
      'VIDEO',
      'VIDEO',
      'CAROUSEL',
      null,
    ]);
    expect(writes[2]!.params.get('video_url')).toBe(ctx.videoUrl);
    expect(writes[2]!.params.get('is_carousel_item')).toBe('true');
    expect(writes[3]!.params.get('children')).toBe('101,102');
    expect(writes[3]!.params.get('text')).toBe(image.caption);
    expect(persisted).toHaveBeenCalledTimes(1);
    const count = api.requests.length;
    await api.adapter.deliver([op], context, {
      startAt: 1,
      knownIds: ['104'],
      onDelivered: persisted,
    });
    expect(api.requests).toHaveLength(count);
  });
  it.each([true, false])(
    'gives video children and parent 72 polls; finishes=%s',
    async (finishes) => {
      const polls: Record<string, number> = {};
      const api = mockApi((path) => {
        if (/\/10[23]$/.test(path)) {
          polls[path] = (polls[path] ?? 0) + 1;
          return response({ status: finishes && polls[path] === 72 ? 'FINISHED' : 'IN_PROGRESS' });
        }
      });
      if (finishes) {
        await api.adapter.deliver([op], ctx);
        expect(Object.values(polls)).toEqual([72, 72]);
      } else {
        await expect(api.adapter.deliver([op], ctx)).rejects.toThrow(/timed out/);
        expect(Object.values(polls)).toEqual([72]);
        expect(api.requests.some((r) => r.path.endsWith('threads_publish'))).toBe(false);
      }
      expect(api.requests.filter((r) => r.params.get('media_type') === 'VIDEO')).toHaveLength(1);
    },
  );
  it('retains the image budget even for photos in a video carousel', async () => {
    let polls = 0;
    const api = mockApi((path) =>
      path.endsWith('/101')
        ? response({ status: ++polls === 13 ? 'FINISHED' : 'IN_PROGRESS' })
        : undefined,
    );
    await expect(api.adapter.deliver([op], ctx)).rejects.toThrow(/timed out/);
    expect(polls).toBe(12);
  });
  it.each([undefined, 'http://raw.example/video.mp4', 'invalid'])(
    'rejects invalid video URL %s before requests',
    async (videoUrl) => {
      const api = mockApi();
      await expect(api.adapter.deliver([op], { ...context, videoUrl })).rejects.toThrow(/HTTPS/);
      expect(api.requests).toHaveLength(0);
    },
  );
  it('rejects 21 total carousel items before requests', async () => {
    const api = mockApi();
    await expect(
      api.adapter.deliver([{ ...op, photoIndexes: Array(20).fill(0) }], ctx),
    ).rejects.toThrow(/20 items/);
    expect(api.requests).toHaveLength(0);
  });
});
