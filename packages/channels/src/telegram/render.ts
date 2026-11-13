import { appendAuthenticity } from '../authenticity';
import { canonicalUrl } from '@handmake/core';
import type {
  CanonicalLinkSettings,
  ChannelCapabilities,
  Post,
  Show,
  ShowRenderContext,
  SendOperation,
} from '@handmake/core';

import { showDisclosure } from '../show-disclosures';

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
 *
 * `wotw-poll` posts (ADR 008) add one more op right after the album: a poll
 * replying to the album (Telegram polls cannot carry images, so the numbered
 * candidates are the album photos and the options reference them). The poll
 * is a single-language op; its question/options come from the post's `poll`
 * frontmatter as written. The language replies still target the album.
 */

/** Per-channel settings of the tenant config (`channels.telegram`). */
export interface TelegramChannelSettings {
  /** Secret NAME resolving to the target chat id; never a raw value. */
  channelId: string;
  joinUrl?: string;
  /** Tenant language order; the first language present in the post is primary. */
  languages?: string[];
  /** F31/T40 canonical site link footer; absent keeps posts without a link. */
  canonical?: CanonicalLinkSettings;
}

export const telegramCapabilities: ChannelCapabilities = {
  maxPhotos: 10,
  captionLimit: 1024,
  messageLimit: 4096,
  polls: true,
  pollMaxOptions: 10,
  pollQuestionLimit: 300,
  pollOptionLimit: 100,
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

/** Canonical footer intro per language (F31, T40); the URL follows on the same line. */
const canonicalIntros: Record<string, string> = {
  de: 'Mehr auf der Website:',
  uk: 'Більше на сайті:',
};

function canonicalLine(lang: string, canonical: CanonicalLinkSettings, id: string): string {
  let origin: URL | undefined;
  try {
    origin = new URL(canonical.baseUrl);
  } catch {
    // reported below
  }
  if (!origin || origin.protocol !== 'https:' || origin.origin !== canonical.baseUrl) {
    throw new TelegramRenderError(
      'canonical baseUrl must be an https origin without path or trailing slash',
    );
  }
  const intro = canonicalIntros[lang];
  if (!intro) {
    throw new TelegramRenderError(`unsupported canonical footer language: "${lang}"`);
  }
  return `${intro} ${canonicalUrl(canonical, canonical.section, id, lang)}`;
}

/**
 * Site-worthy posts get the canonical footer: `free` posts have a site page,
 * announcements, reminders and polls do not (`siteVisibleTypes`), and an
 * excluded (test) post's page never exists. Show copies already carry their
 * canonical URL inside the description text, so they pass no item.
 */
function footerItem(post: Post): { id: string; siteExcluded?: boolean } | undefined {
  return post.type === 'free' ? { id: post.id, siteExcluded: post.siteExcluded } : undefined;
}

/** Shared footer: the canonical site link (T40) and the channel join line (T47g). */
function appendFooter(
  text: string,
  lang: string,
  settings: unknown,
  item?: { id: string; siteExcluded?: boolean },
): string {
  if (typeof settings !== 'object' || settings === null) return text;
  const lines: string[] = [];
  const canonical = (settings as { canonical?: CanonicalLinkSettings }).canonical;
  if (item && !item.siteExcluded && canonical?.links) {
    lines.push(canonicalLine(lang, canonical, item.id));
  }
  if (lang === 'de') {
    const joinUrl = (settings as { joinUrl?: unknown }).joinUrl;
    if (typeof joinUrl === 'string' && joinUrl) lines.push(`Kanal abonnieren: ${joinUrl}`);
  }
  return lines.length ? `${text}\n\n${lines.join('\n')}` : text;
}

export function renderTelegram(post: Post, settings?: unknown): SendOperation[] {
  const {
    maxPhotos,
    captionLimit,
    messageLimit,
    pollMaxOptions,
    pollQuestionLimit,
    pollOptionLimit,
  } = telegramCapabilities;
  // Post texts are validated non-empty by the post schema (T03).
  const [primaryLang, ...otherLangs] = orderLanguages(post, settings) as [string, ...string[]];

  if (post.photos.length > maxPhotos) {
    throw new TelegramRenderError(
      `Telegram allows at most ${maxPhotos} photos per album; post has ${post.photos.length}`,
    );
  }

  const ops: SendOperation[] = [];
  const item = footerItem(post);
  const primaryText = appendFooter(
    appendAuthenticity(post.texts[primaryLang]!, primaryLang, post.photos.length > 0),
    primaryLang,
    settings,
    item,
  );

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

  if (post.type === 'wotw-poll') {
    const poll = post.poll;
    // parsePost rejects a wotw-poll without a poll; this guard covers posts
    // synthesized bypassing the schema (e.g. previews).
    if (!poll) {
      throw new TelegramRenderError('wotw-poll requires a poll (question + options)');
    }
    if (poll.options.length > pollMaxOptions) {
      throw new TelegramRenderError(
        `Telegram allows at most ${pollMaxOptions} poll options; poll has ${poll.options.length}`,
      );
    }
    if (poll.question.length > pollQuestionLimit) {
      throw new TelegramRenderError(
        `Telegram poll question limit is ${pollQuestionLimit} chars; question has ${poll.question.length}`,
      );
    }
    const overLimit = poll.options.find((option) => option.length > pollOptionLimit);
    if (overLimit !== undefined) {
      throw new TelegramRenderError(
        `Telegram poll option limit is ${pollOptionLimit} chars; option "${overLimit.slice(0, 20)}…" is too long`,
      );
    }
    // The poll replies to the album (op 0), even when the primary text
    // overflowed into a separate message (op 1).
    ops.push({ kind: 'poll', question: poll.question, options: poll.options, replyToOp: 0 });
  }

  // Further languages reply to the album (op 0), even if the primary text
  // overflowed into a separate message.
  for (const lang of otherLangs) {
    const text = appendFooter(
      appendAuthenticity(post.texts[lang]!, lang, post.photos.length > 0),
      lang,
      settings,
      item,
    );
    checkLimit(lang, text);
    ops.push({ kind: 'message', text, lang, replyToOp: 0 });
  }

  return ops;
}

/** Show descriptions remain verbatim; disclosure and canonical links are appended. */
export function renderTelegramShow(show: Show, context: ShowRenderContext): SendOperation[] {
  const authenticPhotos = (show.authentic ?? []).filter((item) => item.kind === 'photo');
  const photos = [...authenticPhotos, ...show.images];
  const { baseUrl, defaultLanguage } = context.site;
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' || origin.origin !== baseUrl) {
    throw new TelegramRenderError('show site baseUrl must be an HTTPS origin');
  }
  if (show.images.length < 3 || show.images.length > 5 || !show.video) {
    throw new TelegramRenderError('show requires 3-5 images and a video');
  }
  if (photos.length > telegramCapabilities.maxPhotos) {
    throw new TelegramRenderError('show exceeds Telegram photo limit');
  }
  const languages = [...new Set(context.languages.filter((lang) => show.versions[lang]))];
  if (!languages.length) throw new TelegramRenderError('show requires descriptions');
  const ops: SendOperation[] = [
    {
      kind: 'mediaGroup',
      photoIndexes: photos.map((_, index) => index),
    },
    ...((show.authentic ?? []).some((item) => item.kind === 'video')
      ? [{ kind: 'video' as const, videoSource: 'authentic' as const, replyToOp: 0 }]
      : []),
    { kind: 'video', replyToOp: 0 },
  ];
  for (const [index, lang] of languages.entries()) {
    if (!/^[a-z]{2}$/.test(lang)) throw new TelegramRenderError('invalid show language');
    const path = `${lang === defaultLanguage ? '' : `/${lang}`}/shows/${show.id.toLowerCase()}/`;
    const disclosure = showDisclosure(lang, authenticPhotos.length);
    if (!disclosure) throw new TelegramRenderError(`unsupported show disclosure language: ${lang}`);
    // A site-excluded (test) show's page is never built, so the copy must
    // not link to it (PR #89 review).
    const text = appendFooter(
      show.siteExcluded
        ? `${show.versions[lang]!.description}\n\n${disclosure}`
        : `${show.versions[lang]!.description}\n\n${disclosure}\n${baseUrl}${path}`,
      lang,
      context.settings,
    );
    if (text.length > telegramCapabilities.messageLimit) {
      throw new TelegramRenderError(`show description for "${lang}" exceeds message limit`);
    }
    if (index === 0 && text.length <= telegramCapabilities.captionLimit) {
      const album = ops[0] as Extract<SendOperation, { kind: 'mediaGroup' }>;
      album.caption = text;
      album.captionLang = lang;
    } else {
      ops.push({ kind: 'message', text, lang, replyToOp: 0 });
    }
  }
  return ops;
}
