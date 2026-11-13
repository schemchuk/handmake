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
 * Pure part of the Facebook Page ChannelAdapter (T26b, F33): turns a post
 * into the single send operation the publisher delivers. The bot preview
 * and the publisher both call this exact function, so the preview is what
 * gets posted.
 *
 * Facebook receives the same German copy as the other Meta channels, with
 * the canonical site link appended to the caption — unlike Instagram,
 * Facebook post messages make URLs clickable, so the link rides the post
 * itself (F33: "the canonical link where the network allows it"). A post
 * without photos, a type other than `free` or `wotw-poll`, and a site-excluded post all
 * render to zero operations (`facebookSkipReason` says which case a caller
 * has). Shows render to one image op; the video is not copied (same scope
 * as the Instagram show copy).
 */

/** Facebook's documented feed-post message limit. */
export const facebookCaptionLimit = 63206;
/** One post attaches at most this many photos through `attached_media`. */
export const facebookMaxPhotos = 10;

/** Per-channel settings of the tenant config (`channels.facebook`). */
export interface FacebookChannelSettings {
  /** Tenant language the Facebook caption is written in (usually `de`). */
  language: string;
  /** F31/T40 canonical site link footer; absent keeps posts without a link. */
  canonical?: CanonicalLinkSettings;
}

export const facebookCapabilities: ChannelCapabilities = {
  maxPhotos: facebookMaxPhotos,
  captionLimit: facebookCaptionLimit,
  messageLimit: facebookCaptionLimit,
  polls: false,
  pollMaxOptions: 0,
  pollQuestionLimit: 0,
  pollOptionLimit: 0,
};

export class FacebookRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacebookRenderError';
  }
}

/** Why Facebook renders nothing for a post; undefined means "it renders". */
export type FacebookSkip = 'no-photos' | 'not-site-worthy' | 'site-excluded';

export function facebookSkipReason(post: Post): FacebookSkip | undefined {
  if (post.photos.length === 0) return 'no-photos';
  if (post.type !== 'free' && post.type !== 'wotw-poll') return 'not-site-worthy';
  if (post.siteExcluded) return 'site-excluded';
  return undefined;
}

/** Validates the tenant's per-channel settings (called by render and deliver). */
export function parseFacebookChannelSettings(settings: unknown): FacebookChannelSettings {
  if (typeof settings !== 'object' || settings === null) {
    throw new FacebookRenderError('Facebook settings must be an object with a language');
  }
  const candidate = settings as { language?: unknown };
  if (typeof candidate.language !== 'string' || !/^[a-z]{2}$/.test(candidate.language)) {
    throw new FacebookRenderError('Facebook settings.language must be a 2-letter code');
  }
  return settings as FacebookChannelSettings;
}

/** Canonical footer intro per language (F31, T40); the URL follows on the same line. */
const canonicalIntros: Record<string, string> = {
  de: 'Mehr auf der Website:',
  uk: 'Більше на сайті:',
};

/**
 * One caption line linking the item's canonical site page. Unlike
 * Instagram (captions are not clickable, so the link lives in the bio),
 * Facebook renders the URL as a clickable link inside the post message.
 */
function canonicalLine(lang: string, canonical: CanonicalLinkSettings, id: string): string {
  let origin: URL | undefined;
  try {
    origin = new URL(canonical.baseUrl);
  } catch {
    // reported below
  }
  if (!origin || origin.protocol !== 'https:' || origin.origin !== canonical.baseUrl) {
    throw new FacebookRenderError(
      'canonical baseUrl must be an https origin without path or trailing slash',
    );
  }
  const intro = canonicalIntros[lang];
  if (!intro) {
    throw new FacebookRenderError(`unsupported canonical footer language: "${lang}"`);
  }
  return `${intro} ${canonicalUrl(canonical, canonical.section, id, lang)}`;
}

/**
 * Builds the single-language caption: the post text plus the canonical
 * site link when the caller passes canonical settings (the publisher
 * injects them only for tenants with the flag on and a site). The caption
 * must fit Facebook's post limit.
 */
export function buildFacebookCaption(
  text: string,
  lang: string,
  id: string,
  settings?: unknown,
): string {
  const canonical =
    typeof settings === 'object' && settings !== null
      ? (settings as { canonical?: CanonicalLinkSettings }).canonical
      : undefined;
  const caption = canonical?.links ? `${text}\n\n${canonicalLine(lang, canonical, id)}` : text;
  if (caption.length > facebookCaptionLimit) {
    throw new FacebookRenderError(
      `Facebook caption limit is ${facebookCaptionLimit} chars; caption has ${caption.length}`,
    );
  }
  return caption;
}

export function renderFacebook(post: Post, settings?: unknown): SendOperation[] {
  const parsed = parseFacebookChannelSettings(settings);
  // Skipped posts render to zero ops: the publisher marks the channel done
  // with no remote ids and the preview shows the reason.
  if (facebookSkipReason(post)) return [];
  if (post.photos.length > facebookMaxPhotos) {
    throw new FacebookRenderError(
      `Facebook allows at most ${facebookMaxPhotos} photos per post; post has ${post.photos.length}`,
    );
  }
  if (!(parsed.language in post.texts)) {
    throw new FacebookRenderError(
      `Facebook language "${parsed.language}" has no text in this post`,
    );
  }
  // Ballots use a network-specific invitation, independent of editable comment-vote copy.
  const ballotIntros: Record<string, string> = {
    uk: 'Роботи тижня. Голосуйте в Telegram або Instagram.',
    de: 'Werke der Woche. Stimmt in Telegram oder Instagram ab.',
  };
  let text = post.texts[parsed.language]!;
  if (post.type === 'wotw-poll') {
    const intro = ballotIntros[parsed.language];
    if (!intro) throw new FacebookRenderError('Unsupported Facebook ballot language');
    const label = parsed.language === 'uk' ? 'Робота №' : 'Werk Nr.';
    text = `${intro}\n\n${post.photos.map((_, i) => `${label} ${i + 1}`).join('\n')}`;
  }
  const caption = buildFacebookCaption(
    appendAuthenticity(text, parsed.language, true),
    parsed.language,
    post.id,
    settings,
  );
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
 * A show copies to Facebook as one image op; the AI disclosure and the
 * canonical show link are appended to the description. A site-excluded
 * show renders to zero ops (the copy runner drops channels with an empty
 * render) and never links to a page that is never built (PR #89 review).
 */
export function renderFacebookShow(show: Show, context: ShowRenderContext): SendOperation[] {
  if (show.siteExcluded) return [];
  const authenticPhotos = (show.authentic ?? []).filter((item) => item.kind === 'photo');
  const photos = [...authenticPhotos, ...show.images];
  // Fail at render time (bot preview + publisher), like renderFacebook, not
  // later in deliver: a show outside 1..facebookMaxPhotos images can never
  // become a valid Facebook post (PR #96 review note).
  if (show.images.length === 0) {
    throw new FacebookRenderError('Facebook show post has no images to send');
  }
  if (photos.length > facebookMaxPhotos) {
    throw new FacebookRenderError(
      `Facebook allows at most ${facebookMaxPhotos} photos per show post; show has ${photos.length}`,
    );
  }
  const settings = parseFacebookChannelSettings(context.settings);
  const { baseUrl, defaultLanguage } = context.site;
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' || origin.origin !== baseUrl) {
    throw new FacebookRenderError('show site baseUrl must be an HTTPS origin');
  }
  const version = show.versions[settings.language];
  if (!version) {
    throw new FacebookRenderError(
      `Facebook language "${settings.language}" has no show description`,
    );
  }
  const disclosure = showDisclosure(settings.language, authenticPhotos.length);
  if (!disclosure) {
    throw new FacebookRenderError(`unsupported show disclosure language: "${settings.language}"`);
  }
  const path = `${settings.language === defaultLanguage ? '' : `/${settings.language}`}/shows/${show.id.toLowerCase()}/`;
  const caption = `${version.description}\n\n${disclosure}\n${baseUrl}${path}`;
  if (caption.length > facebookCaptionLimit) {
    throw new FacebookRenderError(
      `show description exceeds Facebook caption limit (${facebookCaptionLimit})`,
    );
  }
  return [
    {
      kind: 'mediaGroup',
      photoIndexes: photos.map((_, index) => index),
      caption,
      captionLang: settings.language,
    },
  ];
}
