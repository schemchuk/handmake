import { describe, expect, it, vi } from 'vitest';
import type { ContentStore, Show, ShowContentStore, Work } from '@handmake/core';

import { loadShows, showOriginalVideo, showsIn } from '../src/lib/shows';

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

describe('show original video', () => {
  const work = {
    id: 'work',
    tenant: 'fixture',
    versions: { de: {} },
    video: { fileName: 'original.mp4' },
  } as unknown as Work;

  it('reuses the linked work video regardless of its languages', () => {
    expect(
      showOriginalVideo(
        {
          ...show('show'),
          versions: { uk: { description: 'Fixture', provenance: 'human' } },
        } as Show,
        [work],
      ),
    ).toBe('/work-media/work/original.mp4');
  });
  it('returns no video for missing, foreign or video-free works', () => {
    for (const works of [
      [],
      [{ ...work, video: undefined }],
      [{ ...work, tenant: 'other' }],
      [{ ...work, id: 'unlinked' }],
    ]) {
      expect(showOriginalVideo(show('show'), works)).toBeUndefined();
    }
  });
  it('keeps legacy photos while selecting the work video', () => {
    const legacy = {
      ...show('show'),
      authentic: [{ kind: 'photo', fileName: 'photo.jpg' }],
    } as Show;
    expect(showOriginalVideo(legacy, [work])).toBe('/work-media/work/original.mp4');
  });
  it('prefers the legacy authentic video over the linked work video', () => {
    const legacy = {
      ...show('show'),
      authentic: [{ kind: 'video', fileName: 'legacy.mp4' }],
    } as Show;
    expect(showOriginalVideo(legacy, [work])).toBe('/show-media/show/legacy.mp4');
  });
});
