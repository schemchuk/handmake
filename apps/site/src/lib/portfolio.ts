import sharp from 'sharp';

import type { Collection, ContentStore, Work } from '@handmake/core';

import { excerpt } from './text';

export type PortfolioItem = Work | Collection;
export type PortfolioSection = 'works' | 'collections';
export interface WorkImage {
  variants: { width: number; height: number; url: string; bytes: Uint8Array }[];
}
export const workImageKey = (id: string, file: string) => `${id}/${file}`;
export const portfolioKey = (item: PortfolioItem) =>
  'id' in item ? item.id.toLowerCase() : item.slug;
export const portfolioPage = (section: PortfolioSection, item: PortfolioItem) =>
  `${section}/${portfolioKey(item)}`;
export const portfolioLanguages = (item: PortfolioItem, languages: string[]) =>
  languages.filter((lang) => !!item.versions[lang]);
export const portfolioTitle = (item: PortfolioItem, lang: string) =>
  'id' in item ? excerpt(item.versions[lang]!.description, 60) : item.versions[lang]!.title;
export const portfolioCover = (item: PortfolioItem) =>
  'id' in item ? { workId: item.id, fileName: item.photos[0]! } : item.cover;

/** Published content only, through the port. Broken references fail before any image processing. */
export async function loadPortfolio(store: ContentStore, tenantId: string) {
  const works = (await store.listWorks(tenantId)).filter((work) => work.tenant === tenantId);
  const collections = (await store.listCollections(tenantId)).filter(
    (collection) => collection.tenant === tenantId,
  );
  const byId = new Map(works.map((work) => [work.id, work]));
  for (const work of works) {
    if (!collections.some((collection) => collection.slug === work.collection))
      throw new Error(`work ${work.id}: collection ${work.collection} is absent`);
  }
  for (const collection of collections) {
    const cover = byId.get(collection.cover.workId);
    if (
      !cover ||
      cover.collection !== collection.slug ||
      !cover.photos.includes(collection.cover.fileName)
    )
      throw new Error(`collection ${collection.slug}: dangling cover`);
  }
  const workImages = new Map<string, WorkImage>();
  for (const work of works) {
    for (const file of work.photos) {
      const bytes = await store.readWorkPhoto(tenantId, work.id, file);
      if (!bytes) throw new Error(`work ${work.id}: declared photo ${file} is absent`);
      const metadata = await sharp(bytes).metadata();
      const sourceWidth = (metadata.orientation ?? 1) >= 5 ? metadata.height : metadata.width;
      if (!sourceWidth) throw new Error(`work ${work.id}: photo ${file} has no dimensions`);
      const variants = [];
      for (const width of new Set([480, 960, 1440].map((size) => Math.min(size, sourceWidth)))) {
        const result = await sharp(bytes)
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        variants.push({
          width: result.info.width,
          height: result.info.height,
          url: `/work-media/${work.id.toLowerCase()}/${file}/${result.info.width}.webp`,
          bytes: new Uint8Array(result.data),
        });
      }
      workImages.set(workImageKey(work.id, file), { variants });
    }
  }
  return { works, collections, workImages };
}
