import type { ChannelCapabilities, Post, SendOperation } from '@handmake/core';

/**
 * Pure part of the Telegram ChannelAdapter (T05): turns a post into the
 * ordered list of send operations. The bot preview and the publisher both
 * call this exact function, so the preview is what gets posted.
 *
 * Layout (O1, ADR in architecture 10): the primary language (first text in
 * the post) gets the photo album; further languages are text-only messages
 * replying to the album. Plain text, no parse mode in the MVP.
 */

export const telegramCapabilities: ChannelCapabilities = {
  maxPhotos: 10,
  captionLimit: 1024,
  messageLimit: 4096,
  polls: true,
};

export class TelegramRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramRenderError';
  }
}

export function renderTelegram(post: Post, _settings?: unknown): SendOperation[] {
  const { maxPhotos, captionLimit, messageLimit } = telegramCapabilities;
  // Post texts are validated non-empty by the post schema (T03).
  const [primaryLang, ...otherLangs] = Object.keys(post.texts) as [string, ...string[]];

  if (post.photos.length > maxPhotos) {
    throw new TelegramRenderError(
      `Telegram allows at most ${maxPhotos} photos per album; post has ${post.photos.length}`,
    );
  }

  const ops: SendOperation[] = [];
  const primaryText = post.texts[primaryLang]!;

  const checkLimit = (lang: string, text: string) => {
    if (text.length > messageLimit) {
      throw new TelegramRenderError(
        `Telegram message limit is ${messageLimit} chars; text for "${lang}" has ${text.length} (F9)`,
      );
    }
  };

  const photoIndexes = post.photos.map((_, i) => i);

  if (photoIndexes.length === 0) {
    checkLimit(primaryLang, primaryText);
    ops.push({ kind: 'message', text: primaryText, lang: primaryLang });
  } else if (primaryText.length <= captionLimit) {
    ops.push({
      kind: 'mediaGroup',
      photoIndexes,
      caption: primaryText,
      captionLang: primaryLang,
    });
  } else {
    checkLimit(primaryLang, primaryText);
    ops.push({ kind: 'mediaGroup', photoIndexes });
    ops.push({ kind: 'message', text: primaryText, lang: primaryLang });
  }

  // Further languages reply to the album (op 0), even if the primary text
  // overflowed into a separate message.
  for (const lang of otherLangs) {
    const text = post.texts[lang]!;
    checkLimit(lang, text);
    ops.push({ kind: 'message', text, lang, replyToOp: 0 });
  }

  return ops;
}
