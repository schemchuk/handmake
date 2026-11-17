import { describe, expect, it, vi } from 'vitest';
import type { ContentStore, Show, ShowContentStore, Work } from '@handmake/core';

import { loadShows, showOriginalVideo, showsFeed, showsIn } from '../src/lib/shows';

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

describe('mixed shows feed', () => {
  const work = {
    id: 'work',
    tenant: 'fixture',
    date: '2026-11-02T12:00:00Z',
    versions: { de: {} },
    video: { fileName: 'original.mp4' },
  } as unknown as Work;

  it('includes a work video without a show and deduplicates a linked visible show', () => {
    expect(showsFeed({ works: [work], shows: [] }, 'de')).toEqual([{ kind: 'original', work }]);
    const linked = show('show');
    expect(showsFeed({ works: [work], shows: [linked] }, 'de')).toEqual([
      { kind: 'show', show: linked, hasOriginalVideo: true },
    ]);
  });

  it('omits excluded, untranslated and video-free works', () => {
    for (const hidden of [
      { ...work, siteExcluded: true },
      { ...work, versions: {} },
      { ...work, video: undefined },
    ])
      expect(showsFeed({ works: [hidden], shows: [] }, 'de')).toEqual([]);
  });

  it('only deduplicates against shows visible in the same language and tenant', () => {
    for (const hidden of [
      { ...show('show'), siteExcluded: true },
      { ...show('show'), versions: {} },
      show('foreign', 'other'),
    ]) {
      const entries = showsFeed({ works: [work], shows: [hidden] }, 'de');
      expect(entries).toContainEqual({ kind: 'original', work });
    }
    expect(showsFeed({ works: [work], shows: [show('foreign', 'other')] }, 'de')[0]).toMatchObject({
      kind: 'show',
      hasOriginalVideo: false,
    });
  });

  it('sorts both kinds by descending date, breaking ties by descending id', () => {
    const newest = show('new');
    const tied = { ...show('z'), date: work.date, workId: 'unlinked' };
    const oldest = { ...show('old', 'fixture', '2026-11-01T12:00:00Z'), workId: 'unlinked' };
    const data = { works: [work], shows: [oldest, tied, { ...newest, workId: 'unlinked' }] };
    expect(
      showsFeed(data, 'de').map((entry) => (entry.kind === 'show' ? entry.show.id : entry.work.id)),
    ).toEqual(['new', 'z', 'work', 'old']);
    expect(data.shows[0]).toBe(oldest);
  });
});
