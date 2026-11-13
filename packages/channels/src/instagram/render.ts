import { appendAuthenticity } from '../authenticity';
import type {
  ChannelCapabilities,
  Post,
  Show,
  ShowRenderContext,
  SendOperation,
} from '@handmake/core';

import { showDisclosures } from '../show-disclosures';

/*
 * Caption rules ported from instagram-agent-skill
 * (https://github.com/Jakeschincariol/instagram-agent-skill, skill `ig-caption`),
 * MIT License:
 *
 *   Copyright (c) 2026 Jake Schincariol
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *   THE SOFTWARE.
 *
 * What is ported (the skill's lint FAILs, enforced here in render): the feed
 * shows only the first ~125 characters before the "... more" cut, so the
 * message lives in that window; at most 5 hashtags (Instagram's cap since
 * 18 Dec 2025); the caption never opens on a hashtag or a mention; the hard
 * limit is 2200 characters; and no link in the caption — captions are not
 * clickable, so a URL is dead text ("Bio or DM", F33's "link in bio" case).
 * The skill's WARN-level guidance (one ask, emoji as punctuation, concrete
 * first line, search terms in the body, alt text) stays with the author.
 */

/**
 * Pure part of the Instagram ChannelAdapter (T26a1, F33): turns a post into
 * the single send operation the publisher delivers. The bot preview and the
 * publisher both call this exact function, so the preview is what gets
 * posted.
 *
 * Multi-photo items go out as one carousel (2-10 photos); every carousel
 * image is framed 4:5 (1080x1350, padded, never cutting the work —
 * `instagramCarouselFrame`) by the publisher before delivery. Instagram
 * receives only site-worthy items: a post without photos, a non-`free` type
 * and a site-excluded (test) post all render to zero operations
 * (`instagramSkipReason` says which case a caller has). Shows render to one
 * image-carousel op; the video is not copied (Reels is a later task). The
 * AI disclosure rides the show caption; the canonical link does not (see
 * the ported rules above — the site link lives in the profile bio, H8).
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

/**
 * Counts `#tag` occurrences: a tag of Unicode letters/numbers/underscore
 * preceded by start-of-string or whitespace (our captions are DE/UK, so
 * Cyrillic tags count — PR #93 review note). A caption may carry at most
 * `instagramHashtagLimit`.
 */
export function countHashtags(text: string): number {
  return (text.match(/(?:^|\s)(#[\p{L}\p{N}_]+)/gu) ?? []).length;
}

/** The ported lint: a caption must not open on a hashtag or a mention. */
function assertStrongOpening(text: string): void {
  const firstLine = text.split('\n', 1)[0]!.trim();
  if (!firstLine) {
    throw new InstagramRenderError('Instagram caption opens on a blank line');
  }
  if (firstLine.startsWith('#') || firstLine.startsWith('@')) {
    throw new InstagramRenderError(
      'Instagram caption opens on a hashtag or a mention — put the message first',
    );
  }
}

/**
 * Builds the single-language caption with the ported hard rules enforced:
 * strong first line, at most 5 hashtags, at most 2200 characters. The
 * caption carries no link on purpose (ported rule: captions are not
 * clickable, so the site link lives in the profile bio, H8).
 */
export function buildInstagramCaption(text: string): string {
  assertStrongOpening(text);
  const hashtags = countHashtags(text);
  if (hashtags > instagramHashtagLimit) {
    throw new InstagramRenderError(
      `Instagram allows at most ${instagramHashtagLimit} hashtags; caption has ${hashtags}`,
    );
  }
  if (text.length > instagramCaptionLimit) {
    throw new InstagramRenderError(
      `Instagram caption limit is ${instagramCaptionLimit} chars; caption has ${text.length}`,
    );
  }
  return text;
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
  const caption = buildInstagramCaption(
    appendAuthenticity(post.texts[parsed.language]!, parsed.language, true),
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
 * A show copies to Instagram as one image carousel; the AI disclosure is
 * appended to the description. A site-excluded show renders to zero ops
 * (the copy runner drops channels with an empty render). No link in the
 * caption (ported rule — the canonical show link is not added here).
 */
export function renderInstagramShow(show: Show, context: ShowRenderContext): SendOperation[] {
  if (show.siteExcluded) return [];
  const settings = parseInstagramChannelSettings(context.settings);
  const version = show.versions[settings.language];
  if (!version) {
    throw new InstagramRenderError(
      `Instagram language "${settings.language}" has no show description`,
    );
  }
  const disclosure = showDisclosures[settings.language as keyof typeof showDisclosures];
  if (!disclosure) {
    throw new InstagramRenderError(`unsupported show disclosure language: "${settings.language}"`);
  }
  const caption = buildInstagramCaption(`${version.description}\n\n${disclosure}`);
  return [
    {
      kind: 'mediaGroup',
      photoIndexes: show.images.map((_, index) => index),
      caption,
      captionLang: settings.language,
    },
  ];
}
