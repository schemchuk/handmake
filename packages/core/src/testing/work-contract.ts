import { describe, expect, it } from 'vitest';

import type { ContentStore } from '../ports/store';
import type { Collection, Work } from '../work';

const work: Work = {
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'tenant',
  date: '2026-11-01T10:00:00Z',
  collection: 'sample',
  kind: 'closeup',
  photos: ['a.jpg', 'missing.jpg'],
  versions: { uk: { description: 'Fixture', provenance: 'human' } },
};
const collection: Collection = {
  tenant: 'tenant',
  slug: 'sample',
  order: 0,
  versions: { uk: { title: 'Fixture', description: 'Fixture', provenance: 'human' } },
  cover: { workId: work.id, fileName: 'a.jpg' },
};

export function describeWorkContentStoreContract(
  name: string,
  makeStore: () => ContentStore,
): void {
  describe(`ContentStore works/collections contract: ${name}`, () => {
    it('round-trips approved work/collection and repeating saves does not duplicate them', async () => {
      const store = makeStore();
      for (let i = 0; i < 2; i++) {
        await store.saveCollection(collection);
        await store.saveWork(work, [{ fileName: 'a.jpg', data: new Uint8Array([3, 4]) }]);
      }
      expect(await store.readWork('tenant', work.id)).toEqual(work);
      expect(await store.readCollection('tenant', 'sample')).toEqual(collection);
      expect(await store.listWorks('tenant')).toEqual([work]);
      expect(await store.listCollections('tenant')).toEqual([collection]);
      expect(await store.readWorkPhoto('tenant', work.id, 'a.jpg')).toEqual(new Uint8Array([3, 4]));
    });

    it('isolates tenants on reads/listings and rejects writes over a foreign identity', async () => {
      const store = makeStore();
      await store.saveWork(work, [{ fileName: 'a.jpg', data: new Uint8Array([1]) }]);
      await store.saveCollection(collection);
      expect(await store.readWork('other', work.id)).toBeUndefined();
      expect(await store.readWorkPhoto('other', work.id, 'a.jpg')).toBeUndefined();
      expect(await store.readCollection('other', 'sample')).toBeUndefined();
      expect(await store.listWorks('other')).toEqual([]);
      expect(await store.listCollections('other')).toEqual([]);
      await expect(store.saveWork({ ...work, tenant: 'other' }, [])).rejects.toThrow(/tenant/);
      await expect(store.saveCollection({ ...collection, tenant: 'other' })).rejects.toThrow(
        /tenant/,
      );
      expect(await store.readWork('tenant', work.id)).toEqual(work);
      expect(await store.readCollection('tenant', 'sample')).toEqual(collection);
    });

    it('lists works by instant/id and collections by order/slug, scoped to tenant', async () => {
      const store = makeStore();
      const older = { ...work, id: '01JBCA1B2C3D4E5F6G7H8J9K0A', date: '2026-10-01T10:00:00Z' };
      const low = { ...work, id: '01JBCA1B2C3D4E5F6G7H8J9K0B', date: '2026-11-01T12:00:00+02:00' };
      const high = { ...work, id: '01JBCA1B2C3D4E5F6G7H8J9K0Z' };
      const foreign = { ...work, id: '01JBCA1B2C3D4E5F6G7H8J9K0F', tenant: 'other' };
      for (const value of [low, older, foreign, high]) await store.saveWork(value, []);
      expect(await store.listWorks('tenant')).toEqual([high, low, older]);
      const first = { ...collection, slug: 'a', order: 1 };
      const second = { ...collection, slug: 'b', order: 1 };
      const last = { ...collection, slug: 'c', order: 2 };
      for (const value of [last, second, { ...collection, tenant: 'other' }, first]) {
        await store.saveCollection(value);
      }
      expect(await store.listCollections('tenant')).toEqual([first, second, last]);
    });

    it('returns absent content/photos as undefined and never exposes undeclared names', async () => {
      const store = makeStore();
      expect(await store.readWork('tenant', work.id)).toBeUndefined();
      expect(await store.readCollection('tenant', 'absent')).toBeUndefined();
      expect(await store.listWorks('tenant')).toEqual([]);
      expect(await store.listCollections('tenant')).toEqual([]);
      await store.saveWork(work, []);
      for (const fileName of [
        'missing.jpg',
        'undeclared.jpg',
        'index.md',
        '../index.md',
        '/a.jpg',
        'photos\\a.jpg',
      ]) {
        expect(await store.readWorkPhoto('tenant', work.id, fileName)).toBeUndefined();
      }
      await expect(
        store.saveWork(work, [{ fileName: '../a.jpg', data: new Uint8Array([1]) }]),
      ).rejects.toThrow();
      await expect(
        store.saveWork(work, [{ fileName: 'undeclared.jpg', data: new Uint8Array([1]) }]),
      ).rejects.toThrow();
    });

    it('hides leftover photo bytes if an updated work no longer declares the name', async () => {
      const store = makeStore();
      await store.saveWork(work, [{ fileName: 'a.jpg', data: new Uint8Array([9]) }]);
      await store.saveWork({ ...work, photos: ['missing.jpg'] }, []);
      expect(await store.readWorkPhoto('tenant', work.id, 'a.jpg')).toBeUndefined();
    });
  });
}
