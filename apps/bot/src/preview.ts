import { renderTelegram, TelegramRenderError, telegramCapabilities } from '@handmake/channels';
import type { Draft, Post } from '@handmake/core';

import type { BotTexts } from './texts';

/**
 * The author preview (T15): renders the draft through the very same
 * `renderTelegram` the publisher uses, so what she approves is what gets
 * posted. Telegram limits therefore surface here as a blocked state: the
 * Publish button is simply absent and the problem is explained in text.
 */

export interface PreviewKeyboardButton {
  text: string;
  callback_data: string;
}

export interface PreviewMessage {
  text: string;
  /** Inline keyboard; undefined only when nothing can be done (no draft). */
  keyboard: { inline_keyboard: PreviewKeyboardButton[][] } | undefined;
}

/** Display cap per language version: a preview message must itself fit the
 * 4096-char Telegram limit even with both versions and headers inside. */
const previewTextChars = 900;

function truncate(text: string, texts: BotTexts): string {
  if (text.length <= previewTextChars) {
    return text;
  }
  return text.slice(0, previewTextChars) + texts.previewTruncatedNote;
}

/**
 * Synthesizes the Post the publisher would receive from this draft. Key order
 * of `texts` is uk-then-de: without channel settings, renderTelegram takes the
 * language order from the record, and Ukrainian must stay the primary
 * (album-caption) language. The draft id doubles as the post id — only the
 * render result matters for the preview.
 */
function draftAsPost(draft: Draft, now: Date): Post {
  const texts: Record<string, string> = {};
  if (draft.texts['uk'] !== undefined) texts['uk'] = draft.texts['uk'];
  if (draft.texts['de'] !== undefined) texts['de'] = draft.texts['de'];
  return {
    id: draft.draftId,
    tenant: draft.tenantId,
    date: now.toISOString(),
    publishAt: 'now',
    type: 'free',
    photos: draft.photoRefs,
    channels: ['telegram'],
    versions: {
      uk: { provenance: 'human' },
      ...(texts['de'] !== undefined ? { de: { provenance: 'ai-assisted' as const } } : {}),
    },
    texts,
  };
}

function keyboard(texts: BotTexts, blocked: boolean): PreviewKeyboardButton[][] {
  const rows: PreviewKeyboardButton[][] = [
    [
      { text: texts.editUkButton, callback_data: 'draft:edit:uk' },
      { text: texts.editDeButton, callback_data: 'draft:edit:de' },
      { text: texts.regenDeButton, callback_data: 'draft:regen-de' },
    ],
  ];
  const second: PreviewKeyboardButton[] = [];
  if (!blocked) {
    second.push({ text: texts.publishButton, callback_data: 'draft:publish' });
  }
  second.push({ text: texts.discardButton, callback_data: 'draft:discard' });
  rows.push(second);
  return rows;
}

export function buildPreview(draft: Draft, texts: BotTexts, now = new Date()): PreviewMessage {
  const post = draftAsPost(draft, now);
  const uk = draft.texts['uk'];
  const de = draft.texts['de'];

  let blockedError: string | undefined;
  try {
    renderTelegram(post);
  } catch (error) {
    if (!(error instanceof TelegramRenderError)) {
      throw error;
    }
    blockedError = error.message;
  }

  const lines: string[] = [texts.previewHeader(draft.photoRefs.length), ''];
  if (blockedError !== undefined) {
    lines.push(texts.previewBlockedText(blockedError));
    lines.push('');
  }

  const ukText = uk ?? '';
  lines.push(texts.previewUkLabel(ukText.length));
  lines.push(truncate(ukText, texts) || '—');

  lines.push('');
  if (de !== undefined) {
    lines.push(texts.previewDeLabel(de.length));
    lines.push(truncate(de, texts));
  } else {
    lines.push(texts.previewDeMissing);
  }

  // Not a blocker: renderTelegram splits a >1024 caption into an album plus
  // a separate message, but the author should know that layout in advance.
  if (
    blockedError === undefined &&
    draft.photoRefs.length > 0 &&
    uk !== undefined &&
    uk.length > telegramCapabilities.captionLimit
  ) {
    lines.push('');
    lines.push(texts.previewCaptionSplitNote);
  }

  return {
    text: lines.join('\n'),
    keyboard: { inline_keyboard: keyboard(texts, blockedError !== undefined) },
  };
}
