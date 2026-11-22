import { describe, expect, it, vi } from 'vitest';
import type { DeliverContext, Post, RemoteId } from '@handmake/core';
import {
  createYoutubeAdapter,
  limitHashtags,
  renderYoutube,
  youtubeTitle,
  YoutubeAdapterError,
} from '../src';

const post: Post = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-11-22T00:00:00Z',
  publishAt: 'now',
  type: 'free',
  photos: ['one.jpg'],
  channels: ['youtube'],
  versions: { de: { provenance: 'human' } },
  texts: { de: 'Winterschal aus Merino\nWeich und warm.\n\n#stricken #handmade' },
};
const canonical = {
  links: true as const,
  baseUrl: 'https://craft.example',
  defaultLanguage: 'de',
  section: 'works' as const,
};
const secrets: Record<string, string> = {
  YOUTUBE_CLIENT_ID: 'client-id',
  YOUTUBE_CLIENT_SECRET: 'client-secret',
  YOUTUBE_REFRESH_TOKEN: 'refresh-token',
};
const video = new Uint8Array(1000).map((_, i) => i % 251);
const context = (overrides: Partial<DeliverContext> = {}): DeliverContext => ({
  settings: { language: 'de' },
  photos: [],
  video,
  idempotencyBase: 'tenant:work:youtube',
  secrets: { resolve: async (name) => secrets[name] ?? '' },
  ...overrides,
});
const session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const token = () => json({ access_token: 'access', expires_in: 3599 });
const started = () => new Response(null, { status: 200, headers: { Location: session } });
const op = { kind: 'video' as const, caption: 'Winterschal aus Merino\n\nWeich.' };

function fake(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  });
  const adapter = createYoutubeAdapter({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
  });
  return { adapter, calls, fetchImpl };
}

describe('renderYoutube', () => {
  it('renders one video op with the German text, label, link and hashtags', () => {
    const [operation] = renderYoutube(post, { language: 'de', canonical });
    expect(operation).toEqual({
      kind: 'video',
      caption:
        'Winterschal aus Merino\nWeich und warm.\n\nOriginalarbeit\n\n#stricken #handmade\n\n' +
        'https://craft.example/works/01jbca1b2c3d4e5f6g7h8j9k0m/?s=yt',
    });
  });

  it('keeps at most five distinct hashtags and strips angle brackets', () => {
    const text = limitHashtags('Mütze <neu>\n\n#a #b #A #c #d #e #f #g');
    expect(text).toBe('Mütze <neu>\n\n#a #b #c #d #e');
    const [operation] = renderYoutube(
      { ...post, texts: { de: 'Mütze <neu>\n\n#a #b #c #d #e #f' } },
      { language: 'de' },
    );
    expect(operation).toMatchObject({ caption: 'Mütze neu\n\nOriginalarbeit\n\n#a #b #c #d #e' });
  });

  it('derives a title of at most 100 characters from the first line', () => {
    expect(youtubeTitle('#strick\nSocken #wolle\nmehr')).toBe('Socken');
    const long = `${'Wort '.repeat(30)}Ende`;
    const title = youtubeTitle(long);
    expect([...title].length).toBeLessThanOrEqual(100);
    expect(title.endsWith('Wort…')).toBe(true);
    expect(() => youtubeTitle('#nur #tags')).toThrow(/first line/);
  });

  it('rejects a description over 5000 bytes and other post types', () => {
    expect(() =>
      renderYoutube({ ...post, texts: { de: `Titel\n${'ü'.repeat(2600)}` } }, { language: 'de' }),
    ).toThrow(/5000/);
    expect(renderYoutube({ ...post, type: 'meeting' } as Post, { language: 'de' })).toEqual([]);
  });
});

describe('YoutubeAdapter', () => {
  it('refreshes the token and uploads one public Short', async () => {
    const { adapter, calls } = fake([token(), started(), json({ id: 'dQw4w9WgXcQ' }, 201)]);
    const delivered: Array<[number, RemoteId]> = [];
    const ids = await adapter.deliver([op], context(), {
      startAt: 0,
      knownIds: [],
      onDelivered: (index, id) => {
        delivered.push([index, id]);
      },
    });
    expect(ids).toEqual(['dQw4w9WgXcQ']);
    expect(delivered).toEqual([[0, 'dQw4w9WgXcQ']]);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(String(calls[0]!.init.body)).toContain('grant_type=refresh_token');
    expect(calls[1]!.url).toContain('uploadType=resumable&part=snippet,status');
    expect(calls[1]!.init.headers).toMatchObject({
      Authorization: 'Bearer access',
      'X-Upload-Content-Length': '1000',
    });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      snippet: {
        title: 'Winterschal aus Merino',
        description: op.caption,
        categoryId: '26',
        defaultLanguage: 'de',
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    });
    expect(calls[2]!.url).toBe(session);
    expect(calls[2]!.init.headers).toMatchObject({ 'Content-Range': 'bytes 0-999/1000' });
    expect((calls[2]!.init.body as Uint8Array).length).toBe(1000);
  });

  it('resumes after a dropped connection from the byte YouTube reports', async () => {
    const { adapter, calls } = fake([
      token(),
      started(),
      new TypeError('socket hang up'),
      new Response(null, { status: 308, headers: { Range: 'bytes=0-399' } }),
      json({ id: 'abcdef12345' }),
    ]);
    expect(await adapter.deliver([op], context())).toEqual(['abcdef12345']);
    expect(calls[3]!.init.headers).toEqual({ 'Content-Range': 'bytes */1000' });
    expect(calls[4]!.init.headers).toMatchObject({ 'Content-Range': 'bytes 400-999/1000' });
    expect((calls[4]!.init.body as Uint8Array)[0]).toBe(video[400]);
  });

  it('takes the id from the status check when the last chunk did arrive', async () => {
    const { adapter, fetchImpl } = fake([
      token(),
      started(),
      new Response('bad gateway', { status: 502 }),
      json({ id: 'abcdef12345' }),
    ]);
    expect(await adapter.deliver([op], context())).toEqual(['abcdef12345']);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('retries a transient token error and fails readably on a revoked token', async () => {
    const ok = fake([
      new Response('', { status: 503 }),
      token(),
      started(),
      json({ id: 'id_12345' }),
    ]);
    expect(await ok.adapter.deliver([op], context())).toEqual(['id_12345']);
    const revoked = fake([json({ error: 'invalid_grant' }, 400)]);
    await expect(revoked.adapter.deliver([op], context())).rejects.toThrow(
      /refresh token revoked or expired/,
    );
  });

  it('reports quota errors without upstream text and never follows a foreign session URL', async () => {
    const quota = fake([
      token(),
      json({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'secret detail' } }, 403),
    ]);
    const error = await quota.adapter.deliver([op], context()).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(YoutubeAdapterError);
    expect((error as Error).message).toBe('YouTube upload start failed (HTTP 403, quotaExceeded)');
    const foreign = fake([
      token(),
      new Response(null, { status: 200, headers: { Location: 'https://evil.example/u' } }),
    ]);
    await expect(foreign.adapter.deliver([op], context())).rejects.toThrow(/upload session URL/);
  });

  it('skips a delivered op without any request and refuses a missing video', async () => {
    const { adapter, fetchImpl } = fake([]);
    expect(
      await adapter.deliver([op], context(), {
        startAt: 1,
        knownIds: ['abcdef12345'],
        onDelivered: () => {},
      }),
    ).toEqual(['abcdef12345']);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(adapter.deliver([op], context({ video: undefined }))).rejects.toThrow(
      /needs the work video/,
    );
  });

  it('gives up after the bounded number of resumes', async () => {
    const failures = Array.from({ length: 10 }, () => new TypeError('reset'));
    const { adapter } = fake([
      token(),
      started(),
      failures[0]!,
      new Response(null, { status: 308 }),
      failures[1]!,
      new Response(null, { status: 308 }),
      failures[2]!,
      new Response(null, { status: 308 }),
      failures[3]!,
      new Response(null, { status: 308 }),
      failures[4]!,
    ]);
    await expect(adapter.deliver([op], context())).rejects.toThrow(/kept failing/);
  });
});
