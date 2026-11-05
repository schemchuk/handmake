import { FakeContentStore } from '@handmake/core/testing';
import type { Collection, Work } from '@handmake/core';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import {
  loadPortfolio,
  portfolioLanguages,
  portfolioTitle,
  workImageKey,
} from '../src/lib/portfolio';

const work: Work = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-11-01T10:00:00Z',
  kind: 'worn',
  collection: 'fixture',
  photos: ['a.jpg'],
  versions: {
    de: { description: 'DE fixture', provenance: 'human' },
    uk: {
      description: 'UA fixture',
      provenance: 'ai-assisted',
      model: 'fixture-model',
      prompt: 'fixture@1',
    },
  },
};
const collection: Collection = {
  tenant: 'tenant',
  slug: 'fixture',
  order: 0,
  cover: { workId: work.id, fileName: 'a.jpg' },
  versions: {
    de: { title: 'DE title', description: 'DE fixture', provenance: 'human' },
    uk: { title: 'UA title', description: 'UA fixture', provenance: 'human' },
  },
};
async function fixture(bytes?: Uint8Array) {
  const store = new FakeContentStore();
  await store.saveCollection(collection);
  await store.saveWork(work, bytes ? [{ fileName: 'a.jpg', data: bytes }] : []);
  return store;
}
describe('portfolio content and image preparation', () => {
  it('reads only tenant content through the port and makes correctly oriented responsive WebP variants without changing originals', async () => {
    const original = await sharp({
      create: { width: 1600, height: 1000, channels: 3, background: '#777777' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const store = await fixture(original);
    const foreign = {
      ...work,
      tenant: 'other',
      id: '01JBCA1B2C3D4E5F6G7H8J9K0Z',
      collection: 'foreign',
    };
    await store.saveCollection({
      ...collection,
      tenant: 'other',
      slug: 'foreign',
      cover: { workId: foreign.id, fileName: 'a.jpg' },
    });
    await store.saveWork(foreign, []);
    const read = vi.spyOn(store, 'readWorkPhoto');
    const data = await loadPortfolio(store, 'tenant');
    expect(data.works).toEqual([work]);
    expect(data.collections).toEqual([collection]);
    const images = data.workImages.get(workImageKey(work.id, 'a.jpg'))!.variants;
    expect(images.map((image) => image.width)).toEqual([480, 960, 1000]);
    for (const image of images) {
      const metadata = await sharp(image.bytes).metadata();
      expect(metadata).toMatchObject({ width: image.width, height: image.height, format: 'webp' });
      expect(metadata.exif).toBeUndefined();
      expect(image.url).toContain(`/work-media/${work.id.toLowerCase()}/a.jpg/`);
    }
    expect(read.mock.calls.every(([tenant, id]) => tenant === 'tenant' && id === work.id)).toBe(
      true,
    );
    expect(await store.readWorkPhoto('tenant', work.id, 'a.jpg')).toEqual(original);
  });
  it('omits test works and empty collections before reading media', async () => {
    const store = await fixture();
    await store.saveWork({ ...work, siteExcluded: true }, []);
    const read = vi.spyOn(store, 'readWorkPhoto');
    const data = await loadPortfolio(store, 'tenant');
    expect(data.works).toEqual([]);
    expect(data.collections).toEqual([]);
    expect(data.workImages.size).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
  it('replaces a hidden collection cover with a visible work', async () => {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#777' },
    })
      .png()
      .toBuffer();
    const store = await fixture();
    await store.saveWork({ ...work, siteExcluded: true }, []);
    const visible = { ...work, id: '01JBCA1B2C3D4E5F6G7H8J9K0N' };
    await store.saveWork(visible, [{ fileName: 'a.jpg', data: bytes }]);
    const data = await loadPortfolio(store, 'tenant');
    expect(data.works).toEqual([visible]);
    expect(data.collections[0]?.cover.workId).toBe(visible.id);
  });
  it('does not upscale a small source', async () => {
    const data = await loadPortfolio(
      await fixture(
        await sharp({ create: { width: 40, height: 20, channels: 3, background: '#777777' } })
          .png()
          .toBuffer(),
      ),
      'tenant',
    );
    expect(
      data.workImages.get(workImageKey(work.id, 'a.jpg'))!.variants.map((image) => image.width),
    ).toEqual([40]);
  });
  it('fails before media reads on a dangling or foreign collection cover', async () => {
    const store = await fixture();
    await store.saveCollection({
      ...collection,
      cover: { workId: work.id, fileName: 'missing.jpg' },
    });
    const read = vi.spyOn(store, 'readWorkPhoto');
    await expect(loadPortfolio(store, 'tenant')).rejects.toThrow(
      'collection fixture: dangling cover',
    );
    expect(read).not.toHaveBeenCalled();
  });
  it('fails when a work references an absent collection or declared photo', async () => {
    const store = await fixture();
    await expect(loadPortfolio(store, 'tenant')).rejects.toThrow(
      `work ${work.id}: declared photo a.jpg is absent`,
    );
    await store.saveWork({ ...work, collection: 'missing' }, []);
    await expect(loadPortfolio(store, 'tenant')).rejects.toThrow(/collection missing is absent/);
  });
  it('does not invent translations or titles', () => {
    const untranslated = { ...work, versions: { uk: work.versions['uk']! } };
    expect(portfolioLanguages(untranslated, ['de', 'uk'])).toEqual(['uk']);
    expect(portfolioTitle(work, 'de')).toBe('DE fixture');
    expect(portfolioTitle(collection, 'de')).toBe('DE title');
  });
});
