import { describe, expect, it } from 'vitest';
import { siteVisitPath, siteVisitSource } from '../src/site-visits';

const url = new URL('https://example.invalid/uk/?private=value#fragment');
describe('site visit attribution', () => {
  it.each(['tg', 'th', 'ig', 'fb', 'gh', 'li', 'nl', 'qr'])('prefers the %s tag', (tag) => {
    expect(
      siteVisitSource(new URL(`https://example.invalid/?s=${tag}`), 'https://google.de/'),
    ).toBe(tag);
  });
  it.each([
    ['t.me', 'tg'],
    ['telegram.me', 'tg'],
    ['web.telegram.org', 'tg'],
    ['instagram.com', 'ig'],
    ['l.instagram.com', 'ig'],
    ['facebook.com', 'fb'],
    ['l.facebook.com', 'fb'],
    ['m.facebook.com', 'fb'],
    ['lm.facebook.com', 'fb'],
    ['threads.net', 'th'],
    ['threads.com', 'th'],
    ['google.de', 'search'],
    ['www.google.co.uk', 'search'],
    ['bing.com', 'search'],
    ['duckduckgo.com', 'search'],
    ['ecosia.org', 'search'],
    ['yandex.ru', 'search'],
    ['example.invalid', 'internal'],
    ['blog.example.co.uk', 'other:example.co.uk'],
    ['BLOG.EXAMPLE.COM', 'other:example.com'],
    ['facebook.com.evil.org', 'other:evil.org'],
    ['google.evil.org', 'other:evil.org'],
  ])('maps %s without retaining paths or query', (host, source) => {
    expect(siteVisitSource(url, `https://${host}/private?secret=value`)).toBe(source);
    expect(siteVisitSource(new URL('https://example.invalid/?s=invalid'), `https://${host}/`)).toBe(
      source,
    );
  });
  it.each([
    null,
    '',
    'invalid',
    'file:///secret',
    'https://127.0.0.1/private',
    'https://localhost/',
  ])('handles unusable referrer %s', (ref) => {
    expect(siteVisitSource(url, ref)).toBe('direct');
  });
  it('limits unknown source values and strips all subdomains', () => {
    const source = siteVisitSource(url, `https://${'a'.repeat(63)}.com/private`);
    expect(source).toHaveLength(64);
    expect(source).not.toContain('/');
  });
  it('normalizes paths and caps their length', () => {
    expect(siteVisitPath(url)).toBe('/uk/');
    expect(
      siteVisitPath(new URL(`https://example.invalid/${'a'.repeat(300)}?secret=value`)),
    ).toHaveLength(200);
    expect(siteVisitPath(url, 404)).toBe('/404');
    for (const path of ['/404/', '/uk/404/', '/404.html'])
      expect(siteVisitPath(new URL(path, url))).toBe('/404');
  });
});
