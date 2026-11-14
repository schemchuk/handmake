import { execFile } from 'node:child_process';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createPortfolioFixture } from './fixtures/portfolio';
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

it('builds localized making-of pages, local media, contacts, ADRs and every footer; omits optional pages', async () => {
  const fixture = await createPortfolioFixture();
  const { root, dist, tenant } = fixture;
  try {
    tenant.site!.makingOf!.contacts.push(
      { kind: 'linkedin', url: 'https://www.linkedin.com/in/fixture' },
      { kind: 'email', url: 'mailto:fixture@example.invalid' },
    );
    await writeFile(path.join(root, 'config/tenants/fixture.yaml'), JSON.stringify(tenant));
    await build(root, dist, true);
    for (const [route, lang] of [
      ['technik', 'de'],
      ['uk/technik', 'uk'],
    ]) {
      const page = await html(dist, route!);
      expect(page).toContain(tenant.site!.makingOf!.texts[lang!]!.title.replaceAll('&', '&amp;'));
      for (const { url } of tenant.site!.makingOf!.contacts)
        expect(page).toContain(`href="${url}" rel="me noopener"`);
      for (const number of ['003', '007', '006', '004', '011', '016']) {
        expect(page).toContain(
          `${tenant.site!.makingOf!.repoUrl}/blob/main/docs/decisions/${number}-`,
        );
      }
      const video = page.match(/<video[^>]+>/)![0];
      for (const attr of [
        'muted',
        'loop',
        'playsinline',
        'controls',
        'preload="metadata"',
        'width=',
        'height=',
        'src="/technik/demo.mp4"',
      ])
        expect(video).toContain(attr);
      expect(video).not.toContain('autoplay');
      expect(page).not.toMatch(/(?:src|poster)="https?:/);
    }
    expect(await readFile(path.join(dist, 'technik/demo.mp4'))).toEqual(
      await readFile(path.join(siteDir, 'public/technik/demo.mp4')),
    );
    const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('/technik/');
    expect(sitemap).toContain('/uk/technik/');
    const checkFooters = async (dir: string, present: boolean) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await checkFooters(file, present);
        else if (entry.name.endsWith('.html')) {
          const page = await readFile(file, 'utf8');
          const footer = page.match(/<footer[\s\S]*?<\/footer>/)![0];
          const uk = page.includes('<html lang="uk"');
          expect(footer.includes(`href="${uk ? '/uk' : ''}/technik/"`)).toBe(present);
        }
      }
    };
    await checkFooters(dist, true);
    delete tenant.site!.makingOf;
    await writeFile(path.join(root, 'config/tenants/fixture.yaml'), JSON.stringify(tenant));
    await rm(dist, { recursive: true, force: true });
    await build(root, dist, true);
    await expect(access(path.join(dist, 'technik/index.html'))).rejects.toThrow();
    await expect(access(path.join(dist, 'uk/technik/index.html'))).rejects.toThrow();
    await checkFooters(dist, false);
    expect(await readFile(path.join(dist, 'sitemap.xml'), 'utf8')).not.toContain('/technik/');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
