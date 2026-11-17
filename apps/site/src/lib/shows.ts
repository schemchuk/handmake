import type { ContentStore, Show, ShowContentStore, Work } from '@handmake/core';

import { workVideoPath } from './portfolio';

export function showOriginalVideo(show: Show, works: Work[]): string | undefined {
  const legacy = show.authentic?.find((item) => item.kind === 'video');
  if (legacy) return showMediaPath(show, legacy.fileName);
  const work = works.find((work) => work.id === show.workId && work.tenant === show.tenant);
  return work?.video ? workVideoPath(work) : undefined;
}

export const showPage = (show: Show) => `shows/${show.id.toLowerCase()}`;
export const showMediaPath = (show: Show, file: string) =>
  `/show-media/${show.id.toLowerCase()}/${file}`;
export const showsIn = (data: { shows: Show[] }, lang: string) =>
  data.shows.filter((show) => !!show.versions[lang]);

export type ShowsFeedEntry =
  { kind: 'show'; show: Show; hasOriginalVideo: boolean } | { kind: 'original'; work: Work };

/** Merge localized shows and original videos without duplicating a linked work. */
export function showsFeed(data: { shows: Show[]; works: Work[] }, lang: string): ShowsFeedEntry[] {
  const works = data.works.filter((work) => !work.siteExcluded);
  const shows = showsIn(data, lang).filter(
    (show) =>
      !show.siteExcluded &&
      !data.works.some(
        (work) => work.id === show.workId && work.tenant === show.tenant && work.siteExcluded,
      ),
  );
  const entries: ShowsFeedEntry[] = shows.map((show) => ({
    kind: 'show',
    show,
    hasOriginalVideo: !!showOriginalVideo(show, works),
  }));
  for (const work of works) {
    if (
      work.video &&
      work.versions[lang] &&
      !shows.some((show) => show.workId === work.id && show.tenant === work.tenant)
    ) {
      entries.push({ kind: 'original', work });
    }
  }
  const item = (entry: ShowsFeedEntry) => (entry.kind === 'show' ? entry.show : entry.work);
  return entries.sort(
    (a, b) => item(b).date.localeCompare(item(a).date) || item(b).id.localeCompare(item(a).id),
  );
}

/** Keep approved marked bytes intact: resizing/re-encoding would remove embedded evidence. */
export async function loadShows(store: ContentStore & ShowContentStore, tenant: string) {
  const shows = (await store.listShows(tenant))
    .filter((show) => show.tenant === tenant && !show.siteExcluded)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const visible = [];
  for (const show of shows) {
    const work = await store.readWork(tenant, show.workId);
    if (!work || work.tenant !== tenant) throw new Error(`show ${show.id}: linked work is absent`);
    if (work.siteExcluded) continue;
    visible.push(show);
    for (const original of show.originals) {
      if (!work.photos.includes(original.fileName))
        throw new Error(`show ${show.id}: undeclared original`);
    }
  }
  return { shows: visible };
}
