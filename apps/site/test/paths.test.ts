import { describe, expect, it } from 'vitest';

import {
  absoluteUrl,
  langParam,
  languagePrefix,
  mediaPath,
  pagePath,
  postPage,
} from '../src/lib/paths';

describe('language routing', () => {
  it('serves the default language at the root and others under /<lang>/', () => {
    expect(pagePath('de', 'de')).toBe('/');
    expect(pagePath('uk', 'de')).toBe('/uk/');
    expect(pagePath('de', 'de', 'kreis')).toBe('/kreis/');
    expect(pagePath('uk', 'de', 'kreis')).toBe('/uk/kreis/');
  });

  it('does not hard-code which language is the default', () => {
    expect(pagePath('uk', 'uk')).toBe('/');
    expect(pagePath('de', 'uk', 'kreis')).toBe('/de/kreis/');
    expect(languagePrefix('fr', 'uk')).toBe('/fr');
  });

  it('maps the default language to an absent rest param', () => {
    expect(langParam('de', 'de')).toBeUndefined();
    expect(langParam('uk', 'de')).toBe('uk');
  });
});

describe('post URLs', () => {
  const id = '01M5YX3VT77NHNQSKZ9KZX9T2W';

  it('derives the post page from the lowercased id, in every language', () => {
    expect(pagePath('de', 'de', postPage(id))).toBe('/posts/01m5yx3vt77nhnqskz9kzx9t2w/');
    expect(pagePath('uk', 'de', postPage(id))).toBe('/uk/posts/01m5yx3vt77nhnqskz9kzx9t2w/');
  });

  it('builds absolute and media URLs', () => {
    expect(absoluteUrl('https://example.org', '/kreis/')).toBe('https://example.org/kreis/');
    expect(mediaPath(id, 'photo-1.jpg')).toBe('/media/01m5yx3vt77nhnqskz9kzx9t2w/photo-1.jpg');
  });
});
