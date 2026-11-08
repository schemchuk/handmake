import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

const REAL_TENANT_CONFIG = new URL('../../../../config/tenants/faden-und-stimmung.yaml', import.meta.url);

/**
 * The real tenant config with the instagram channel stripped, written into a
 * throwaway repo's config/tenants. Everything else stays byte-identical, so
 * tests that string-replace config values keep working. Existing
 * telegram-only publish/copy scenarios stay focused on telegram; Instagram
 * wiring has its own tests (instagram-publish.test.ts) that keep the full
 * config.
 */
export async function writeTelegramOnlyTenantConfig(tenantsDir: string): Promise<void> {
  const raw = await readFile(REAL_TENANT_CONFIG, 'utf8');
  // Drop the instagram key, its indented values and any preceding
  // same-indent comment lines; fail loudly if the shape ever drifts.
  const stripped = raw.replace(
    /(?:\n {2}#[^\n]*)*\n {2}instagram:\n(?: {4}[^\n]*(?:\n|$))+/,
    '\n',
  );
  const config = parse(stripped) as { channels: Record<string, unknown> };
  if (!('telegram' in config.channels) || 'instagram' in config.channels) {
    throw new Error('tenant config strip failed: expected telegram-only channels');
  }
  await mkdir(tenantsDir, { recursive: true });
  await writeFile(path.join(tenantsDir, 'faden-und-stimmung.yaml'), stripped);
}
