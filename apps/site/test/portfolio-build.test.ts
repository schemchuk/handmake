import { execFile } from 'node:child_process';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { Post, Show } from '@handmake/core';

import { newsletterFormAction } from '../src/lib/newsletter';
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
describe('portfolio fixture build', () => {
  it('builds localized lists/details, valid navigation, truthful provenance and responsive images while preserving originals', async () => {
    const fixture = await createPortfolioFixture();
    const { root, dist, original } = fixture;
    try {
      const marker = {
        visible: 'KI-generiertes Model' as const,
        machineReadable: { format: 'fixture', value: 'fixture' },
      };
      const generatedMetadata = {
        provenance: 'ai-generated' as const,
        model: 'fixture',
        promptVersion: 'v1',
        callId: 'fixture',
        marker,
      };
      const show: Show = {
        id: '01JBCA1B2C3D4E5F6G7H8J9K1A',
        tenant: 'fixture',
        date: '2026-11-03T12:00:00Z',
        workId: ids.a,
        template: 'worn',
        provenance: 'ai-assisted',
        model: {
          id: 'fixture',
          name: 'Fixture Persona',
          look: 'fixture',
          referenceImage: 'fixture',
          fictional: true,
          adult: true,
        },
        originals: [{ fileName: 'a.jpg', provenance: 'human' }],
        images: [1, 2, 3].map((i) => ({ ...generatedMetadata, fileName: `image-${i}.png` })),
        video: { ...generatedMetadata, fileName: 'video.mp4', durationSeconds: 5 },
        versions: {
          de: { description: 'DE show <b>fixture</b>', provenance: 'human' },
          uk: { description: 'UA show fixture', provenance: 'ai-assisted' },
        },
      };
      // Structural bytes test transport preservation; marker verification belongs to publication.
      const marked = await sharp(original).png().toBuffer();
      const video = Buffer.from('structural-video-fixture');
      await fixture.store.saveShow(show, [
        ...show.images.map(({ fileName }) => ({ fileName, data: marked })),
        { fileName: show.video.fileName, data: video },
      ]);
      const untranslatedShow = {
        ...show,
        id: '01JBCA1B2C3D4E5F6G7H8J9K1B',
        date: '2026-11-04T12:00:00Z',
        versions: { uk: show.versions.uk! },
      };
      await fixture.store.saveShow(untranslatedShow, [
        ...show.images.map(({ fileName }) => ({ fileName, data: marked })),
        { fileName: show.video.fileName, data: video },
      ]);
      await fixture.store.savePost(
        {
          id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
          tenant: 'fixture',
          date: '2026-11-04T10:00:00Z',
          publishAt: 'now',
          type: 'free',
          photos: [],
          channels: ['telegram'],
          versions: { de: { provenance: 'human' }, uk: { provenance: 'human' } },
          texts: { de: 'Fixture post', uk: 'Тестовий допис' },
        },
        [],
      );
      fixture.tenant.channels.telegram!.joinUrl = 'https://t.me/fixture_join';
      fixture.tenant.site!.circle = {
        joinUrl: 'https://t.me/fixture_join',
        texts: {
          de: { title: 'Kreis', what: 'Handarbeit', where: 'Landshut' },
          uk: { title: 'Гурток', what: 'Рукоділля', where: 'Ландсгут' },
        },
      };
      await writeFile(
        path.join(root, 'config/tenants/fixture.yaml'),
        JSON.stringify(fixture.tenant),
      );
      const result = await build(root, dist);
      for (const file of await readdir(dist, { recursive: true })) {
        if (!file.endsWith('.html')) continue;
        const page = await readFile(path.join(dist, file), 'utf8');
        expect(page).toContain('href="https://t.me/fixture_join"');
        if (/^(uk\/)?(posts|works|shows)\/[^/]+\/index.html$/.test(file)) {
          const detail = /^(uk\/)?(works|shows)\//.test(file);
          expect(page.match(/class="join-channel"/g)).toHaveLength(detail ? 1 : 2);
          if (detail) {
            expect(page.match(/<form /g)).toHaveLength(1);
            expect(page).toContain(`method="POST" action="${newsletterFormAction}"`);
            expect(page).toContain('type="email" name="EMAIL"');
            expect(page).toContain('name="html_type" value="simple"');
            expect(page).toContain(`name="locale" value="${file.startsWith('uk/') ? 'uk' : 'de'}"`);
            expect(page).toContain('name="email_address_check" value=""');
            expect(page).not.toContain('sib-styles.css');
            expect(page).not.toContain('end-form/build/main.js');
            expect(page).not.toContain('recaptcha');
          }
          expect(page).toContain(
            file.startsWith('uk/') ? 'Підписатися на Telegram-канал' : 'Telegram-Kanal abonnieren',
          );
        }
      }
      for (const value of [
        'Legal Fixture Name',
        'Legal Fixture Street',
        'Legal Fixture City',
        'legal-fixture@example.invalid',
      ]) {
        expect(result.stdout + result.stderr).not.toContain(value);
        for (const route of ['impressum', 'datenschutz', 'uk/impressum', 'uk/datenschutz']) {
          expect(await html(dist, route)).toContain(value);
        }
      }
      expect(await readFile(path.join(dist, '404.html'), 'utf8')).toContain('Seite nicht gefunden');
      expect(await html(dist, 'uk/404')).toContain('Сторінку не знайдено');
      for (const route of ['kreis', 'uk/kreis'] as const) {
        const page = await html(dist, route);
        expect(page).toContain('href="https://t.me/fixture_join"');
        expect(page).not.toContain('class="group"');
        expect(page).not.toContain('Austauschgruppe');
        expect(page).not.toContain('Група для обміну');
      }
      await expect(access(path.join(dist, 'sitemap.xml'))).rejects.toThrow();
      expect(await readFile(path.join(dist, 'robots.txt'), 'utf8')).toContain('Disallow: /');
      for (const route of ['geschenk', 'uk/geschenk']) {
        expect(await html(dist, route)).toContain('href="/geschenk/rosenbluete.pdf" download');
      }
      expect(await readFile(path.join(dist, 'geschenk/rosenbluete.pdf'))).toEqual(
        await readFile(path.join(siteDir, 'public/geschenk/rosenbluete.pdf')),
      );
      const showUrl = `shows/${show.id.toLowerCase()}`;
      const showHtml = await html(dist, showUrl);
      expect(showHtml.match(/<figcaption>KI-generiertes Model<\/figcaption>/g)).toHaveLength(4);
      expect(showHtml).toContain('(3/3)"');
      expect(showHtml).toContain('Fixture Persona');
      expect(showHtml).toContain(`/works/${ids.a.toLowerCase()}/`);
      expect(showHtml).toContain('DE show &lt;b&gt;fixture&lt;/b&gt;');
      expect(showHtml).toContain('controls');
      expect(showHtml).toContain(`rel="canonical" href="https://example.invalid/${showUrl}/"`);
      expect(showHtml).toContain(`hreflang="uk" href="https://example.invalid/uk/${showUrl}/"`);
      expect(await html(dist, `uk/${showUrl}`)).toContain('UA show fixture');
      expect(await html(dist, 'shows')).not.toContain(untranslatedShow.id.toLowerCase());
      expect(await html(dist, '')).toContain(`/${showUrl}/`);
      expect(await html(dist, 'uk')).toContain(`/uk/shows/${untranslatedShow.id.toLowerCase()}/`);
      await expect(
        access(path.join(dist, `shows/${untranslatedShow.id.toLowerCase()}/index.html`)),
      ).rejects.toThrow();
      expect(
        await readFile(path.join(dist, `show-media/${show.id.toLowerCase()}/image-1.png`)),
      ).toEqual(marked);
      expect(
        await readFile(path.join(dist, `show-media/${show.id.toLowerCase()}/video.mp4`)),
      ).toEqual(video);
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

  it('links the discussion group on the circle page when site.groupUrl is set', async () => {
    const fixture = await createPortfolioFixture();
    const { root, dist } = fixture;
    try {
      fixture.tenant.channels.telegram!.joinUrl = 'https://t.me/fixture_join';
      fixture.tenant.site!.circle = {
        joinUrl: 'https://t.me/fixture_join',
        texts: {
          de: { title: 'Kreis', what: 'Handarbeit', where: 'Landshut' },
          uk: { title: 'Гурток', what: 'Рукоділля', where: 'Ландсгут' },
        },
      };
      fixture.tenant.site!.groupUrl = 'https://t.me/fixture_group';
      delete fixture.tenant.site!.newsletter;
      await writeFile(
        path.join(root, 'config/tenants/fixture.yaml'),
        JSON.stringify(fixture.tenant),
      );
      await build(root, dist);
      await expect(access(path.join(dist, 'geschenk/index.html'))).rejects.toThrow();
      const workPage = await html(dist, `works/${ids.a.toLowerCase()}`);
      expect(workPage).not.toContain('<form ');
      expect(workPage.match(/class="join-channel"/g)).toHaveLength(2);
      const de = await html(dist, 'kreis');
      const uk = await html(dist, 'uk/kreis');
      for (const [page, button] of [
        [de, 'Zur Austauschgruppe'],
        [uk, 'До групи'],
      ] as const) {
        expect(page).toContain('href="https://t.me/fixture_group"');
        expect(page).toContain(`>${button}</a>`);
      }
      expect(de).toContain('Austauschgruppe');
      expect(uk).toContain('Група для обміну');
      expect(de).not.toContain('Група для обміну');
      expect(uk).not.toContain('Austauschgruppe');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

it('excludes flagged posts, works, shows and their media from an indexable build and sitemap', async () => {
  const { root, dist, store } = await createPortfolioFixture();
  try {
    const post: Post = {
      id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
      tenant: 'fixture',
      date: '2026-11-04T10:00:00Z',
      publishAt: 'now',
      type: 'free',
      photos: ['photo.jpg'],
      channels: ['telegram'],
      versions: { de: { provenance: 'human' }, uk: { provenance: 'human' } },
      texts: { de: 'Hidden fixture text', uk: 'Hidden fixture text' },
      siteExcluded: true,
    };
    await store.savePost(post, [{ fileName: 'photo.jpg', data: Buffer.from('hidden') }]);
    const publicPost = {
      ...post,
      id: '01JBCA1B2C3D4E5F6G7H8J9K0N',
      photos: [],
      siteExcluded: false,
      texts: { de: 'Public fixture text', uk: 'Public fixture text' },
    };
    await store.savePost(publicPost, []);
    for (const id of [ids.a, ids.b]) {
      const work = (await store.readWork('fixture', id))!;
      await store.saveWork({ ...work, siteExcluded: true }, []);
    }
    const hiddenShow = JSON.parse(
      await readFile(
        new URL('../../../packages/core/test/fixtures/show.json', import.meta.url),
        'utf8',
      ),
    ) as Show;
    hiddenShow.tenant = 'fixture';
    hiddenShow.workId = ids.c;
    hiddenShow.siteExcluded = true;
    hiddenShow.originals = [{ fileName: 'a.jpg', provenance: 'human' }];
    await store.saveShow(
      hiddenShow,
      [...hiddenShow.images, hiddenShow.video].map(({ fileName }) => ({
        fileName,
        data: Buffer.from('hidden media'),
      })),
    );
    await build(root, dist, true);
    const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain(publicPost.id.toLowerCase());
    expect(sitemap).not.toContain(post.id.toLowerCase());
    for (const id of [ids.a, ids.b, hiddenShow.id]) {
      expect(sitemap).not.toContain(id.toLowerCase());
      for (const prefix of ['', 'uk/']) {
        for (const section of ['works', 'shows']) {
          await expect(
            access(path.join(dist, prefix, section, id.toLowerCase())),
          ).rejects.toThrow();
        }
      }
      for (const section of ['work-media', 'show-media']) {
        await expect(access(path.join(dist, section, id.toLowerCase()))).rejects.toThrow();
      }
      for (const file of await readdir(dist, { recursive: true })) {
        if (file.endsWith('.html'))
          expect(await readFile(path.join(dist, file), 'utf8')).not.toContain(id.toLowerCase());
      }
    }
    expect(sitemap).toContain(ids.c.toLowerCase());
    expect(sitemap).not.toContain('/collections/second/');
    for (const prefix of ['', 'uk/']) {
      const home = await html(dist, prefix);
      expect(home).not.toContain('Hidden fixture text');
      expect(home).not.toContain('noindex');
      await expect(
        access(path.join(dist, prefix, 'posts', post.id.toLowerCase())),
      ).rejects.toThrow();
      expect(await html(dist, prefix + 'posts/' + publicPost.id.toLowerCase())).toContain(
        'Public fixture text',
      );
    }
    await expect(access(path.join(dist, 'media', post.id.toLowerCase()))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
