import { describe, expect, it, vi } from 'vitest';
import type { ContentStore, Show, ShowContentStore, Work } from '@handmake/core';

import { loadShows, showsIn } from '../src/lib/shows';

const show = (id: string, tenant = 'fixture', date = '2026-11-03T12:00:00Z') =>
  ({
    id,
    tenant,
    date,
    workId: 'work',
    originals: [{ fileName: 'a.png' }],
    versions: { de: {} },
  }) as unknown as Show;
const store = (
  shows: Show[],
  work: Partial<Work> | undefined = { tenant: 'fixture', photos: ['a.png'] },
) =>
  ({
    listShows: vi.fn().mockResolvedValue(shows),
    readWork: vi.fn().mockResolvedValue(work),
  }) as unknown as ContentStore & ShowContentStore;

describe('published shows', () => {
  it('isolates tenants, orders newest first and never falls back between languages', async () => {
    const data = await loadShows(
      store([
        show('old', 'fixture', '2026-11-01T12:00:00Z'),
        show('foreign', 'other'),
        show('new'),
      ]),
      'fixture',
    );
    expect(data.shows.map(({ id }) => id)).toEqual(['new', 'old']);
    expect(showsIn(data, 'uk')).toEqual([]);
  });
  it('filters test shows before reference reads and shows of test works', async () => {
    const excluded = { ...show('hidden'), siteExcluded: true };
    const hiddenStore = store([excluded]);
    expect((await loadShows(hiddenStore, 'fixture')).shows).toEqual([]);
    expect(hiddenStore.readWork).not.toHaveBeenCalled();
    expect(
      (
        await loadShows(
          store([show('linked')], {
            tenant: 'fixture',
            photos: ['a.png'],
            siteExcluded: true,
          }),
          'fixture',
        )
      ).shows,
    ).toEqual([]);
  });
  it('fails on missing or foreign linked works and undeclared originals', async () => {
    for (const work of [
      null,
      { tenant: 'other', photos: ['a.png'] },
      { tenant: 'fixture', photos: [] },
    ]) {
      await expect(
        loadShows(store([show('show')], work as Work | undefined), 'fixture'),
      ).rejects.toThrow('show show:');
    }
  });
});
