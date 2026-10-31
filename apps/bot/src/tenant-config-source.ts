import { parseTenantConfig } from '@handmake/core';
import type { TenantConfig } from '@handmake/core';

/**
 * Where the bot Worker reads tenant config (T20). The bot never had a local
 * copy: config/tenants/*.yaml in the git repo is the single source of truth
 * and the repo is public, so the cron handler fetches the tenant's YAML over
 * HTTPS. A five-minute cache is shared by source instances; failed refreshes
 * use the last known config, with a warning, until GitHub recovers.
 */

export interface TenantConfigSource {
  load(tenantId: string): Promise<TenantConfig>;
}

export interface GitHubTenantConfigOptions {
  /** "owner/repo" (the GITHUB_REPO var). */
  repo: string;
  /** Git ref to read, e.g. "main". */
  ref: string;
  fetchImpl?: typeof fetch;
}

export const tenantConfigTtlMs = 5 * 60 * 1000;
type ConfigCache = Map<string, { config: TenantConfig; until: number }>;
const caches = new WeakMap<typeof fetch, ConfigCache>();

const configPath = (tenantId: string) => `config/tenants/${tenantId}.yaml`;

export function createGitHubTenantConfigSource(
  options: GitHubTenantConfigOptions,
): TenantConfigSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache: ConfigCache = caches.get(fetchImpl) ?? new Map();
  caches.set(fetchImpl, cache);
  return {
    async load(tenantId) {
      const url = `https://raw.githubusercontent.com/${options.repo}/${options.ref}/${configPath(tenantId)}`;
      const previous = cache.get(url);
      if (previous && previous.until > Date.now()) return previous.config;
      try {
        const response = await fetchImpl(url);
        if (!response.ok) {
          throw new Error(
            `tenant config fetch failed: HTTP ${response.status} for ${configPath(tenantId)}`,
          );
        }
        const config = parseTenantConfig(await response.text());
        cache.set(url, { config, until: Date.now() + tenantConfigTtlMs });
        return config;
      } catch (error) {
        if (!previous) throw error;
        console.warn('Using cached tenant config after refresh failure');
        return previous.config;
      }
    },
  };
}
