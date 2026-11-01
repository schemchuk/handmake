import { serializeCollection } from '@handmake/core';
import { describe, expect, it, vi } from 'vitest';

import { createGitHubCollectionReader } from '../src/collection-reader';

const fixture = (slug: string, tenant = 'tenant', order = 1) => ({
  tenant,
  slug,
  order,
  versions: { uk: { title: 'Fixture', description: 'Fixture', provenance: 'human' as const } },
  cover: { workId: '01JBCA1B2C3D4E5F6G7H8J9K0M', fileName: 'a.jpg' },
});
const make = (fetchImpl: typeof fetch) =>
  createGitHubCollectionReader({ repo: 'owner/repo', ref: 'main', fetchImpl });
describe('Worker collection reader', () => {
  it('uses the content port ordering and tenant isolation, ignoring untrusted download URLs', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('api.github.com'))
        return Response.json(
          ['z', 'b', 'a', 'foreign'].map((slug) => ({
            name: `${slug}.md`,
            type: 'file',
            download_url: 'https://example.invalid/trap',
          })),
        );
      const slug = String(url).split('/').at(-1)!.slice(0, -3);
      return new Response(
        serializeCollection(
          fixture(slug, slug === 'foreign' ? 'other' : 'tenant', slug === 'z' ? 2 : 1),
        ),
      );
    });
    expect((await make(fetchImpl).listCollections('tenant')).map((c) => c.slug)).toEqual([
      'a',
      'b',
      'z',
    ]);
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes('trap'))).toBe(true);
  });
  it('returns an empty list before the first collection exists', async () => {
    expect(
      await make(vi.fn(async () => new Response(null, { status: 404 }))).listCollections('tenant'),
    ).toEqual([]);
  });
  it.each([403, 500])('surfaces HTTP %s errors', async (status) => {
    await expect(
      make(vi.fn(async () => new Response(null, { status }))).listCollections('tenant'),
    ).rejects.toThrow(`HTTP ${status}`);
  });
  it.each([{}, Array.from({ length: 1000 }, () => ({}))])(
    'rejects malformed/oversized listings',
    async (body) => {
      await expect(
        make(vi.fn(async () => Response.json(body))).listCollections('tenant'),
      ).rejects.toThrow(/listing/);
    },
  );
  it('fails loudly on malformed collection content', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json([{ type: 'file', name: 'broken.md' }]))
      .mockResolvedValueOnce(new Response('broken'));
    await expect(make(fetchImpl).listCollections('tenant')).rejects.toThrow(
      'content/collections/broken.md',
    );
  });
  it('rejects unsafe file and tenant identifiers before fetching their content', async () => {
    const fetchImpl = vi.fn(async () => Response.json([{ type: 'file', name: '../outside.md' }]));
    await expect(make(fetchImpl).listCollections('tenant')).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
    fetchImpl.mockClear();
    await expect(make(fetchImpl).listCollections('../tenant')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
