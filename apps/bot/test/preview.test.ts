import { createDraft } from '@handmake/core';
import { describe, expect, it, vi } from 'vitest';

import { buildPreview, buildTenantPreview } from '../src/preview';
import { botTexts } from '../src/texts';

const now = new Date('2026-11-05T10:00:00Z');

describe('Telegram preview subscription footer', () => {
  it('blocks publication when only the footer exceeds the message limit', () => {
    const draft = {
      ...createDraft('tenant', 'draft', now),
      state: 'ready' as const,
      texts: { uk: 'Привіт', de: 'x'.repeat(4096 - '\n\nOriginalarbeit'.length) },
      photoRefs: ['photo'],
    };
    const without = buildPreview(draft, botTexts, now);
    const withFooter = buildPreview(draft, botTexts, now, {
      channelId: 'CHANNEL',
      joinUrl: 'https://t.me/channel',
    });
    const actions = (preview: typeof without) =>
      preview.keyboard!.inline_keyboard.flat().map((b) => b.callback_data);
    expect(actions(without)).toContain('draft:draft:publish');
    expect(actions(withFooter)).not.toContain('draft:draft:publish');
    expect(withFooter.text).toContain('4096');
  });
});

describe('Telegram preview canonical footer (T40)', () => {
  const draft = {
    ...createDraft('tenant', 'draft', now),
    state: 'ready' as const,
    texts: { uk: 'Привіт', de: 'x'.repeat(4096 - '\n\nOriginalarbeit'.length) },
    photoRefs: ['photo'],
  };
  const actions = (preview: {
    keyboard?: { inline_keyboard: { callback_data: string }[][] };
  }): string[] => preview.keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];

  it('blocks publication when only the canonical footer exceeds the message limit', () => {
    const without = buildPreview(draft, botTexts, now);
    const withCanonical = buildPreview(draft, botTexts, now, {
      channelId: 'CHANNEL',
      canonical: {
        links: true,
        baseUrl: 'https://fadenundstimmung.de',
        defaultLanguage: 'de',
        section: 'posts',
      },
    });
    expect(actions(without)).toContain('draft:draft:publish');
    expect(actions(withCanonical)).not.toContain('draft:draft:publish');
    expect(withCanonical.text).toContain('4096');
  });

  it('derives the footer from the tenant config flag', async () => {
    const config = (canonicalLinks: boolean) =>
      ({
        id: 'tenant',
        languages: ['uk', 'de'],
        channels: { telegram: { channelId: 'CHANNEL' } },
        featureFlags: { canonicalLinks },
        site: { baseUrl: 'https://fadenundstimmung.de', defaultLanguage: 'de' },
      }) as never;

    const on = await buildTenantPreview(draft, botTexts, { load: async () => config(true) });
    expect(actions(on)).not.toContain('draft:draft:publish');

    const off = await buildTenantPreview(draft, botTexts, { load: async () => config(false) });
    expect(actions(off)).toContain('draft:draft:publish');
  });
});

describe('tenant preview settings', () => {
  const draft = {
    ...createDraft('tenant', 'draft', now),
    state: 'ready' as const,
    texts: { uk: 'Привіт', de: 'x'.repeat(4096 - '\n\nOriginalarbeit'.length) },
    photoRefs: ['photo'],
  };

  it('falls back on a cold config fetch failure with a sanitized warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const preview = await buildTenantPreview(draft, botTexts, {
        load: async () => {
          throw new Error('private transport details');
        },
      });
      expect(
        preview.keyboard!.inline_keyboard.flat().some((b) => b.callback_data.endsWith(':publish')),
      ).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        'Preview tenant config unavailable; using default settings',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('validates the configured primary language as the album caption', async () => {
    const preview = await buildTenantPreview(
      { ...draft, texts: { uk: 'Привіт', de: 'x'.repeat(1500) } },
      botTexts,
      {
        load: async () =>
          ({
            id: 'tenant',
            languages: ['de', 'uk'],
            channels: { telegram: { channelId: 'CHANNEL', joinUrl: 'https://t.me/channel' } },
            featureFlags: {},
          }) as never,
      },
    );
    // German is the primary caption and must be split off the album.
    expect(preview.text).toContain(botTexts.previewCaptionSplitNote);
    expect(
      preview.keyboard!.inline_keyboard.flat().some((b) => b.callback_data.endsWith(':publish')),
    ).toBe(true);
  });
});

describe('Instagram preview section (T26a1, F33)', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const draft = (overrides: Record<string, unknown> = {}) => ({
    ...createDraft('tenant', 'draft', now),
    state: 'ready' as const,
    texts: { uk: 'Привіт!', de: 'Neue bestickte Tasche aus der Werkstatt' },
    photoRefs: ['photo'],
    ...overrides,
  });
  const actions = (preview: { keyboard?: { inline_keyboard: { callback_data: string }[][] } }) =>
    preview.keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];

  it('shows the caption window and the length against the 2200 limit', () => {
    const preview = buildPreview(draft(), botTexts, now, undefined, { language: 'de' });
    expect(preview.text).toContain('📸 Instagram (DE,');
    expect(preview.text).toContain('55/2200');
    expect(preview.text).toContain('«Neue bestickte Tasche aus der Werkstatt\n\nOriginalarbeit»');
    expect(actions(preview)).toContain('draft:draft:publish');
  });

  it('truncates the shown window at ~125 characters', () => {
    const longDe = 'Wort '.repeat(40); // 200 chars
    const preview = buildPreview(
      draft({ texts: { uk: 'x', de: longDe } }),
      botTexts,
      now,
      undefined,
      { language: 'de' },
    );
    const windowLine = preview.text.split('\n').find((line) => line.startsWith('видно без'));
    expect(windowLine).toBe(`видно без «ще»: «${longDe.slice(0, 125)}»`);
  });

  it('slices the window by code points, never splitting an emoji (PR #93)', () => {
    // 124 BMP chars + an astral emoji at the window edge + a tail.
    const de = `${'x'.repeat(124)}🧶 tail`;
    const preview = buildPreview(draft({ texts: { uk: 'x', de } }), botTexts, now, undefined, {
      language: 'de',
    });
    const windowLine = preview.text.split('\n').find((line) => line.startsWith('видно без'));
    expect(windowLine).toBe(`видно без «ще»: «${'x'.repeat(124)}🧶»`);
  });

  it('blocks publishing when the caption exceeds 2200 characters', () => {
    const preview = buildPreview(
      draft({ texts: { uk: 'x', de: 'x'.repeat(2201) } }),
      botTexts,
      now,
      undefined,
      { language: 'de' },
    );
    expect(actions(preview)).not.toContain('draft:draft:publish');
    expect(preview.text).toContain('2200');
  });

  it('blocks publishing on more than 5 hashtags', () => {
    const preview = buildPreview(
      draft({ texts: { uk: 'x', de: 'Nachricht\n#a #b #c #d #e #f' } }),
      botTexts,
      now,
      undefined,
      { language: 'de' },
    );
    expect(actions(preview)).not.toContain('draft:draft:publish');
    expect(preview.text).toContain('hashtags');
  });

  it('notes that a text-only post is skipped for Instagram', () => {
    const preview = buildPreview(draft({ photoRefs: [] }), botTexts, now, undefined, {
      language: 'de',
    });
    expect(preview.text).toContain('без фото');
    expect(preview.text).not.toContain('📸 Instagram (DE');
    expect(actions(preview)).toContain('draft:draft:publish');
  });

  it('notes that a non-site post is skipped for Instagram', () => {
    const preview = buildPreview(draft({ type: 'announcement' }), botTexts, now, undefined, {
      language: 'de',
    });
    expect(preview.text).toContain('лише дописи для сайту');
  });

  it('renders the Instagram section from the tenant config without a link', async () => {
    const preview = await buildTenantPreview(draft(), botTexts, {
      load: async () =>
        ({
          id: 'tenant',
          languages: ['uk', 'de'],
          channels: { telegram: { channelId: 'CHANNEL' }, instagram: { language: 'de' } },
          featureFlags: { canonicalLinks: true },
          site: { baseUrl: 'https://fadenundstimmung.de', defaultLanguage: 'de' },
        }) as never,
    });
    expect(preview.text).toContain('📸 Instagram (DE,');
    // Instagram captions carry no link (ported rule); the window is the
    // caption start, and the canonical flag must not smuggle a URL in.
    const windowLine = preview.text.split('\n').find((line) => line.startsWith('видно без'));
    expect(windowLine).not.toContain('http');
    expect(windowLine).toContain('«Neue bestickte Tasche aus der Werkstatt');
    expect(preview.text).toContain('\n\nOriginalarbeit»');
  });

  it('keeps the preview unchanged without Instagram settings', () => {
    const preview = buildPreview(draft(), botTexts, now);
    expect(preview.text).not.toContain('📸 Instagram');
  });

  it('never judges a work that does not announce on Instagram (B1)', () => {
    const workDraft = {
      ...createDraft('tenant', '01JBCA1B2C3D4E5F6G7H8J9K0M', now, { kind: 'work' }),
      state: 'ready' as const,
      texts: { uk: 'Опис', de: 'Nachricht\n#a #b #c #d #e #f' },
      photoRefs: ['photo'],
      extras: {
        work: {
          config: { kind: 'worn', collection: 'fixture', channels: ['telegram'] },
          generated: {
            uk: { description: 'Опис', provenance: 'ai-assisted', model: 'm', prompt: 'p@1' },
            de: {
              description: 'Nachricht\n#a #b #c #d #e #f',
              provenance: 'ai-assisted',
              model: 'm',
              prompt: 'p@1',
            },
          },
        },
      },
    };
    const preview = buildPreview(workDraft, botTexts, now, undefined, { language: 'de' });
    // Telegram-only work: the Instagram rules must not block publishing.
    expect(actions(preview)).toContain('draft:01JBCA1B2C3D4E5F6G7H8J9K0M:publish');
    expect(preview.text).not.toContain('📸 Instagram');
  });

  it('names the exact Instagram rule for a work that announces on it (B2)', () => {
    const workDraft = {
      ...createDraft('tenant', '01JBCA1B2C3D4E5F6G7H8J9K0M', now, { kind: 'work' }),
      state: 'ready' as const,
      texts: { uk: 'Опис', de: 'Nachricht\n#a #b #c #d #e #f' },
      photoRefs: ['photo'],
      extras: {
        work: {
          config: { kind: 'worn', collection: 'fixture', channels: ['telegram', 'instagram'] },
          generated: {
            uk: { description: 'Опис', provenance: 'ai-assisted', model: 'm', prompt: 'p@1' },
            de: {
              description: 'Nachricht\n#a #b #c #d #e #f',
              provenance: 'ai-assisted',
              model: 'm',
              prompt: 'p@1',
            },
          },
        },
      },
    };
    const preview = buildPreview(workDraft, botTexts, now, undefined, { language: 'de' });
    expect(actions(preview)).not.toContain('draft:01JBCA1B2C3D4E5F6G7H8J9K0M:publish');
    expect(preview.text).toContain('at most 5 hashtags');
    expect(preview.text).not.toContain(botTexts.workSetupText);
  });

  it('skips the Instagram section quietly when the caption language has no text (B4)', () => {
    const preview = buildPreview(draft({ texts: { uk: 'Привіт!' } }), botTexts, now, undefined, {
      language: 'de',
    });
    expect(actions(preview)).toContain('draft:draft:publish');
    expect(preview.text).toContain(botTexts.previewDeMissing);
    expect(preview.text).not.toContain('has no text');
    expect(preview.text).not.toContain('📸 Instagram');
  });
});

describe('Facebook preview section (T26b, F33)', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const draft = (overrides: Record<string, unknown> = {}) => ({
    ...createDraft('tenant', 'draft', now),
    state: 'ready' as const,
    texts: { uk: 'Привіт!', de: 'Neue bestickte Tasche aus der Werkstatt' },
    photoRefs: ['photo'],
    ...overrides,
  });
  const canonical = {
    links: true as const,
    baseUrl: 'https://fadenundstimmung.de',
    defaultLanguage: 'de',
    section: 'posts' as const,
  };

  it('shows the caption length and the clickable canonical link line', () => {
    const preview = buildPreview(draft(), botTexts, now, undefined, undefined, {
      language: 'de',
      canonical,
    });
    expect(preview.text).toContain('📘 Facebook (DE,');
    expect(preview.text).toContain(
      'посилання в підписі (клікабельне): https://fadenundstimmung.de/posts/draft/',
    );
  });

  it('shows no link line when the canonical footer is off', () => {
    const preview = buildPreview(draft(), botTexts, now, undefined, undefined, { language: 'de' });
    expect(preview.text).toContain('📘 Facebook (DE,');
    expect(preview.text).not.toContain('посилання в підписі');
  });

  it.each([
    ['no photos', { photoRefs: [] }, false, 'без фото дописи не приймає'],
    ['a non-site post', { type: 'announcement' }, false, 'туди йдуть лише дописи для сайту'],
    ['a site-excluded test post', {}, true, 'тестовий допис у Facebook не піде'],
  ])('notes that %s is skipped for Facebook', (_name, overrides, siteExcluded, fragment) => {
    const preview = buildPreview(
      draft(overrides),
      botTexts,
      now,
      undefined,
      undefined,
      { language: 'de', canonical },
      siteExcluded,
    );
    expect(preview.text).toContain(`📘 Facebook: ${fragment}`);
    expect(preview.text).not.toContain('📘 Facebook (DE,');
  });

  it('keeps the preview unchanged without Facebook settings', () => {
    const preview = buildPreview(draft(), botTexts, now);
    expect(preview.text).not.toContain('📘 Facebook');
  });
});

describe('preview projects a test publish (B3, PR #89 note 2)', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const config = {
    load: async () =>
      ({
        id: 'tenant',
        languages: ['uk', 'de'],
        channels: { telegram: { channelId: 'CHANNEL' }, instagram: { language: 'de' } },
        featureFlags: { canonicalLinks: true },
        site: { baseUrl: 'https://fadenundstimmung.de', defaultLanguage: 'de' },
      }) as never,
  };
  const actions = (preview: { keyboard?: { inline_keyboard: { callback_data: string }[][] } }) =>
    preview.keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];

  it('live: shows the Instagram caption window', async () => {
    const draft = {
      ...createDraft('tenant', 'draft', now),
      state: 'ready' as const,
      texts: { uk: 'Привіт!', de: 'Neue bestickte Tasche aus der Werkstatt' },
      photoRefs: ['photo'],
    };
    const preview = await buildTenantPreview(draft, botTexts, config, true);
    expect(preview.text).toContain('📸 Instagram (DE,');
  });

  it('test (PUBLISH_LIVE off): the Instagram copy is announced as skipped', async () => {
    const draft = {
      ...createDraft('tenant', 'draft', now),
      state: 'ready' as const,
      texts: { uk: 'Привіт!', de: 'Neue bestickte Tasche aus der Werkstatt' },
      photoRefs: ['photo'],
    };
    const preview = await buildTenantPreview(draft, botTexts, config, false);
    expect(preview.text).toContain('тестовий допис');
    expect(preview.text).not.toContain('📸 Instagram (DE');
  });

  it('a DE text that only the live canonical footer overflows blocks live, not test', async () => {
    // 4033 + the 64-char canonical footer = 4097 (over the Telegram limit);
    // without the footer (test publish) it fits.
    const draft = {
      ...createDraft('tenant', 'draft', now),
      state: 'ready' as const,
      texts: { uk: 'Привіт!', de: 'x'.repeat(4033) },
      photoRefs: ['photo'],
    };
    const live = await buildTenantPreview(draft, botTexts, config, true);
    expect(actions(live)).not.toContain('draft:draft:publish');
    expect(live.text).toContain('4096');

    const test = await buildTenantPreview(draft, botTexts, config, false);
    expect(actions(test)).toContain('draft:draft:publish');
    expect(test.text).not.toContain('❌');
  });
});

describe('Threads author preview (T26c)', () => {
  const draft = {
    ...createDraft('tenant', 'draft', now),
    state: 'ready' as const,
    texts: { uk: 'Привіт', de: 'Handarbeit 🧵' },
    photoRefs: ['photo'],
  };
  const preview = (de: string, siteExcluded = false) =>
    buildPreview(
      { ...draft, texts: { ...draft.texts, de } },
      botTexts,
      now,
      undefined,
      undefined,
      undefined,
      siteExcluded,
      {
        language: 'de',
        canonical: {
          links: true,
          baseUrl: 'https://craft.example',
          defaultLanguage: 'de',
          section: 'posts',
        },
      },
    );
  it('shows the exact text, UTF-8 budget and canonical link', () => {
    const result = preview(draft.texts.de);
    expect(result.text).toContain('🧵 Threads (');
    expect(result.text).toContain('/500 одиниць тексту; умлаути й емодзі займають кілька одиниць)');
    expect(result.text).toContain('https://craft.example/posts/draft/');
    expect(
      result.keyboard?.inline_keyboard.flat().some((b) => b.callback_data.endsWith(':publish')),
    ).toBe(true);
  });
  it('blocks approval when text plus canonical URL exceeds 500', () => {
    const result = preview('x'.repeat(490));
    expect(result.text).toContain('Threads text');
    expect(
      result.keyboard?.inline_keyboard.flat().some((b) => b.callback_data.endsWith(':publish')),
    ).toBe(false);
  });
  it('skips Threads limits for test publications', () => {
    const result = preview('x'.repeat(501), true);
    expect(result.text).toContain(botTexts.previewThreadsSkip);
    expect(
      result.keyboard?.inline_keyboard.flat().some((b) => b.callback_data.endsWith(':publish')),
    ).toBe(true);
  });
  it('loads Threads settings for a tenant and omits its block when disabled', async () => {
    const config = {
      id: 'tenant',
      languages: ['uk', 'de'],
      channels: { threads: { language: 'de' } },
      featureFlags: { canonicalLinks: true },
      site: { baseUrl: 'https://craft.example', defaultLanguage: 'de' },
    };
    const result = await buildTenantPreview(draft, botTexts, { load: async () => config as never });
    expect(result.text).toContain('https://craft.example/posts/draft/');
    expect((await buildTenantPreview(draft, botTexts)).text).not.toContain('🧵 Threads');
  });
});

it('resolves preview names directly, keeps the draft immutable and anonymizes Meta projections', async () => {
  const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
  const draft = {
    ...createDraft('tenant', 'draft', now),
    state: 'ready' as const,
    texts: { uk: `{entry:${id}}`, de: `{entry:${id}}` },
    photoRefs: ['photo'],
  };
  const lookup = vi.fn(async () => ({ [id]: 'Private fixture' }));
  const preview = await buildTenantPreview(
    draft,
    botTexts,
    {
      load: async () =>
        ({
          id: 'tenant',
          languages: ['uk', 'de'],
          channels: { telegram: { channelId: 'CHANNEL' }, threads: { language: 'de' } },
          entryNamePolicy: { telegram: true },
          featureFlags: {},
        }) as never,
    },
    true,
    lookup,
  );
  expect(lookup).toHaveBeenCalledWith('tenant', [id]);
  expect(preview.text).toContain('Private fixture');
  expect(preview.text).toContain('Werk Nr. 1');
  expect(draft.texts.uk).toBe(`{entry:${id}}`);
  await expect(buildTenantPreview(draft, botTexts)).rejects.toThrow('Contest names unavailable');
});

it.each(['{entry', '{entry:bad}', '{Entry:bad}'])(
  'offers editing instead of throwing for a malformed entry token: %s',
  async (text) => {
    const draft = {
      ...createDraft('tenant', 'draft', now),
      state: 'ready' as const,
      texts: { uk: text },
    };
    const lookup = vi.fn();
    const preview = await buildTenantPreview(draft, botTexts, undefined, true, lookup);
    expect(preview.text).toContain(botTexts.previewInvalidEntryText);
    const actions = preview.keyboard!.inline_keyboard.flat().map((b) => b.callback_data);
    expect(actions).toContain('draft:draft:edit:uk');
    expect(actions).toContain('draft:draft:discard');
    expect(actions).not.toContain('draft:draft:publish');
    expect(lookup).not.toHaveBeenCalled();
    expect(buildPreview(draft, botTexts).text).toContain(botTexts.previewInvalidEntryText);
  },
);

it('previews both authenticity labels and blocks captions that only exceed the limit after labelling', () => {
  const draft = {
    ...createDraft('tenant', 'draft', now),
    state: 'ready' as const,
    texts: { uk: 'Ручна робота', de: 'Handarbeit' },
    photoRefs: ['photo'],
  };
  const preview = buildPreview(draft, botTexts, now);
  expect(preview.text).toContain('Ручна робота\n\nОригінальна робота');
  expect(preview.text).toContain('Handarbeit\n\nOriginalarbeit');
  const plain = buildPreview({ ...draft, photoRefs: [] }, botTexts, now);
  expect(plain.text).not.toContain('Оригінальна робота');
  expect(plain.text).not.toContain('Originalarbeit');
  const blocked = buildPreview(
    { ...draft, texts: { uk: 'Робота', de: 'x'.repeat(4096) } },
    botTexts,
    now,
  );
  expect(blocked.keyboard!.inline_keyboard.flat().map((b) => b.callback_data)).not.toContain(
    'draft:draft:publish',
  );
});
