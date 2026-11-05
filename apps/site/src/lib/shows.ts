import type { ContentStore, Show, ShowContentStore } from '@handmake/core';

export const showPage = (show: Show) => `shows/${show.id.toLowerCase()}`;
export const showMediaPath = (show: Show, file: string) =>
  `/show-media/${show.id.toLowerCase()}/${file}`;
export const showsIn = (data: { shows: Show[] }, lang: string) =>
  data.shows.filter((show) => !!show.versions[lang]);

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
