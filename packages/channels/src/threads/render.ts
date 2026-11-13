import { appendAuthenticity } from '../authenticity';
import {
  canonicalUrl,
  type CanonicalLinkSettings,
  type Post,
  type SendOperation,
  type Show,
  type ShowRenderContext,
} from '@handmake/core';
import { showDisclosure } from '../show-disclosures';

export const threadsTextLimit = 500;
export const threadsCapabilities = {
  maxPhotos: 20,
  captionLimit: threadsTextLimit,
  messageLimit: threadsTextLimit,
  polls: false,
  pollMaxOptions: 0,
  pollQuestionLimit: 0,
  pollOptionLimit: 0,
};
export class ThreadsRenderError extends Error {}
export interface ThreadsChannelSettings {
  language: string;
  canonical?: CanonicalLinkSettings;
}
export function parseThreadsSettings(value: unknown): ThreadsChannelSettings {
  const settings = value as ThreadsChannelSettings | undefined;
  if (!settings || typeof settings.language !== 'string' || !/^[a-z]{2}$/.test(settings.language))
    throw new ThreadsRenderError('Threads settings.language must be a 2-letter code');
  return settings;
}
// Conservative UTF-8 budget: also covers Meta's byte accounting for emoji.
export const threadsTextLength = (text: string): number => new TextEncoder().encode(text).length;
export function assertThreadsText(text: string): void {
  if (!text.trim() || threadsTextLength(text) > threadsTextLimit)
    throw new ThreadsRenderError(
      `Threads text must contain 1–${threadsTextLimit} UTF-8 bytes; got ${threadsTextLength(text)}`,
    );
}
export function threadsSkipReason(post: Post): 'not-site-worthy' | 'site-excluded' | undefined {
  return post.siteExcluded ? 'site-excluded' : post.type !== 'free' ? 'not-site-worthy' : undefined;
}
function operation(text: string, photos: unknown[], language: string): SendOperation[] {
  assertThreadsText(text);
  if (photos.length > threadsCapabilities.maxPhotos)
    throw new ThreadsRenderError('Threads allows at most 20 photos');
  return photos.length
    ? [
        {
          kind: 'mediaGroup',
          photoIndexes: photos.map((_, i) => i),
          caption: text,
          captionLang: language,
        },
      ]
    : [{ kind: 'message', text, lang: language }];
}
export function renderThreads(post: Post, value: unknown): SendOperation[] {
  const { language, canonical } = parseThreadsSettings(value);
  if (threadsSkipReason(post)) return [];
  let text = post.texts[language];
  if (text === undefined)
    throw new ThreadsRenderError(`Threads language "${language}" has no text`);
  text = appendAuthenticity(text, language, post.photos.length > 0);
  if (canonical?.links) {
    const origin = new URL(canonical.baseUrl);
    if (origin.protocol !== 'https:' || origin.origin !== canonical.baseUrl)
      throw new ThreadsRenderError('Threads canonical baseUrl must be an HTTPS origin');
    text += `\n\n${canonicalUrl(canonical, canonical.section, post.id, language)}`;
  }
  return operation(text, post.photos, language);
}
export function renderThreadsShow(show: Show, context: ShowRenderContext): SendOperation[] {
  if (show.siteExcluded) return [];
  const authenticPhotos = (show.authentic ?? []).filter((item) => item.kind === 'photo');
  const photos = [...authenticPhotos, ...show.images];
  const { language } = parseThreadsSettings(context.settings);
  const description = show.versions[language]?.description;
  const disclosure = showDisclosure(language, authenticPhotos.length);
  if (!description || !disclosure || !show.images.length)
    throw new ThreadsRenderError('Threads show needs images, description and disclosure');
  const origin = new URL(context.site.baseUrl);
  if (origin.protocol !== 'https:' || origin.origin !== context.site.baseUrl)
    throw new ThreadsRenderError('Threads show baseUrl must be an HTTPS origin');
  const url = canonicalUrl(context.site, 'shows', show.id, language);
  return operation(`${description}\n\n${disclosure}\n${url}`, photos, language);
}
