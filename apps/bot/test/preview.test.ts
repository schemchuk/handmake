import { createDraft } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { buildPreview } from '../src/preview';
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
