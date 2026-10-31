import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseTenantConfig } from '@handmake/core';
import type { Post, SiteConfig, TenantConfig } from '@handmake/core';
import { GitRepoContentStore } from '@handmake/stores';

/** Post types that belong on the public blog; announcements, reminders and polls stay in channels. */
export const siteVisibleTypes: ReadonlySet<Post['type']> = new Set(['free']);

export interface SitePost {
  post: Post;
  /** Languages this post can be shown in (it has text for them). */
  languages: string[];
}

export interface SiteData {
  tenant: TenantConfig;
  site: SiteConfig;
  posts: SitePost[];
  store: GitRepoContentStore;
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

export function visiblePosts(posts: Post[]): SitePost[] {
  return posts
    .filter((post) => siteVisibleTypes.has(post.type))
    .map((post) => ({ post, languages: Object.keys(post.texts) }));
}

let cached: Promise<SiteData> | undefined;

export function loadSiteData(): Promise<SiteData> {
  cached ??= (async () => {
    const root = process.env.SITE_REPO_ROOT ?? findRepoRoot(process.cwd());
    const tenant = readTenantConfig(root);
    if (!tenant.site) {
      throw new Error(`tenant "${tenant.id}" has no "site:" section; the site cannot be built`);
    }
    const store = new GitRepoContentStore({ rootDir: root });
    return {
      tenant,
      site: tenant.site,
      posts: visiblePosts(await store.listPosts(tenant.id)),
      store,
      indexable: process.env.SITE_INDEXABLE === 'true',
    };
  })();
  return cached;
}

/** Posts that can be shown in one language, newest first (the store's order). */
export function postsIn(data: Pick<SiteData, 'posts'>, lang: string): SitePost[] {
  return data.posts.filter((p) => p.languages.includes(lang));
}
