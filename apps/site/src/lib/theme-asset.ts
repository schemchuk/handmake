import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { findRepoRoot, loadSiteData } from './site-data';

type ThemeAsset = 'wordmark' | 'logo' | 'mark';

export async function themeAssetResponse(asset: ThemeAsset, size?: number): Promise<Response> {
  const { site } = await loadSiteData();
  const assetPath = site.theme[asset];
  if (!assetPath) return new Response(null, { status: 404 });
  const root = await realpath(process.env.SITE_REPO_ROOT ?? findRepoRoot(process.cwd()));
  const file = await realpath(path.resolve(root, assetPath));
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Theme asset escapes repository');
  const svg = await readFile(file);
  if (size === undefined) {
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
  }
  let image = sharp(svg).resize(size, size);
  if (asset === 'logo') image = image.flatten({ background: site.theme.colors.paper });
  return new Response(await image.png().toBuffer(), {
    headers: { 'Content-Type': 'image/png' },
  });
}
