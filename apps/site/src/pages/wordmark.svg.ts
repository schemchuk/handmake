import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { findRepoRoot, loadSiteData } from '../lib/site-data';

export const GET: APIRoute = async () => {
  const { site } = await loadSiteData();
  if (!site.theme.wordmark) return new Response(null, { status: 404 });
  const root = await realpath(process.env.SITE_REPO_ROOT ?? findRepoRoot(process.cwd()));
  const file = await realpath(path.resolve(root, site.theme.wordmark));
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Wordmark escapes repository');
  return new Response(await readFile(file), { headers: { 'Content-Type': 'image/svg+xml' } });
};
