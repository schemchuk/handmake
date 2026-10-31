/**
 * URL scheme (pure functions, no I/O). The default language lives at `/`,
 * every other tenant language under `/<lang>/`. Post pages live at
 * `posts/<lowercased post id>/` in every language, so the canonical URL of a
 * post is known from its id before the site is rebuilt (F31, T40).
 */

export function languagePrefix(lang: string, defaultLanguage: string): string {
  return lang === defaultLanguage ? '' : `/${lang}`;
}

/** Path of a site page in one language; `page` has no leading or trailing slash ('' = home). */
export function pagePath(lang: string, defaultLanguage: string, page = ''): string {
  const prefix = languagePrefix(lang, defaultLanguage);
  return page === '' ? `${prefix}/` : `${prefix}/${page}/`;
}

export function postPage(postId: string): string {
  return `posts/${postId.toLowerCase()}`;
}

/** Value of the `[...lang]` rest param for a language (undefined = default language). */
export function langParam(lang: string, defaultLanguage: string): string | undefined {
  return lang === defaultLanguage ? undefined : lang;
}

export function absoluteUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

export function mediaPath(postId: string, fileName: string): string {
  return `/media/${postId.toLowerCase()}/${fileName}`;
}
