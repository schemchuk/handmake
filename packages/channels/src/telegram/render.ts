import type { ChannelCapabilities, Post, SendOperation } from '@handmake/core';

/**
 * Pure part of the Telegram ChannelAdapter (T05): turns a post into the
 * ordered list of send operations. The bot preview and the publisher both
 * call this exact function, so the preview is what gets posted.
 *
 * Layout (O1, ADR in architecture 10): the primary language gets the photo
 * album; further languages are text-only messages replying to the album.
 * The primary language is the first entry of the tenant's `languages` list
 * (passed via settings) that actually has a text in the post; any remaining
 * post texts follow in file order. Without settings the order of
 * `post.texts` keys is used. Plain text, no parse mode in the MVP.
 */

/** Per-channel settings of the tenant config (`channels.telegram`). */
export interface TelegramChannelSettings {
  /** Secret NAME resolving to the target chat id; never a raw value. */
  channelId: string;
  /** Tenant language order; the first language present in the post is primary. */
  languages?: string[];
}

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

/** Lenient read of `settings.languages`: only a string array is honoured. */
function readLanguages(settings: unknown): string[] | undefined {
  if (typeof settings !== 'object' || settings === null) return undefined;
  const languages = (settings as { languages?: unknown }).languages;
  if (!Array.isArray(languages) || languages.some((l) => typeof l !== 'string')) {
    return undefined;
  }
  return languages;
}

/**
 * Language order: the tenant's `languages` filtered to languages present in
 * the post, then any remaining post texts in file order. First element is
 * the primary language (gets the album).
 */
function orderLanguages(post: Post, settings?: unknown): string[] {
  const fileOrder = Object.keys(post.texts);
  const languages = readLanguages(settings);
  if (!languages) return fileOrder;
  const present = new Set(fileOrder);
  const ordered = languages.filter((lang) => present.has(lang));
  const rest = fileOrder.filter((lang) => !languages.includes(lang));
  return [...ordered, ...rest];
}

export function renderTelegram(post: Post, settings?: unknown): SendOperation[] {
  const { maxPhotos, captionLimit, messageLimit } = telegramCapabilities;
  // Post texts are validated non-empty by the post schema (T03).
  const [primaryLang, ...otherLangs] = orderLanguages(post, settings) as [string, ...string[]];

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
