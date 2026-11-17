import { structuralVideo } from './fixtures/video';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { createPortfolioFixture, ids } from './fixtures/portfolio';

const exec = promisify(execFile);
const siteDir = path.resolve(import.meta.dirname, '..');
async function build(root: string, dist: string, indexable = false) {
  return exec('pnpm', ['exec', 'astro', 'build', '--outDir', dist], {
    cwd: siteDir,
    timeout: 60_000,
    maxBuffer: 2_000_000,
    env: {
      ...process.env,
      SITE_REPO_ROOT: root,
      SITE_TENANT: 'fixture',
      SITE_INDEXABLE: String(indexable),
      SITE_REQUIRE_LEGAL: 'true',
      IMPRESSUM_NAME: 'Legal Fixture Name',
      IMPRESSUM_STREET: 'Legal Fixture Street',
      IMPRESSUM_CITY: 'Legal Fixture City',
      IMPRESSUM_EMAIL: 'legal-fixture@example.invalid',
      ASTRO_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'production',
    },
  }).catch((error: Error & { stdout?: string; stderr?: string }) => {
    throw new Error(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`);
  });
}
const html = (dist: string, route: string) =>
  readFile(path.join(dist, route, 'index.html'), 'utf8');
it('builds localized original-video cards and their work video anchors', async () => {
  const { root, dist, store } = await createPortfolioFixture();
  try {
    for (const id of [ids.a, ids.b]) {
      const work = (await store.readWork('fixture', id))!;
      await store.saveWork(
        { ...work, video: { fileName: 'original.mp4', provenance: 'human', people: 'none' } },
        [],
        structuralVideo(),
      );
    }
    await build(root, dist);
    for (const [prefix, label, count] of [
      ['', 'Originalvideo', 1],
      ['uk/', 'Оригінальне відео', 2],
    ] as const) {
      const feed = await html(dist, `${prefix}shows`);
      expect(feed.match(/class="play-mark/g)).toHaveLength(count);
      expect(feed).toContain(label);
      expect(feed).not.toContain('KI-generiertes Model');
      expect(feed).not.toContain('class="empty"');
      expect(feed).toContain(`href="/${prefix}works/${ids.a.toLowerCase()}/#video"`);
      const workPage = await html(dist, `${prefix}works/${ids.a.toLowerCase()}`);
      expect(workPage).toMatch(/<figure id="video"[^>]*>\s*<div[^>]*><video/);
    }
    const ukFeed = await html(dist, 'uk/shows');
    expect(ukFeed.indexOf(`${ids.a.toLowerCase()}/#video`)).toBeLessThan(
      ukFeed.indexOf(`${ids.b.toLowerCase()}/#video`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
