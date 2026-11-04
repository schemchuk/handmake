import { readFileSync } from 'node:fs';
import { findRepoRoot } from './site-data';
import path from 'node:path';

export const legalFields = [
  'IMPRESSUM_NAME',
  'IMPRESSUM_STREET',
  'IMPRESSUM_CITY',
  'IMPRESSUM_EMAIL',
] as const;
const directory = path.join(findRepoRoot(process.cwd()), 'docs/legal/');
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Missing values are safe preview placeholders; production deploys must require all fields. */
export function renderLegal(
  kind: 'impressum' | 'datenschutz',
  env: NodeJS.ProcessEnv = process.env,
): string {
  const missing = legalFields.filter((key) => !env[key]?.trim());
  if (missing.length && (env.SITE_REQUIRE_LEGAL === 'true' || env.SITE_INDEXABLE === 'true')) {
    throw new Error(`Missing legal fields: ${missing.join(', ')}`);
  }
  const source =
    readFileSync(`${directory}${kind}.de.html`, 'utf8') +
    (kind === 'datenschutz' ? readFileSync(`${directory}services.de.html`, 'utf8') : '');
  return source.replace(/\{\{(IMPRESSUM_[A-Z]+)\}\}/g, (_, key: string) =>
    escape(env[key] || `[${key}]`),
  );
}
