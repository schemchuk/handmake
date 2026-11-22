import { getDomain } from 'tldts';

const sourceTags = new Set(['tg', 'th', 'ig', 'fb', 'yt', 'gh', 'li', 'nl', 'qr']);
const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Reduce incoming attribution to a bounded category; never retain full referrers. */
export function siteVisitSource(url: URL, referer: string | null): string {
  const tag = url.searchParams.get('s');
  if (tag && sourceTags.has(tag)) return tag;
  if (!referer) return 'direct';
  let ref: URL;
  try {
    ref = new URL(referer);
  } catch {
    return 'direct';
  }
  if (!['http:', 'https:'].includes(ref.protocol)) return 'direct';
  const host = ref.hostname.toLowerCase().replace(/\.$/, '');
  if (ref.origin === url.origin) return 'internal';
  const domain = getDomain(host, { allowPrivateDomains: true });
  if (isHost(host, 't.me') || isHost(host, 'telegram.org') || domain?.startsWith('telegram.'))
    return 'tg';
  if (isHost(host, 'instagram.com')) return 'ig';
  if (isHost(host, 'facebook.com')) return 'fb';
  if (isHost(host, 'threads.net') || isHost(host, 'threads.com')) return 'th';
  if (isHost(host, 'youtube.com') || isHost(host, 'youtu.be')) return 'yt';
  if (
    domain?.startsWith('google.') ||
    domain?.startsWith('yandex.') ||
    ['bing.com', 'duckduckgo.com', 'ecosia.org'].some((name) => isHost(host, name))
  )
    return 'search';
  // IP literals and local/invalid hosts cannot supply a registrable source domain.
  return domain ? `other:${domain}`.slice(0, 64) : 'direct';
}

/** Callers use the response status to flag unknown routes. */
export function siteVisitPath(url: URL, status = 200): string {
  if (status === 404 || /\/(?:404|404\.html)\/?$/.test(url.pathname)) return '/404';
  return url.pathname.slice(0, 200);
}
