import type { DeliverContext, SendOperation } from '@handmake/core';
import { describe, expect, it, vi } from 'vitest';

import { createPinterestAdapter } from '../src/pinterest/adapter';

const api = 'https://api-sandbox.pinterest.com/v5';
const upload = 'https://uploads.example.invalid/signed';
const cover = 'https://example.invalid/cover.webp';
const link = 'https://example.invalid/works/example/';
const ops: SendOperation[] = [{ kind: 'mediaGroup', photoIndexes: [0], caption: 'Schal\nWeich' }];
const ctx: DeliverContext = {
  settings: { language: 'de', boardId: 'PINTEREST_BOARD_ID', sandbox: true, link },
  secrets: {
    resolve: async (name) =>
      ({
        PINTEREST_APP_ID: 'app',
        PINTEREST_APP_SECRET: 'secret',
        PINTEREST_REFRESH_TOKEN: 'old',
        PINTEREST_BOARD_ID: '123',
      })[name]!,
  },
  idempotencyBase: 'fixture',
  photos: [],
  photoUrls: [cover],
  video: new Uint8Array([1, 2, 3]),
};

function endpoint({ pending = false, rotate = false } = {}) {
  let polls = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    switch (String(input)) {
      case `${api}/oauth/token`:
        expect(init?.headers).toMatchObject({ Authorization: 'Basic YXBwOnNlY3JldA==' });
        expect(String(init?.body)).toBe('grant_type=refresh_token&refresh_token=old');
        return Response.json({ access_token: 'access', ...(rotate && { refresh_token: 'new' }) });
      case `${api}/media`:
        expect(JSON.parse(String(init?.body))).toEqual({ media_type: 'video' });
        return Response.json({
          media_id: '234',
          upload_url: upload,
          upload_parameters: { key: 'fixture', policy: 'signed-policy' },
        });
      case upload: {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toBeUndefined();
        const form = init?.body as FormData;
        expect([...form.keys()]).toEqual(['key', 'policy', 'file']);
        expect(form.get('policy')).toBe('signed-policy');
        expect(new Uint8Array(await (form.get('file') as File).arrayBuffer())).toEqual(ctx.video);
        return new Response(null, { status: 204 });
      }
      case `${api}/media/234`:
        return Response.json({ status: ++polls === 1 || pending ? 'processing' : 'succeeded' });
      case `${api}/pins`:
        return Response.json({ id: '345' });
      default:
        throw new Error('Unexpected request');
    }
  });
}

describe('Pinterest', () => {
  it('rotates before registering, uploading and polling the video, then pins it with its cover', async () => {
    const fetchImpl = endpoint({ rotate: true });
    const saveRefreshToken = vi.fn(async () => {});
    const sleep = vi.fn(async () => {});
    const onDelivered = vi.fn(async () => {});
    const adapter = createPinterestAdapter({ fetchImpl, saveRefreshToken, sleep });
    expect(await adapter.deliver(ops, ctx, { startAt: 0, knownIds: [], onDelivered })).toEqual([
      '345',
    ]);
    expect(saveRefreshToken).toHaveBeenCalledExactlyOnceWith('new');
    expect(saveRefreshToken.mock.invocationCallOrder[0]).toBeLessThan(
      fetchImpl.mock.invocationCallOrder[1]!,
    );
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${api}/oauth/token`,
      `${api}/media`,
      upload,
      `${api}/media/234`,
      `${api}/media/234`,
      `${api}/pins`,
    ]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3000);
    expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body))).toEqual({
      board_id: '123',
      title: 'Schal',
      description: 'Schal\nWeich',
      link,
      media_source: { source_type: 'video_id', media_id: '234', cover_image_url: cover },
    });
    expect(onDelivered).toHaveBeenCalledExactlyOnceWith(0, '345');
  });

  it('does not publish if rotation persistence fails', async () => {
    const fetchImpl = endpoint({ rotate: true });
    const saveRefreshToken = vi.fn().mockRejectedValue(new Error('storage failed'));
    await expect(
      createPinterestAdapter({ fetchImpl, saveRefreshToken }).deliver(ops, ctx),
    ).rejects.toThrow('storage failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('times out after bounded polling and never creates a Pin', async () => {
    const fetchImpl = endpoint({ pending: true });
    const sleep = vi.fn(async () => {});
    await expect(createPinterestAdapter({ fetchImpl, sleep }).deliver(ops, ctx)).rejects.toThrow(
      'Pinterest timed out waiting for video processing',
    );
    expect(sleep).toHaveBeenCalledTimes(19);
    expect(fetchImpl.mock.calls.filter(([url]) => url === `${api}/media/234`)).toHaveLength(20);
    expect(fetchImpl.mock.calls.some(([url]) => url === `${api}/pins`)).toBe(false);
  });
});
