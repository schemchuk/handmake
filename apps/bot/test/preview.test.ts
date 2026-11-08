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
      texts: { uk: 'Привіт', de: 'x'.repeat(4096) },
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
    texts: { uk: 'Привіт', de: 'x'.repeat(4096) },
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
    texts: { uk: 'Привіт', de: 'x'.repeat(4096) },
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
    expect(preview.text).toContain('39/2200');
    expect(preview.text).toContain('«Neue bestickte Tasche aus der Werkstatt»');
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
    expect(windowLine).toContain('«Neue bestickte Tasche aus der Werkstatt»');
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
