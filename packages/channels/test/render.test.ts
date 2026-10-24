import type { Post } from '@handmake/core';
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
    expect(ops.map((op) => (op.kind === 'message' ? op.lang : op.captionLang))).toEqual([
      'uk',
      'de',
      'en',
    ]);
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
    expect(ops.map((op) => (op.kind === 'message' ? op.lang : op.captionLang))).toEqual([
      'de',
      'uk',
      'en',
    ]);
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
