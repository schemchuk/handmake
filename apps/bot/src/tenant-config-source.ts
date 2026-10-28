import { parseTenantConfig } from '@handmake/core';
import type { TenantConfig } from '@handmake/core';

/**
 * Where the bot Worker reads tenant config (T20). The bot never had a local
 * copy: config/tenants/*.yaml in the git repo is the single source of truth
 * and the repo is public, so the cron handler fetches the tenant's YAML over
 * HTTPS. Config changes on main reach the next cron tick without a redeploy.
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

const configPath = (tenantId: string) => `config/tenants/${tenantId}.yaml`;

export function createGitHubTenantConfigSource(
  options: GitHubTenantConfigOptions,
): TenantConfigSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async load(tenantId) {
      const url = `https://raw.githubusercontent.com/${options.repo}/${options.ref}/${configPath(tenantId)}`;
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(
          `tenant config fetch failed: HTTP ${response.status} for ${configPath(tenantId)}`,
        );
      }
      return parseTenantConfig(await response.text());
    },
  };
}
