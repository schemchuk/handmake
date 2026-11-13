import type { Post, Show } from '@handmake/core';
import { showSchema } from '@handmake/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildInstagramCaption,
  countHashtags,
  instagramCapabilities,
  instagramCaptionLimit,
  instagramCaptionWindow,
  instagramCarouselFrame,
  InstagramRenderError,
  instagramSkipReason,
  renderInstagram,
  renderInstagramShow,
} from '../src/instagram/render';

const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'faden-und-stimmung',
  date: '2026-10-23T14:12:00+02:00',
  publishAt: 'now',
  type: 'free',
  photos: ['01.jpg', '02.jpg'],
  channels: ['telegram', 'instagram'],
  versions: { uk: { provenance: 'human' }, de: { provenance: 'ai-assisted' } },
  texts: { uk: 'Привіт!', de: 'Hallo!' },
  ...overrides,
});

const photos = (n: number) => Array.from({ length: n }, (_, i) => `0${i + 1}.jpg`);

const settings = { language: 'de' };

describe('instagramCapabilities (F33)', () => {
  it('advertises 10 photos, the 2200 caption limit and no polls', () => {
    expect(instagramCapabilities).toEqual({
      maxPhotos: 10,
      captionLimit: instagramCaptionLimit,
      messageLimit: instagramCaptionLimit,
      polls: false,
      pollMaxOptions: 0,
      pollQuestionLimit: 0,
      pollOptionLimit: 0,
    });
    expect(instagramCaptionLimit).toBe(2200);
    expect(instagramCaptionWindow).toBe(125);
    expect(instagramCarouselFrame).toEqual({ width: 1080, height: 1350 });
  });
});

describe('renderInstagram: settings', () => {
  it('requires settings with a 2-letter language', () => {
    expect(() => renderInstagram(makePost(), undefined)).toThrowError(InstagramRenderError);
    expect(() => renderInstagram(makePost(), {})).toThrowError(/language/);
    expect(() => renderInstagram(makePost(), { language: 'Deutsch' })).toThrowError(/language/);
  });

  it('requires the configured language to have a text', () => {
    expect(() =>
      renderInstagram(makePost({ texts: { uk: 'Привіт!' } }), { language: 'de' }),
    ).toThrowError(/"de" has no text/);
  });
});

describe('renderInstagram: skips (site-worthy items only)', () => {
  it('skips a text-only post and names the reason', () => {
    const post = makePost({ photos: [] });
    expect(renderInstagram(post, settings)).toEqual([]);
    expect(instagramSkipReason(post)).toBe('no-photos');
  });

  it.each(['announcement', 'reminder', 'wotw-poll', 'wotw-result'] as const)(
    'skips a %s post',
    (type) => {
      const post = makePost({ type });
      expect(renderInstagram(post, settings)).toEqual([]);
      expect(instagramSkipReason(post)).toBe('not-site-worthy');
    },
  );

  it('skips a site-excluded (test) post', () => {
    const post = makePost({ siteExcluded: true });
    expect(renderInstagram(post, settings)).toEqual([]);
    expect(instagramSkipReason(post)).toBe('site-excluded');
  });

  it('renders a free post', () => {
    expect(instagramSkipReason(makePost())).toBeUndefined();
  });
});

describe('renderInstagram: carousel vs single photo', () => {
  it.each([1, 2, 10])('renders %d photo(s) as one mediaGroup op', (n) => {
    const ops = renderInstagram(makePost({ photos: photos(n) }), settings);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      kind: 'mediaGroup',
      photoIndexes: photos(n).map((_, i) => i),
      caption: 'Hallo!\n\nOriginalarbeit',
      captionLang: 'de',
    });
  });

  it('rejects more than 10 photos', () => {
    expect(() => renderInstagram(makePost({ photos: photos(11) }), settings)).toThrowError(
      /at most 10/,
    );
  });
});

describe('renderInstagram: caption rules (F33, ported ig-caption lint)', () => {
  it(`accepts a caption at exactly ${instagramCaptionLimit} chars`, () => {
    const ops = renderInstagram(
      makePost({
        texts: {
          uk: 'Привіт!',
          de: 'x'.repeat(instagramCaptionLimit - '\n\nOriginalarbeit'.length),
        },
      }),
      settings,
    );
    expect(ops[0]).toMatchObject({
      caption:
        'x'.repeat(instagramCaptionLimit - '\n\nOriginalarbeit'.length) + '\n\nOriginalarbeit',
    });
  });

  it(`rejects a caption at ${instagramCaptionLimit + 1} chars`, () => {
    const long = 'x'.repeat(instagramCaptionLimit + 1);
    expect(() =>
      renderInstagram(makePost({ texts: { uk: 'Привіт!', de: long } }), settings),
    ).toThrowError(/2200/);
  });

  it('accepts at most 5 hashtags (hard limit)', () => {
    const five = 'Nachricht\n#one #two #three #four #five';
    expect(renderInstagram(makePost({ texts: { uk: 'x', de: five } }), settings)[0]).toMatchObject({
      caption: 'Nachricht\n\nOriginalarbeit\n\n#one #two #three #four #five',
    });
    const six = 'Nachricht\n#one #two #three #four #five #six';
    expect(() => renderInstagram(makePost({ texts: { uk: 'x', de: six } }), settings)).toThrowError(
      /at most 5 hashtags/,
    );
    // Cyrillic tags count too (PR #93 review note): 6 of them must fail the cap.
    const sixCyrillic = 'Nachricht\n#один #два #три #чотири #пять #шість';
    expect(() =>
      renderInstagram(makePost({ texts: { uk: 'x', de: sixCyrillic } }), settings),
    ).toThrowError(/at most 5 hashtags/);
  });

  it('counts tags in any alphabet; only start-of-string or whitespace opens a tag', () => {
    expect(countHashtags('#handmade #stickerei')).toBe(2);
    expect(countHashtags('вишивка #handmade')).toBe(1);
    expect(countHashtags('#вишивка рахується')).toBe(1);
    expect(countHashtags('#вишивка #handmade #stickerei #diy #своїмируками #шестий')).toBe(6);
    expect(countHashtags('abc#midword не рахується')).toBe(0);
  });

  it('rejects a caption that opens on a hashtag, a mention or a blank line', () => {
    expect(() =>
      renderInstagram(makePost({ texts: { uk: 'x', de: '#handmade перше' } }), settings),
    ).toThrowError(/opens on a hashtag or a mention/);
    expect(() =>
      renderInstagram(makePost({ texts: { uk: 'x', de: '@fadenundstimmung перше' } }), settings),
    ).toThrowError(/opens on a hashtag or a mention/);
    expect(() =>
      renderInstagram(makePost({ texts: { uk: 'x', de: '\nПерше речення' } }), settings),
    ).toThrowError(/blank line/);
  });

  it('carries no link: the caption is the message only (ported rule)', () => {
    expect(renderInstagram(makePost(), settings)[0]).toMatchObject({
      caption: 'Hallo!\n\nOriginalarbeit',
    });
    expect(buildInstagramCaption('Hallo!')).toBe('Hallo!');
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

describe('renderInstagramShow', () => {
  it('renders one image carousel with the AI label and no link (ported rule)', () => {
    const show = fixture();
    const ops = renderInstagramShow(show, showContext);
    expect(ops).toEqual([
      {
        kind: 'mediaGroup',
        photoIndexes: [0, 1, 2],
        captionLang: 'de',
        caption: 'Fixture DE\n\nKI-generiertes Model\nOriginalarbeit',
      },
    ]);
  });

  it('uses the configured caption language', () => {
    const show = fixture();
    const ops = renderInstagramShow(show, { ...showContext, settings: { language: 'uk' } });
    expect(ops[0]).toMatchObject({
      captionLang: 'uk',
      caption: 'Fixture UA\n\nМодель згенерована ШІ (KI-generiertes Model)\nОригінальна робота',
    });
  });

  it('skips a site-excluded show', () => {
    expect(renderInstagramShow({ ...fixture(), siteExcluded: true }, showContext)).toEqual([]);
  });

  it('requires a description in the caption language', () => {
    const show = fixture();
    delete show.versions.de;
    expect(() => renderInstagramShow(show, showContext)).toThrowError(/has no show description/);
  });

  it('enforces the caption limit', () => {
    const show = fixture();
    show.versions.de!.description = 'x'.repeat(instagramCaptionLimit - '\n\nOriginalarbeit'.length);
    expect(() => renderInstagramShow(show, showContext)).toThrowError(/2200/);
  });
});
