import { appendAuthenticity } from '../authenticity';
import {
  canonicalUrl,
  type CanonicalLinkSettings,
  type Post,
  type SendOperation,
} from '@handmake/core';

/** YouTube Data API v3 limits: title 100 characters, description 5000 bytes. */
export const youtubeTitleLimit = 100;
export const youtubeDescriptionLimit = 5000;
/** F43: YouTube shows the first three; more than five reads as spam. */
export const youtubeHashtagLimit = 5;
export const youtubeCapabilities = {
  maxPhotos: 0,
  captionLimit: youtubeDescriptionLimit,
  messageLimit: 0,
  polls: false,
  pollMaxOptions: 0,
  pollQuestionLimit: 0,
  pollOptionLimit: 0,
};
export class YoutubeRenderError extends Error {}
export interface YoutubeChannelSettings {
  language: string;
  canonical?: CanonicalLinkSettings;
}
export function parseYoutubeSettings(value: unknown): YoutubeChannelSettings {
  const settings = value as YoutubeChannelSettings | undefined;
  if (!settings || typeof settings.language !== 'string' || !/^[a-z]{2}$/.test(settings.language))
    throw new YoutubeRenderError('YouTube settings.language must be a 2-letter code');
  return settings;
}

// YouTube rejects angle brackets in titles and descriptions.
const clean = (text: string): string => text.replace(/[<>]/g, '');
const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** First non-empty line, without hashtags, cut at a word to 100 characters. */
export function youtubeTitle(text: string): string {
  const line =
    clean(text)
      .split(/\r?\n/)
      .map((value) =>
        value
          .replace(/(^|\s)#[^\s#]+/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .find(Boolean) ?? '';
  if (!line) throw new YoutubeRenderError('YouTube title needs a non-empty first line');
  const chars = [...line];
  if (chars.length <= youtubeTitleLimit) return line;
  const cut = chars.slice(0, youtubeTitleLimit - 1).join('');
  const word = cut.replace(/\s+\S*$/u, '');
  return `${(word.length >= youtubeTitleLimit / 2 ? word : cut).trimEnd()}…`;
}

/** Keeps the first five distinct hashtags; later ones are dropped from the text. */
export function limitHashtags(text: string, limit = youtubeHashtagLimit): string {
  const seen = new Set<string>();
  return text
    .replace(/(^|\s)#([^\s#]+)/gu, (match, lead: string, tag: string) => {
      const key = tag.toLowerCase();
      if (seen.has(key) || seen.size >= limit) return lead;
      seen.add(key);
      return match;
    })
    .replace(/([^\s])[ \t]{2,}(?=\S)/gu, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The op's caption is the description; the adapter derives the title from it. */
export function renderYoutube(post: Post, value: unknown): SendOperation[] {
  const { language, canonical } = parseYoutubeSettings(value);
  // Only work announcements carry a video; everything else is out of scope.
  if (post.type !== 'free') return [];
  const source = post.texts[language];
  if (source === undefined)
    throw new YoutubeRenderError(`YouTube language "${language}" has no text`);
  let text = limitHashtags(appendAuthenticity(clean(source), language, true));
  if (canonical?.links && !post.siteExcluded) {
    const origin = new URL(canonical.baseUrl);
    if (origin.protocol !== 'https:' || origin.origin !== canonical.baseUrl)
      throw new YoutubeRenderError('YouTube canonical baseUrl must be an HTTPS origin');
    text += `\n\n${canonicalUrl(canonical, canonical.section, post.id, language, 'yt')}`;
  }
  youtubeTitle(text);
  if (utf8Length(text) > youtubeDescriptionLimit)
    throw new YoutubeRenderError(
      `YouTube description must be at most ${youtubeDescriptionLimit} UTF-8 bytes`,
    );
  return [{ kind: 'video', caption: text }];
}
