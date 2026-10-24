import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { TenantConfigError, parseTenantConfig } from '@handmake/core';
import type { TenantConfig } from '@handmake/core';

/** Load `config/tenants/*.yaml` under rootDir and return the matching tenant. */
export async function loadTenantConfig(tenantId: string, rootDir: string): Promise<TenantConfig> {
  const tenantsDir = path.join(rootDir, 'config', 'tenants');
  let files: string[];
  try {
    files = await readdir(tenantsDir);
  } catch (error) {
    throw new TenantConfigError(
      `cannot read tenant configs at ${tenantsDir}: ${(error as Error).message}`,
    );
  }
  const configs: TenantConfig[] = [];
  for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort()) {
    configs.push(parseTenantConfig(await readFile(path.join(tenantsDir, file), 'utf8')));
  }
  const found = configs.find((config) => config.id === tenantId);
  if (!found) {
    const available = configs.map((config) => config.id).join(', ') || '(none)';
    throw new TenantConfigError(`tenant "${tenantId}" not found; available tenants: ${available}`);
  }
  return found;
}
