import { execFile } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { createPortfolioFixture, ids } from './fixtures/portfolio';

const exec = promisify(execFile);
const siteDir = path.resolve(import.meta.dirname, '..');
async function build(root: string, dist: string) {
  return exec('pnpm', ['exec', 'astro', 'build', '--outDir', dist], {
    cwd: siteDir,
    timeout: 60_000,
    maxBuffer: 2_000_000,
    env: {
      ...process.env,
      SITE_REPO_ROOT: root,
      SITE_TENANT: 'fixture',
      SITE_INDEXABLE: 'false',
      ASTRO_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'production',
    },
  }).catch((error: Error & { stdout?: string; stderr?: string }) => {
    throw new Error(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`);
  });
}
const html = (dist: string, route: string) =>
  readFile(path.join(dist, route, 'index.html'), 'utf8');
describe('portfolio fixture build', () => {
  it('builds localized lists/details, valid navigation, truthful provenance and responsive images while preserving originals', async () => {
    const fixture = await createPortfolioFixture();
    const { root, dist, original } = fixture;
    try {
      await build(root, dist);
      const workUrl = `works/${ids.a.toLowerCase()}`;
      const de = await html(dist, workUrl);
      const uk = await html(dist, `uk/${workUrl}`);
      expect(de).toContain(`rel="canonical" href="https://example.invalid/${workUrl}/"`);
      expect(uk).toContain(`rel="canonical" href="https://example.invalid/uk/${workUrl}/"`);
      expect(de).toContain(`hreflang="uk" href="https://example.invalid/uk/${workUrl}/"`);
      expect(de).toContain('Beschreibung: Von KI erstellt');
      expect(uk).toContain('Опис: Створено за допомогою ШІ');
      expect(de).toContain('Literal &lt;b&gt;fixture&lt;/b&gt; text.');
      expect(de).not.toContain('<p>Literal <b>fixture</b> text.</p>');
      expect(de).toContain('srcset=');
      expect(de).toContain('width="1440"');
      expect(de).toContain('loading="lazy"');
      const imageUrl = /src="(\/work-media\/[^\"]+)"/.exec(de)![1]!;
      const metadata = await sharp(await readFile(path.join(dist, imageUrl))).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(1440);
      expect(metadata.exif).toBeUndefined();
      expect(Buffer.from((await fixture.store.readWorkPhoto('fixture', ids.a, 'a.jpg'))!)).toEqual(
        original,
      );
      const list = await html(dist, 'works');
      expect(list.indexOf(`/works/${ids.a.toLowerCase()}/`)).toBeLessThan(
        list.indexOf(`/works/${ids.c.toLowerCase()}/`),
      );
      expect(list).not.toContain(ids.b.toLowerCase());
      expect(list).not.toContain(ids.foreign.toLowerCase());
      const collection = await html(dist, 'collections/first');
      expect(collection).toContain(`/works/${ids.a.toLowerCase()}/`);
      expect(collection).toContain(`/works/${ids.c.toLowerCase()}/`);
      expect(collection).not.toContain(ids.b.toLowerCase());
      const collections = await html(dist, 'uk/collections');
      expect(collections.indexOf('/uk/collections/first/')).toBeLessThan(
        collections.indexOf('/uk/collections/second/'),
      );
      await expect(
        access(path.join(dist, `works/${ids.b.toLowerCase()}/index.html`)),
      ).rejects.toThrow();
      await expect(access(path.join(dist, 'collections/second/index.html'))).rejects.toThrow();
      const untranslated = await html(dist, `uk/works/${ids.b.toLowerCase()}`);
      expect(untranslated).not.toContain('hreflang="de"');
      for (const route of [
        'works',
        'collections',
        'collections/first',
        'uk/collections',
        'uk/collections/second',
        workUrl,
        `uk/${workUrl}`,
        `uk/works/${ids.b.toLowerCase()}`,
      ]) {
        for (const [, href] of (await html(dist, route)).matchAll(/<a\b[^>]*href="(\/[^\"]*)"/g)) {
          await expect(access(path.join(dist, href!, 'index.html'))).resolves.toBeUndefined();
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails loudly on malformed stored work rather than dropping it', async () => {
    const { root, dist } = await createPortfolioFixture();
    try {
      await writeFile(path.join(root, 'content/works', ids.a, 'index.md'), 'broken work');
      await expect(build(root, dist)).rejects.toThrow(`content/works/${ids.a}/index.md`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
