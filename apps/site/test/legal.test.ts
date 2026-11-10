import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkResources, finalizeSite } from '../src/lib/build-policy';
import { legalFields, renderLegal } from '../src/lib/legal';

const env = Object.fromEntries(legalFields.map((key) => [key, `Fixture<&" ${key}`]));
describe('legal publication policy', () => {
  it('escapes every field in both pages and preserves generator attribution', () => {
    for (const kind of ['impressum', 'datenschutz'] as const) {
      const page = renderLegal(kind, env);
      for (const field of legalFields) expect(page).toContain(`Fixture&lt;&amp;&quot; ${field}`);
      expect(page).not.toContain('{{IMPRESSUM_');
    }
    const privacy = renderLegal('datenschutz', env);
    expect(privacy).toContain('Erstellt mit kostenlosem Datenschutz-Generator');
    expect(privacy).toContain('Kommentare auf unseren Social-Media-Beiträgen');
    expect(privacy).not.toContain('<strong>Zur rechtlichen Prüfung:</strong>');
    expect(privacy).toContain('T49c3 DRAFT');
    expect(privacy).toContain('Telegram-Gruppe «Faden und Stimmung · Austausch»');
    const additions = privacy.indexOf('id="mServices"');
    expect(additions).toBeGreaterThan(privacy.indexOf('id="m136"'));
    expect(additions).toBeLessThan(privacy.indexOf('id="m15"'));
  });
  it('requires complete fields in production without disclosing any supplied value', () => {
    expect(() =>
      renderLegal('impressum', { SITE_REQUIRE_LEGAL: 'true', IMPRESSUM_NAME: 'private-fixture' }),
    ).toThrow('Missing legal fields: IMPRESSUM_STREET, IMPRESSUM_CITY, IMPRESSUM_EMAIL');
    expect(() => renderLegal('datenschutz', { SITE_INDEXABLE: 'true' })).toThrow(
      'Missing legal fields',
    );
    expect(renderLegal('impressum', {})).toContain('[IMPRESSUM_NAME]');
  });
  it.each([
    '<link rel="stylesheet" href="https://fonts.example/style.css">',
    '<style>@import "https://fonts.example/style.css";</style>',
    '<style>p{background:url(//external.example/a)}</style>',
    '<img srcset="/a.png 1x, https://external.example/a.png 2x">',
    '<iframe src="https://external.example/">',
    '<img src="https:&#47;&#47;external.example/a">',
    '<script src="https://static.cloudflareinsights.com/other.js"></script>',
    '<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>',
    '<script>fetch("https://external.example")</script>',
    '<base href="https://external.example/">',
  ])('rejects external or active content: %s', (html) => {
    expect(() => checkResources(html, 'https://example.invalid')).toThrow();
  });
  it('accepts local resources and ordinary external links', () => {
    checkResources(
      '<link rel="stylesheet" href="/a.css"><style>@font-face{src:url(/font.woff2)}</style><img src="/a.png"><a href="https://telegram.org/privacy">Policy</a>',
      'https://example.invalid',
    );
    expect(() =>
      checkResources(
        '<img src="https://static.cloudflareinsights.com/beacon.min.js">',
        'https://example.invalid',
      ),
    ).toThrow();
  });
});

it('generates sitemap only for approved indexing and fails a built external font page', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legal-build-'));
  try {
    await mkdir(path.join(dir, '404'));
    await writeFile(path.join(dir, '404/index.html'), '<h1>404</h1>');
    await writeFile(path.join(dir, 'index.html'), '<h1>Home</h1>');
    await finalizeSite(dir, 'https://example.invalid', true);
    const sitemap = await readFile(path.join(dir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('<loc>https://example.invalid/</loc>');
    expect(sitemap).not.toContain('404');
    expect(await readFile(path.join(dir, '404.html'), 'utf8')).toContain('404');
    await finalizeSite(dir, 'https://example.invalid', false);
    await expect(access(path.join(dir, 'sitemap.xml'))).rejects.toThrow();
    await writeFile(
      path.join(dir, 'bad.html'),
      '<link rel="stylesheet" href="https://fonts.example/style.css">',
    );
    await expect(finalizeSite(dir, 'https://example.invalid', false)).rejects.toThrow(
      'Disallowed external resource',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('names the rejected CSS file without exposing its contents', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'css-policy-'));
  try {
    await writeFile(path.join(dir, 'private.css'), String.raw`p{content:"\private-fixture"}`);
    await expect(finalizeSite(dir, 'https://example.invalid', false)).rejects.toThrow(
      'private.css: Unsupported CSS resource syntax',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('loads legal templates from SITE_REPO_ROOT', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'legal-root-'));
  try {
    await mkdir(path.join(root, 'docs/legal'), { recursive: true });
    await writeFile(
      path.join(root, 'docs/legal/impressum.de.html'),
      '<p>Custom {{IMPRESSUM_NAME}}</p>',
    );
    expect(renderLegal('impressum', { ...env, SITE_REPO_ROOT: root })).toBe(
      '<p>Custom Fixture&lt;&amp;&quot; IMPRESSUM_NAME</p>',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
