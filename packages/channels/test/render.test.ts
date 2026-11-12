import type { EntryNames, Post } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { renderTelegram, telegramCapabilities, TelegramRenderError } from '../src/telegram/render';

const { captionLimit, messageLimit } = telegramCapabilities;

const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  tenant: 'faden-und-stimmung',
  date: '2026-10-23T14:12:00+02:00',
  publishAt: 'now',
  type: 'free',
  photos: ['01.jpg', '02.jpg'],
  channels: ['telegram'],
  versions: { uk: { provenance: 'human' }, de: { provenance: 'ai-assisted' } },
  texts: { uk: 'Привіт!', de: 'Hallo!' },
  ...overrides,
});

const photos = (n: number) => Array.from({ length: n }, (_, i) => `0${i + 1}.jpg`);

describe('renderTelegram: photos', () => {
  it.each([0, 1, 10])('renders %d photos as one album or a single message', (n) => {
    const ops = renderTelegram(makePost({ photos: photos(n) }));
    if (n === 0) {
      expect(ops[0]).toEqual({ kind: 'message', text: 'Привіт!', lang: 'uk' });
    } else {
      expect(ops[0]).toMatchObject({
        kind: 'mediaGroup',
        photoIndexes: photos(n).map((_, i) => i),
      });
    }
    expect(ops).toHaveLength(2); // primary + one secondary language
  });

  it('rejects more than 10 photos', () => {
    expect(() => renderTelegram(makePost({ photos: photos(11) }))).toThrowError(
      TelegramRenderError,
    );
    expect(() => renderTelegram(makePost({ photos: photos(11) }))).toThrowError(/at most 10/);
  });
});

describe('renderTelegram: caption and message limits', () => {
  it(`uses the album caption at exactly ${captionLimit} chars`, () => {
    const ops = renderTelegram(makePost({ texts: { uk: 'x'.repeat(captionLimit), de: 'de' } }));
    expect(ops[0]).toMatchObject({
      kind: 'mediaGroup',
      caption: 'x'.repeat(captionLimit),
      captionLang: 'uk',
    });
    expect(ops).toHaveLength(2);
  });

  it(`sends the primary text as a message at ${captionLimit + 1} chars`, () => {
    const long = 'x'.repeat(captionLimit + 1);
    const ops = renderTelegram(makePost({ texts: { uk: long, de: 'de' } }));
    expect(ops[0]).toMatchObject({ kind: 'mediaGroup', photoIndexes: [0, 1] });
    expect(ops[0]).not.toHaveProperty('caption');
    expect(ops[1]).toEqual({ kind: 'message', text: long, lang: 'uk' });
  });

  it(`accepts a message at exactly ${messageLimit} chars`, () => {
    const ops = renderTelegram(
      makePost({ photos: [], texts: { uk: 'x'.repeat(messageLimit), de: 'de' } }),
    );
    expect(ops[0]).toMatchObject({ kind: 'message', text: 'x'.repeat(messageLimit) });
  });

  it(`rejects a message at ${messageLimit + 1} chars (F9)`, () => {
    const long = 'x'.repeat(messageLimit + 1);
    expect(() =>
      renderTelegram(makePost({ photos: [], texts: { uk: long, de: 'de' } })),
    ).toThrowError(/4096/);
  });

  it(`rejects a ${messageLimit + 1}-char caption overflow message (F9)`, () => {
    const long = 'x'.repeat(messageLimit + 1);
    expect(() => renderTelegram(makePost({ texts: { uk: long, de: 'de' } }))).toThrowError(
      TelegramRenderError,
    );
  });

  it('rejects an over-limit secondary language (F9)', () => {
    const texts = { uk: 'ok', de: 'x'.repeat(messageLimit + 1) };
    expect(() => renderTelegram(makePost({ texts }))).toThrowError(/"de"/);
  });
});

describe('renderTelegram: layout (O1)', () => {
  it('posts secondary languages as text-only replies to the album', () => {
    const ops = renderTelegram(makePost());
    expect(ops).toEqual([
      {
        kind: 'mediaGroup',
        photoIndexes: [0, 1],
        caption: 'Привіт!',
        captionLang: 'uk',
      },
      { kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 },
    ]);
  });

  it('keeps secondary replies pointing at the album when the caption overflows', () => {
    const ops = renderTelegram(
      makePost({ texts: { uk: 'x'.repeat(captionLimit + 1), de: 'Hallo!' } }),
    );
    expect(ops).toHaveLength(3);
    expect(ops[2]).toEqual({ kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 });
  });

  it('replies to the primary message when the post has no photos', () => {
    const ops = renderTelegram(makePost({ photos: [] }));
    expect(ops).toEqual([
      { kind: 'message', text: 'Привіт!', lang: 'uk' },
      { kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 },
    ]);
  });

  it('follows the order of texts in the post for three languages', () => {
    const texts = { uk: 'UA', de: 'DE', en: 'EN' };
    const ops = renderTelegram(makePost({ texts }));
    expect(
      ops.map((op) =>
        op.kind === 'message' ? op.lang : op.kind === 'mediaGroup' ? op.captionLang : op.kind,
      ),
    ).toEqual(['uk', 'de', 'en']);
  });
});

describe('renderTelegram: tenant language order (settings.languages)', () => {
  const settings = { channelId: 'TELEGRAM_CHANNEL_ID', languages: ['uk', 'de'] };

  it('makes the first tenant language primary even when texts are keyed differently', () => {
    const texts = { de: 'Hallo!', uk: 'Привіт!' };
    const ops = renderTelegram(makePost({ texts }), settings);
    expect(ops[0]).toMatchObject({
      kind: 'mediaGroup',
      caption: 'Привіт!',
      captionLang: 'uk',
    });
    expect(ops[1]).toEqual({ kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 });
  });

  it('skips a tenant language that has no text in the post', () => {
    const texts = { uk: 'Привіт!' };
    const ops = renderTelegram(makePost({ texts, photos: [] }), settings);
    expect(ops).toEqual([{ kind: 'message', text: 'Привіт!', lang: 'uk' }]);
  });

  it('appends texts not listed in the tenant languages in file order', () => {
    const texts = { uk: 'UA', de: 'DE', en: 'EN' };
    const ops = renderTelegram(makePost({ texts, photos: [] }), {
      ...settings,
      languages: ['de'],
    });
    expect(
      ops.map((op) =>
        op.kind === 'message' ? op.lang : op.kind === 'mediaGroup' ? op.captionLang : op.kind,
      ),
    ).toEqual(['de', 'uk', 'en']);
  });

  it('keeps file order when settings carry no languages', () => {
    const texts = { de: 'Hallo!', uk: 'Привіт!' };
    const ops = renderTelegram(makePost({ texts }), { channelId: 'TELEGRAM_CHANNEL_ID' });
    expect(ops[0]).toMatchObject({ kind: 'mediaGroup', captionLang: 'de' });
  });

  it('ignores a malformed languages setting and keeps file order', () => {
    const texts = { de: 'Hallo!', uk: 'Привіт!' };
    const ops = renderTelegram(makePost({ texts }), { channelId: 'X', languages: 'uk' });
    expect(ops[0]).toMatchObject({ kind: 'mediaGroup', captionLang: 'de' });
  });
});

describe('renderTelegram: wotw-poll (T21, ADR 008)', () => {
  const { pollMaxOptions, pollQuestionLimit, pollOptionLimit } = telegramCapabilities;

  const poll = { question: 'Яка робота тижня?', options: ['1. Ваза', '2. Шаль'] };
  const pollPost = (overrides: Partial<Post> = {}): Post =>
    makePost({ type: 'wotw-poll', poll, ...overrides });

  it('renders album, then a poll replying to the album, then language replies', () => {
    const ops = renderTelegram(pollPost());
    expect(ops).toEqual([
      {
        kind: 'mediaGroup',
        photoIndexes: [0, 1],
        caption: 'Привіт!',
        captionLang: 'uk',
      },
      { kind: 'poll', question: poll.question, options: poll.options, replyToOp: 0 },
      { kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 },
    ]);
  });

  it('still targets the album when the primary caption overflows into a message', () => {
    const ops = renderTelegram(
      pollPost({ texts: { uk: 'x'.repeat(captionLimit + 1), de: 'Hallo!' } }),
    );
    expect(ops).toHaveLength(4);
    expect(ops[2]).toEqual({
      kind: 'poll',
      question: poll.question,
      options: poll.options,
      replyToOp: 0,
    });
    expect(ops[3]).toEqual({ kind: 'message', text: 'Hallo!', lang: 'de', replyToOp: 0 });
  });

  it('rejects a wotw-poll synthesized without a poll (schema bypass)', () => {
    expect(() => renderTelegram(makePost({ type: 'wotw-poll' }))).toThrowError(TelegramRenderError);
    expect(() => renderTelegram(makePost({ type: 'wotw-poll' }))).toThrowError(/requires a poll/);
  });

  it(`rejects more than ${pollMaxOptions} options`, () => {
    // 11 options cannot pass the post schema (options = photos, album max
    // 10); reach the guard with a schema-bypassed post (0 photos).
    const options = Array.from({ length: pollMaxOptions + 1 }, (_, i) => `${i + 1}.`);
    expect(() =>
      renderTelegram(makePost({ type: 'wotw-poll', photos: [], poll: { question: 'q', options } })),
    ).toThrowError(new RegExp(`at most ${pollMaxOptions}`));
  });

  it(`rejects a question over ${pollQuestionLimit} chars`, () => {
    const long = { question: 'x'.repeat(pollQuestionLimit + 1), options: poll.options };
    expect(() => renderTelegram(pollPost({ poll: long }))).toThrowError(
      new RegExp(`${pollQuestionLimit}`),
    );
  });

  it(`rejects an option over ${pollOptionLimit} chars`, () => {
    const long = {
      question: poll.question,
      options: ['1. ' + 'x'.repeat(pollOptionLimit), '2. ок'],
    };
    expect(() => renderTelegram(pollPost({ poll: long }))).toThrowError(/option limit/);
  });
});

const joinSettings = { joinUrl: 'https://t.me/fixture_channel' };
const joinLine = `Kanal abonnieren: ${joinSettings.joinUrl}`;
describe('subscription footer', () => {
  it('appends once to German only, for posts and work announcements, without mutating input', () => {
    for (const count of [0, 2]) {
      const post = makePost({ photos: photos(count) });
      const before = structuredClone(post);
      const ops = renderTelegram(post, joinSettings);
      expect(ops[0]).toMatchObject(count ? { caption: 'Привіт!' } : { text: 'Привіт!' });
      expect(ops[1]).toMatchObject({ text: `Hallo!\n\n${joinLine}` });
      expect(renderTelegram(post, joinSettings)).toEqual(ops);
      expect(post).toEqual(before);
    }
  });
  it('counts the footer before selecting a caption or rejecting a message', () => {
    const post = makePost({ texts: { de: 'x'.repeat(captionLimit) } });
    expect(renderTelegram(post, joinSettings)[0]).not.toHaveProperty('caption');
    expect(renderTelegram(post, joinSettings)[1]).toMatchObject({
      text: `${post.texts.de}\n\n${joinLine}`,
    });
    const maxBody = messageLimit - joinLine.length - 2;
    expect(
      renderTelegram(makePost({ photos: [], texts: { de: 'x'.repeat(maxBody) } }), joinSettings)[0],
    ).toMatchObject({ text: `${'x'.repeat(maxBody)}\n\n${joinLine}` });
    expect(() =>
      renderTelegram(makePost({ texts: { de: 'x'.repeat(maxBody + 1) } }), joinSettings),
    ).toThrow(/message limit/);
  });
  it('leaves operations unchanged without the optional setting', () => {
    expect(renderTelegram(makePost(), {})).toEqual(renderTelegram(makePost()));
  });
});

const canonicalSettings = {
  canonical: {
    links: true,
    baseUrl: 'https://fadenundstimmung.de',
    defaultLanguage: 'de',
    section: 'posts',
  },
};
const deCanonicalLine =
  'Mehr auf der Website: https://fadenundstimmung.de/posts/01jbca1b2c3d4e5f6g7h8j9k0m/';
const ukCanonicalLine =
  'Більше на сайті: https://fadenundstimmung.de/uk/posts/01jbca1b2c3d4e5f6g7h8j9k0m/';

describe('canonical footer (T40, F31)', () => {
  it('appends the per-language line to a free post, linking to its site page', () => {
    const ops = renderTelegram(makePost(), canonicalSettings);
    expect(ops[0]).toMatchObject({ caption: `Привіт!\n\n${ukCanonicalLine}` });
    expect(ops[1]).toMatchObject({ text: `Hallo!\n\n${deCanonicalLine}` });
    expect(renderTelegram(makePost(), canonicalSettings)).toEqual(ops);
  });

  it('puts the canonical line first in the shared footer, then the join line', () => {
    const settings = { joinUrl: 'https://t.me/fixture_channel', ...canonicalSettings };
    const ops = renderTelegram(makePost({ photos: [] }), settings);
    expect(ops[1]).toMatchObject({
      text: `Hallo!\n\n${deCanonicalLine}\nKanal abonnieren: https://t.me/fixture_channel`,
    });
  });

  it('links a work announcement to the work page', () => {
    const settings = {
      canonical: { ...canonicalSettings.canonical, section: 'works' as const },
    };
    const ops = renderTelegram(makePost({ photos: [] }), settings);
    expect(ops[0]).toMatchObject({
      text: 'Привіт!\n\nБільше на сайті: https://fadenundstimmung.de/uk/works/01jbca1b2c3d4e5f6g7h8j9k0m/',
    });
    expect(ops[1]).toMatchObject({
      text: 'Hallo!\n\nMehr auf der Website: https://fadenundstimmung.de/works/01jbca1b2c3d4e5f6g7h8j9k0m/',
    });
  });

  it.each(['announcement', 'reminder', 'wotw-poll', 'wotw-result'] as const)(
    'omits the line for %s posts (no site page exists)',
    (type) => {
      const post = makePost({
        type,
        photos: [],
        texts: { uk: 'Привіт!', de: 'Hallo!' },
        ...(type === 'wotw-poll' ? { poll: { question: 'q', options: ['a', 'b'] } } : {}),
      });
      const ops = renderTelegram(post, canonicalSettings);
      for (const op of ops) {
        if (op.kind === 'mediaGroup') expect(op.caption ?? '').not.toContain('fadenundstimmung.de');
        if (op.kind === 'message') expect(op.text).not.toContain('fadenundstimmung.de');
      }
    },
  );

  it('omits the line for site-excluded posts (the page never exists)', () => {
    const ops = renderTelegram(makePost({ siteExcluded: true, photos: [] }), canonicalSettings);
    expect(ops[0]).toMatchObject({ text: 'Привіт!' });
    expect(ops[1]).toMatchObject({ text: 'Hallo!' });
  });

  it('leaves operations unchanged when the flag is off or canonical is absent', () => {
    const post = makePost();
    const plain = renderTelegram(post);
    expect(
      renderTelegram(post, { canonical: { ...canonicalSettings.canonical, links: false } }),
    ).toEqual(plain);
    expect(renderTelegram(post, {})).toEqual(plain);
  });

  it('rejects an unsupported footer language', () => {
    const post = makePost({
      texts: { fr: 'Bonjour !' },
      versions: { fr: { provenance: 'human' } },
    });
    expect(() => renderTelegram(post, canonicalSettings)).toThrow(
      /unsupported canonical footer language/,
    );
  });

  it.each(['http://insecure.example', 'https://fadenundstimmung.de/sub', 'not-a-url'])(
    'rejects a non-origin baseUrl (%s)',
    (baseUrl) => {
      expect(() =>
        renderTelegram(makePost(), { canonical: { ...canonicalSettings.canonical, baseUrl } }),
      ).toThrow(/https origin/);
    },
  );

  it('counts the footer before selecting a caption or rejecting a message', () => {
    const fits = captionLimit - ukCanonicalLine.length;
    const ops = renderTelegram(
      makePost({ texts: { uk: 'x'.repeat(fits), de: 'de' } }),
      canonicalSettings,
    );
    expect(ops[0]).not.toHaveProperty('caption');
    expect(ops[1]).toMatchObject({ text: `${'x'.repeat(fits)}\n\n${ukCanonicalLine}` });

    const maxBody = messageLimit - deCanonicalLine.length - 2;
    expect(
      renderTelegram(
        makePost({ photos: [], texts: { uk: 'Привіт!', de: 'x'.repeat(maxBody) } }),
        canonicalSettings,
      )[1],
    ).toMatchObject({ text: `${'x'.repeat(maxBody)}\n\n${deCanonicalLine}` });
    expect(() =>
      renderTelegram(
        makePost({ photos: [], texts: { uk: 'Привіт!', de: 'x'.repeat(maxBody + 1) } }),
        canonicalSettings,
      ),
    ).toThrow(/message limit/);
  });
});

it('keeps edit-plan poll language equal to post resolution when tenant language order differs', async () => {
  const { anonymousEditPlanSchema, resolveEditPlan, resolvePostEntryNames } =
    await import('@handmake/core');
  const id = '01JBCA1B2C3D4E5F6G7H8J9K0N';
  const post = makePost({
    type: 'wotw-poll',
    texts: { uk: `{entry:${id}}`, de: `{entry:${id}}` },
    poll: { question: `{entry:${id}}`, options: [`{entry:${id}}`, '2'] },
  });
  const settings = { channelId: 'CHANNEL', languages: ['de', 'uk'] };
  const plan = anonymousEditPlanSchema.parse({
    version: 1,
    type: post.type,
    entryRefs: [id],
    allowNames: true,
    pollLanguage: Object.keys(post.texts)[0],
    settings,
    operations: renderTelegram(post, settings),
  });
  for (const names of [{}, { [id]: 'Private fixture' }] as EntryNames[]) {
    expect(resolveEditPlan(plan, names)).toEqual(
      renderTelegram(resolvePostEntryNames(post, names, true), settings),
    );
  }
  expect(resolveEditPlan(plan, {}).find((op) => op.kind === 'poll')).toMatchObject({
    question: 'Робота № 1',
  });
});
