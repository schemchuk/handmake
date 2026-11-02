import { serializeWork } from '@handmake/core';
import type { Work } from '@handmake/core';
import { expect, it, vi } from 'vitest';
import { createGitHubWorkReader } from '../src/work-reader';

const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const other = '01JBCA1B2C3D4E5F6G7H8J9K0Z';
const work: Work = {
  id,
  tenant: 'tenant',
  date: '2026-11-01T12:00:00Z',
  collection: 'fixture',
  kind: 'worn',
  photos: ['original.jpg'],
  versions: { uk: { description: 'Original author text', provenance: 'human' } },
};
const make = (fetchImpl: typeof fetch) =>
  createGitHubWorkReader({ repo: 'owner/repo', ref: 'main', token: 'fixture-token', fetchImpl });

it('lists approved works newest first, filters foreign tenants and ignores untrusted URLs', async () => {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('api.github.com'))
      return Response.json([
        { type: 'dir', name: id, download_url: 'https://example.invalid/trap' },
        { type: 'dir', name: other },
        { type: 'file', name: 'README.md' },
      ]);
    return new Response(serializeWork({ ...work, id: String(url).includes(other) ? other : id }));
  });
  expect((await make(fetchImpl).listWorks('tenant')).map((w) => w.id)).toEqual([other, id]);
  expect(await make(fetchImpl).listWorks('foreign')).toEqual([]);
  expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('trap'))).toBe(false);
  const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer fixture-token');
});

it('reads exact work identity and leaves author content unchanged', async () => {
  const fetchImpl = vi.fn(async () => new Response(serializeWork(work)));
  expect(await make(fetchImpl).readWork('tenant', id)).toEqual(work);
  expect(fetchImpl).toHaveBeenCalledWith(
    `https://raw.githubusercontent.com/owner/repo/main/content/works/${id}/index.md`,
  );
  expect(await make(fetchImpl).readWork('foreign', id)).toBeUndefined();
  await expect(make(fetchImpl).readWork('tenant', other)).rejects.toThrow('identity');
});

it('returns absent content on 404 and surfaces other HTTP failures', async () => {
  const missing = make(vi.fn(async () => new Response(null, { status: 404 })));
  expect(await missing.listWorks('tenant')).toEqual([]);
  expect(await missing.readWork('tenant', id)).toBeUndefined();
  const failed = make(vi.fn(async () => new Response(null, { status: 503 })));
  await expect(failed.listWorks('tenant')).rejects.toThrow('HTTP 503');
  await expect(failed.readWork('tenant', id)).rejects.toThrow('HTTP 503');
});

it.each([{}, Array.from({ length: 1000 }, () => ({})), [{ type: 'dir', name: '../unsafe' }]])(
  'rejects malformed, truncated or unsafe listings',
  async (body) => {
    const fetchImpl = vi.fn(async () => Response.json(body));
    await expect(make(fetchImpl).listWorks('tenant')).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  },
);

it('validates tenant and work identifiers before network access and rejects malformed content', async () => {
  const fetchImpl = vi.fn(async () => new Response('broken'));
  await expect(make(fetchImpl).listWorks('../tenant')).rejects.toThrow();
  await expect(make(fetchImpl).readWork('tenant', '../id')).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(make(fetchImpl).readWork('tenant', id)).rejects.toThrow();
});

it('bounds raw work reads to the twenty newest ids before fetching', async () => {
  const ids = Array.from(
    { length: 60 },
    (_, i) => `${id.slice(0, 21)}${String(i).padStart(5, '0')}`,
  );
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('api.github.com'))
      return Response.json(ids.map((name) => ({ type: 'dir', name })));
    const selected = String(url).split('/').at(-2)!;
    return new Response(serializeWork({ ...work, id: selected }));
  });
  const result = await make(fetchImpl).listWorks('tenant');
  expect(fetchImpl).toHaveBeenCalledTimes(21);
  expect(result.map((w) => w.id)).toEqual(ids.slice(-20).reverse());
});
