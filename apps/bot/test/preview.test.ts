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
