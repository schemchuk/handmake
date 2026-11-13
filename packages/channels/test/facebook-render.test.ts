import type { Post, Show } from '@handmake/core';
import { showSchema } from '@handmake/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildFacebookCaption,
  facebookCapabilities,
  facebookCaptionLimit,
  FacebookRenderError,
  facebookSkipReason,
  renderFacebook,
  renderFacebookShow,
} from '../src/facebook/render';

const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'faden-und-stimmung',
  date: '2026-10-23T14:12:00+02:00',
  publishAt: 'now',
  type: 'free',
  photos: ['01.jpg', '02.jpg'],
  channels: ['telegram', 'instagram', 'facebook'],
  versions: { uk: { provenance: 'human' }, de: { provenance: 'ai-assisted' } },
  texts: { uk: 'Привіт!', de: 'Hallo!' },
  ...overrides,
});

const photos = (n: number) => Array.from({ length: n }, (_, i) => `0${i + 1}.jpg`);

const settings = { language: 'de' };

const canonical = {
  links: true as const,
  baseUrl: 'https://fadenundstimmung.de',
  defaultLanguage: 'de',
  section: 'posts' as const,
};

describe('facebookCapabilities (F33)', () => {
  it('advertises 10 photos, the 63206 caption limit and no polls', () => {
    expect(facebookCapabilities).toEqual({
      maxPhotos: 10,
      captionLimit: facebookCaptionLimit,
      messageLimit: facebookCaptionLimit,
      polls: false,
      pollMaxOptions: 0,
      pollQuestionLimit: 0,
      pollOptionLimit: 0,
    });
    expect(facebookCaptionLimit).toBe(63206);
  });
});

describe('renderFacebook: settings', () => {
  it('requires settings with a 2-letter language', () => {
    expect(() => renderFacebook(makePost(), undefined)).toThrowError(FacebookRenderError);
    expect(() => renderFacebook(makePost(), {})).toThrowError(/language/);
    expect(() => renderFacebook(makePost(), { language: 'Deutsch' })).toThrowError(/language/);
  });

  it('requires the configured language to have a text', () => {
    expect(() =>
      renderFacebook(makePost({ texts: { uk: 'Привіт!' } }), { language: 'de' }),
    ).toThrowError(/"de" has no text/);
  });
});

describe('renderFacebook: skips (site-worthy items only)', () => {
  it('skips a text-only post and names the reason', () => {
    const post = makePost({ photos: [] });
    expect(renderFacebook(post, settings)).toEqual([]);
    expect(facebookSkipReason(post)).toBe('no-photos');
  });

  it.each(['announcement', 'reminder', 'wotw-result'] as const)('skips a %s post', (type) => {
    const post = makePost({ type });
    expect(renderFacebook(post, settings)).toEqual([]);
    expect(facebookSkipReason(post)).toBe('not-site-worthy');
  });

  it('skips a site-excluded (test) post', () => {
    const post = makePost({ siteExcluded: true });
    expect(renderFacebook(post, settings)).toEqual([]);
    expect(facebookSkipReason(post)).toBe('site-excluded');
  });

  it('renders a free post', () => {
    expect(facebookSkipReason(makePost())).toBeUndefined();
  });
});

describe('renderFacebook: single vs multi photo', () => {
  it.each([1, 2, 10])('renders %d photo(s) as one mediaGroup op', (n) => {
    const ops = renderFacebook(makePost({ photos: photos(n) }), settings);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      kind: 'mediaGroup',
      photoIndexes: photos(n).map((_, i) => i),
      caption: 'Hallo!\n\nOriginalarbeit',
      captionLang: 'de',
    });
  });

  it('rejects more than 10 photos', () => {
    expect(() => renderFacebook(makePost({ photos: photos(11) }), settings)).toThrowError(
      /at most 10/,
    );
  });
});

describe('renderFacebook: caption with the canonical link (F33)', () => {
  it('carries no link without canonical settings', () => {
    expect(renderFacebook(makePost(), settings)[0]).toMatchObject({
      caption: 'Hallo!\n\nOriginalarbeit',
    });
    expect(buildFacebookCaption('Hallo!', 'de', makePost().id)).toBe('Hallo!');
  });

  it('appends the clickable canonical link when settings carry it', () => {
    const ops = renderFacebook(makePost(), { ...settings, canonical });
    expect(ops[0]).toMatchObject({
      caption:
        'Hallo!\n\nOriginalarbeit\n\nMehr auf der Website: https://fadenundstimmung.de/posts/01jbca1b2c3d4e5f6g7h8j9k0m/',
    });
  });

  it('links to the work page for works', () => {
    const ops = renderFacebook(makePost({ id: '01JBCA1B2C3D4E5F6G7H8J9K0W' }), {
      ...settings,
      canonical: { ...canonical, section: 'works' as const },
    });
    expect(ops[0]).toMatchObject({
      caption:
        'Hallo!\n\nOriginalarbeit\n\nMehr auf der Website: https://fadenundstimmung.de/works/01jbca1b2c3d4e5f6g7h8j9k0w/',
    });
  });

  it('keeps the link off when the canonical flag is off', () => {
    const ops = renderFacebook(makePost(), {
      ...settings,
      canonical: { ...canonical, links: false },
    });
    expect(ops[0]).toMatchObject({ caption: 'Hallo!\n\nOriginalarbeit' });
  });

  it('rejects an unsupported footer language', () => {
    expect(() =>
      renderFacebook(makePost({ texts: { fr: 'Bonjour !' } }), {
        language: 'fr',
        canonical: { ...canonical, defaultLanguage: 'fr' },
      }),
    ).toThrowError(/unsupported authenticity label language/);
  });

  it('rejects a canonical baseUrl that is not an https origin', () => {
    for (const baseUrl of ['http://insecure.example', 'https://fadenundstimmung.de/sub']) {
      expect(() =>
        renderFacebook(makePost(), { ...settings, canonical: { ...canonical, baseUrl } }),
      ).toThrowError(/must be an https origin/);
    }
  });

  it(`enforces the ${facebookCaptionLimit} caption limit`, () => {
    const long = 'x'.repeat(facebookCaptionLimit + 1);
    expect(() => renderFacebook(makePost({ texts: { uk: 'x', de: long } }), settings)).toThrowError(
      /63206/,
    );
  });
});

const fixture = (): Show =>
  showSchema.parse(
    JSON.parse(
      readFileSync(new URL('../../core/test/fixtures/show.json', import.meta.url), 'utf8'),
    ),
  );

const showContext = {
  site: { baseUrl: 'https://craft.example', defaultLanguage: 'de' },
  languages: ['de', 'uk'],
  settings: { language: 'de' },
};

describe('renderFacebookShow', () => {
  it('renders one image op with the AI label and the clickable show link', () => {
    const show = fixture();
    const ops = renderFacebookShow(show, showContext);
    expect(ops).toEqual([
      {
        kind: 'mediaGroup',
        photoIndexes: [0, 1, 2],
        captionLang: 'de',
        caption:
          'Fixture DE\n\nKI-generiertes Model\nOriginalarbeit\nhttps://craft.example/shows/01jbca1b2c3d4e5f6g7h8j9k0z/',
      },
    ]);
  });

  it('uses the configured caption language', () => {
    const show = fixture();
    const ops = renderFacebookShow(show, { ...showContext, settings: { language: 'uk' } });
    expect(ops[0]).toMatchObject({
      captionLang: 'uk',
      caption:
        'Fixture UA\n\nМодель згенерована ШІ (KI-generiertes Model)\nОригінальна робота\nhttps://craft.example/uk/shows/01jbca1b2c3d4e5f6g7h8j9k0z/',
    });
  });

  it('skips a site-excluded show', () => {
    expect(renderFacebookShow({ ...fixture(), siteExcluded: true }, showContext)).toEqual([]);
  });

  it('rejects a show with no images at render time', () => {
    expect(() => renderFacebookShow({ ...fixture(), images: [] }, showContext)).toThrowError(
      /no images/,
    );
  });

  it('rejects a show with more than 10 images at render time', () => {
    const show = fixture();
    show.images = Array.from({ length: 11 }, (_, i) => ({
      ...show.images[0]!,
      fileName: `image-${i}.png`,
    }));
    expect(() => renderFacebookShow(show, showContext)).toThrowError(/at most 10/);
  });

  it('requires a description in the caption language', () => {
    const show = fixture();
    delete show.versions.de;
    expect(() => renderFacebookShow(show, showContext)).toThrowError(/has no show description/);
  });

  it('enforces the caption limit', () => {
    const show = fixture();
    show.versions.de!.description = 'x'.repeat(facebookCaptionLimit);
    expect(() => renderFacebookShow(show, showContext)).toThrowError(/63206/);
  });
});

it.each([
  ['uk', 'Роботи тижня. Голосуйте в Telegram або Instagram.', 'Робота №'],
  ['de', 'Werke der Woche. Stimmt in Telegram oder Instagram ab.', 'Werk Nr.'],
])('renders a %s Facebook ballot without comment-vote instructions', (language, intro, label) => {
  const post = makePost({
    type: 'wotw-poll',
    texts: { uk: 'Напишіть номер у коментарі', de: 'Nummer in einen Kommentar schreiben' },
    poll: { question: 'Favorite?', options: ['No 1', 'No 2'] },
  });
  const [op] = renderFacebook(post, { language, canonical });
  expect(op).toMatchObject({
    kind: 'mediaGroup',
    photoIndexes: [0, 1],
    captionLang: language,
    caption: expect.stringContaining(`${intro}\n\n${label} 1\n${label} 2`),
  });
  expect(JSON.stringify(op)).not.toMatch(/коментар|Kommentar/);
  expect(JSON.stringify(op)).not.toContain(canonical.baseUrl);
  expect(JSON.stringify(op)).not.toMatch(/Mehr auf der Website|Більше на сайті/);
  expect(renderFacebook({ ...post, siteExcluded: true }, { language })).toEqual([]);
});
