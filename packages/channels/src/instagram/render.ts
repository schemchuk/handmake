import { canonicalUrl } from '@handmake/core';
import type {
  CanonicalLinkSettings,
  ChannelCapabilities,
  Post,
  Show,
  ShowRenderContext,
  SendOperation,
} from '@handmake/core';

import { showDisclosures } from '../show-disclosures';

/**
 * Pure part of the Instagram ChannelAdapter (T26a1, F33): turns a post into
 * the single send operation the publisher delivers. The bot preview and the
 * publisher both call this exact function, so the preview is what gets
 * posted.
 *
 * Caption rules (F33, ported from instagram-agent-skill, MIT — the license
 * notice is added with the ported text when Volodymyr supplies the skill
 * file): the first ~125 characters carry the message (the feed truncates
 * the caption behind "more"), at most 5 hashtags, no stock phrases. The
 * caption limit is 2200 characters. Multi-photo items go out as one
 * carousel (2-10 photos); every carousel image is framed 4:5 (1080x1350,
 * padded, never cutting the work — `instagramCarouselFrame`) by the
 * publisher before delivery.
 *
 * Instagram receives only site-worthy items: a post without photos, a
 * non-`free` type and a site-excluded (test) post all render to zero
 * operations (`instagramSkipReason` says which case a caller has). Shows
 * render to one image-carousel op; the video is not copied (Reels is a
 * later task). The AI disclosure and the canonical show link ride the
 * caption. Instagram captions have no clickable links, so the canonical
 * site URL is appended as plain text.
 */

export const instagramCaptionWindow = 125;
export const instagramCaptionLimit = 2200;
export const instagramHashtagLimit = 5;
export const instagramMaxPhotos = 10;
/** Every carousel image is framed to this exact 4:5 canvas before delivery. */
export const instagramCarouselFrame = { width: 1080, height: 1350 } as const;

/** Per-channel settings of the tenant config (`channels.instagram`). */
export interface InstagramChannelSettings {
  /** Tenant language the Instagram caption is written in (usually `de`). */
  language: string;
  /** F31/T40 canonical site link; absent keeps the caption without a link. */
  canonical?: CanonicalLinkSettings;
}

export const instagramCapabilities: ChannelCapabilities = {
  maxPhotos: instagramMaxPhotos,
  captionLimit: instagramCaptionLimit,
  messageLimit: instagramCaptionLimit,
  polls: false,
  pollMaxOptions: 0,
  pollQuestionLimit: 0,
  pollOptionLimit: 0,
};

export class InstagramRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramRenderError';
  }
}

/** Why Instagram renders nothing for a post; undefined means "it renders". */
export type InstagramSkip = 'no-photos' | 'not-site-worthy' | 'site-excluded';

export function instagramSkipReason(post: Post): InstagramSkip | undefined {
  if (post.photos.length === 0) return 'no-photos';
  if (post.type !== 'free') return 'not-site-worthy';
  if (post.siteExcluded) return 'site-excluded';
  return undefined;
}

/** Validates the tenant's per-channel settings (called by render and deliver). */
export function parseInstagramChannelSettings(settings: unknown): InstagramChannelSettings {
  if (typeof settings !== 'object' || settings === null) {
    throw new InstagramRenderError('Instagram settings must be an object with a language');
  }
  const candidate = settings as { language?: unknown };
  if (typeof candidate.language !== 'string' || !/^[a-z]{2}$/.test(candidate.language)) {
    throw new InstagramRenderError('Instagram settings.language must be a 2-letter code');
  }
  return settings as InstagramChannelSettings;
}

/** Counts `#tag` occurrences; a caption may carry at most `instagramHashtagLimit`. */
export function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

function canonicalCaptionLine(canonical: CanonicalLinkSettings, id: string, lang: string): string {
  let origin: URL | undefined;
  try {
    origin = new URL(canonical.baseUrl);
  } catch {
    // reported below
  }
  if (!origin || origin.protocol !== 'https:' || origin.origin !== canonical.baseUrl) {
    throw new InstagramRenderError(
      'canonical baseUrl must be an https origin without path or trailing slash',
    );
  }
  return canonicalUrl(canonical, canonical.section, id, lang);
}

/**
 * Builds the single-language caption: the post text, the hard hashtag limit
 * and the 2200-character limit enforced. The canonical site URL is appended
 * as plain text (links are not clickable in Instagram captions).
 */
export function buildInstagramCaption(
  text: string,
  item: { id: string; siteExcluded?: boolean },
  settings: InstagramChannelSettings,
): string {
  const hashtags = countHashtags(text);
  if (hashtags > instagramHashtagLimit) {
    throw new InstagramRenderError(
      `Instagram allows at most ${instagramHashtagLimit} hashtags; caption has ${hashtags}`,
    );
  }
  const canonical = settings.canonical;
  const caption =
    canonical && !item.siteExcluded
      ? `${text}\n\n${canonicalCaptionLine(canonical, item.id, settings.language)}`
      : text;
  if (caption.length > instagramCaptionLimit) {
    throw new InstagramRenderError(
      `Instagram caption limit is ${instagramCaptionLimit} chars; caption for "${settings.language}" has ${caption.length}`,
    );
  }
  return caption;
}

export function renderInstagram(post: Post, settings?: unknown): SendOperation[] {
  const parsed = parseInstagramChannelSettings(settings);
  // Skipped posts render to zero ops: the publisher marks the channel done
  // with no remote ids and the preview shows the reason.
  if (instagramSkipReason(post)) return [];
  if (post.photos.length > instagramMaxPhotos) {
    throw new InstagramRenderError(
      `Instagram allows at most ${instagramMaxPhotos} photos per carousel; post has ${post.photos.length}`,
    );
  }
  if (!(parsed.language in post.texts)) {
    throw new InstagramRenderError(
      `Instagram language "${parsed.language}" has no text in this post`,
    );
  }
  const caption = buildInstagramCaption(post.texts[parsed.language]!, post, parsed);
  return [
    {
      kind: 'mediaGroup',
      photoIndexes: post.photos.map((_, index) => index),
      caption,
      captionLang: parsed.language,
    },
  ];
}

/**
 * A show copies to Instagram as one image carousel; the AI disclosure and
 * the canonical show link are appended to the description. A site-excluded
 * show has no page to link, so it renders to zero ops (the copy runner
 * drops channels with an empty render).
 */
export function renderInstagramShow(show: Show, context: ShowRenderContext): SendOperation[] {
  if (show.siteExcluded) return [];
  const settings = parseInstagramChannelSettings(context.settings);
  const { baseUrl, defaultLanguage } = context.site;
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' || origin.origin !== baseUrl) {
    throw new InstagramRenderError('show site baseUrl must be an HTTPS origin');
  }
  const version = show.versions[settings.language];
  if (!version) {
    throw new InstagramRenderError(
      `Instagram language "${settings.language}" has no show description`,
    );
  }
  const disclosure = showDisclosures[settings.language];
  if (!disclosure) {
    throw new InstagramRenderError(`unsupported show disclosure language: "${settings.language}"`);
  }
  const caption = `${version.description}\n\n${disclosure}\n${canonicalUrl(
    { baseUrl, defaultLanguage },
    'shows',
    show.id,
    settings.language,
  )}`;
  if (caption.length > instagramCaptionLimit) {
    throw new InstagramRenderError(
      `Instagram caption limit is ${instagramCaptionLimit} chars; show caption has ${caption.length}`,
    );
  }
  return [
    {
      kind: 'mediaGroup',
      photoIndexes: show.images.map((_, index) => index),
      caption,
      captionLang: settings.language,
    },
  ];
}
