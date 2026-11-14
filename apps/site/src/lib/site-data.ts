import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseTenantConfig } from '@handmake/core';
import type { ContentStore, Post, SiteConfig, TenantConfig } from '@handmake/core';
import { GitRepoContentStore } from '@handmake/stores';

import { imageDimensions, videoDimensions, type Dimensions } from './media-dimensions';
import { mediaPath } from './paths';
import { bundledFamilies } from './font-families';
import { loadPortfolio, workVideoPath } from './portfolio';
import { loadShows, showMediaPath } from './shows';

/** Post types that belong on the public blog; announcements, reminders and polls stay in channels. */
export const siteVisibleTypes: ReadonlySet<Post['type']> = new Set(['free']);

export interface SitePost {
  post: Post;
  /** Languages this post can be shown in (it has text for them). */
  languages: string[];
}

export interface SiteData
  extends Awaited<ReturnType<typeof loadPortfolio>>, Awaited<ReturnType<typeof loadShows>> {
  tenant: TenantConfig;
  site: SiteConfig;
  posts: SitePost[];
  imageSizes: Map<string, Dimensions>;
  store: ContentStore & Pick<GitRepoContentStore, 'readWorkVideo'>;
  /** Search engines are kept out until the go-live checklist (T41) sets SITE_INDEXABLE=true. */
  indexable: boolean;
}

export function findRepoRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`repo root (pnpm-workspace.yaml) not found above ${from}`);
    dir = parent;
  }
}

/** Picks the tenant config: `SITE_TENANT` if set, otherwise the only file in config/tenants. */
export function readTenantConfig(root: string, tenantId = process.env.SITE_TENANT): TenantConfig {
  const dir = path.join(root, 'config', 'tenants');
  const files = readdirSync(dir).filter((file) => file.endsWith('.yaml'));
  const file = tenantId ? `${tenantId}.yaml` : files.length === 1 ? files[0] : undefined;
  if (!file || !files.includes(file)) {
    throw new Error(
      `cannot pick a tenant config in ${dir}: set SITE_TENANT to one of [${files.map((f) => f.replace(/\.yaml$/, '')).join(', ')}]`,
    );
  }
  return parseTenantConfig(readFileSync(path.join(dir, file), 'utf8'));
}

/** `languages` are the tenant's: a text in a language the site does not serve gets no page. */
export function visiblePosts(posts: Post[], tenantLanguages: string[]): SitePost[] {
  return posts
    .filter((post) => siteVisibleTypes.has(post.type) && !post.siteExcluded)
    .map((post) => ({
      post,
      languages: tenantLanguages.filter((lang) => lang in post.texts),
    }));
}

/** A configured family without bundled files would silently fall back; fail the build instead. */
export function assertBundledFonts(site: SiteConfig): void {
  for (const family of new Set([site.theme.fonts.display, site.theme.fonts.body])) {
    if (!bundledFamilies.some((bundled) => bundled === family)) {
      throw new Error(
        `font "${family}" is not bundled; add its files to apps/site/src/lib/fonts.ts (bundled: ${bundledFamilies.join(', ')})`,
      );
    }
  }
}

const placeholderMarker = 'REPLACE_';

/** A site that search engines may index must not carry placeholder values (go-live, T41). */
export function assertNoPlaceholders(site: SiteConfig): void {
  if (site.circle?.joinUrl.includes(placeholderMarker)) {
    throw new Error(
      'SITE_INDEXABLE=true but site.circle.joinUrl is still a placeholder; set the real link first',
    );
  }
}

let cached: Promise<SiteData> | undefined;

export function loadSiteData(): Promise<SiteData> {
  // Cached for one build; the dev server re-reads content on every request.
  if (process.env.NODE_ENV === 'development') cached = undefined;
  cached ??= (async () => {
    const root = process.env.SITE_REPO_ROOT ?? findRepoRoot(process.cwd());
    const tenant = readTenantConfig(root);
    if (!tenant.site) {
      throw new Error(`tenant "${tenant.id}" has no "site:" section; the site cannot be built`);
    }
    const store = new GitRepoContentStore({ rootDir: root });
    assertBundledFonts(tenant.site);
    const indexable = process.env.SITE_INDEXABLE === 'true';
    if (indexable) assertNoPlaceholders(tenant.site);
    const posts = visiblePosts(await store.listPosts(tenant.id), tenant.languages);
    const showData = await loadShows(store, tenant.id);
    const imageSizes = new Map<string, Dimensions>();
    for (const { post } of posts) {
      for (const file of post.photos) {
        imageSizes.set(
          mediaPath(post.id, file),
          await imageDimensions(await store.readPostPhoto(tenant.id, post.id, file)),
        );
      }
    }
    for (const show of showData.shows) {
      for (const image of [
        ...show.images,
        ...(show.authentic ?? []).filter((item) => item.kind === 'photo'),
      ]) {
        imageSizes.set(
          showMediaPath(show, image.fileName),
          await imageDimensions(await store.readShowMedia(tenant.id, show.id, image.fileName)),
        );
      }
    }
    const portfolio = await loadPortfolio(store, tenant.id);
    for (const work of portfolio.works) {
      if (!work.video) continue;
      const bytes = await store.readWorkVideo(tenant.id, work.id);
      if (!bytes) throw new Error(`work ${work.id}: ${work.video.fileName} is absent`);
      imageSizes.set(workVideoPath(work), videoDimensions(bytes));
    }
    for (const show of showData.shows) {
      for (const video of [
        show.video,
        ...(show.authentic ?? []).filter((item) => item.kind === 'video'),
      ]) {
        imageSizes.set(
          showMediaPath(show, video.fileName),
          videoDimensions(await store.readShowMedia(tenant.id, show.id, video.fileName)),
        );
      }
    }
    return {
      tenant,
      site: tenant.site,
      posts,
      imageSizes,
      ...portfolio,
      ...showData,
      store,
      indexable,
    };
  })();
  return cached;
}

/** Posts that can be shown in one language, newest first (the store's order). */
export function postsIn(data: Pick<SiteData, 'posts'>, lang: string): SitePost[] {
  return data.posts.filter((p) => p.languages.includes(lang));
}
