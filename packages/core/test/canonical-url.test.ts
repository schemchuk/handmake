import { describe, expect, it } from 'vitest';

import { canonicalLinkSettings, canonicalUrl } from '../src/canonical-url';
import type { SiteConfig, TenantConfig } from '../src/tenant';

const site: Pick<SiteConfig, 'baseUrl' | 'defaultLanguage'> = {
  baseUrl: 'https://fadenundstimmung.de',
  defaultLanguage: 'de',
};

describe('canonicalUrl', () => {
  it('serves the default language at the root', () => {
    expect(canonicalUrl(site, 'posts', '01JBCA1B2C3D4E5F6G7H8J9K0M', 'de')).toBe(
      'https://fadenundstimmung.de/posts/01jbca1b2c3d4e5f6g7h8j9k0m/',
    );
  });

  it('serves other tenant languages under /<lang>/', () => {
    expect(canonicalUrl(site, 'posts', '01JBCA1B2C3D4E5F6G7H8J9K0M', 'uk')).toBe(
      'https://fadenundstimmung.de/uk/posts/01jbca1b2c3d4e5f6g7h8j9k0m/',
    );
  });

  it.each(['works', 'shows'] as const)('builds %s pages the same way', (section) => {
    expect(canonicalUrl(site, section, '01JBCA1B2C3D4E5F6G7H8J9K0M', 'de')).toBe(
      `https://fadenundstimmung.de/${section}/01jbca1b2c3d4e5f6g7h8j9k0m/`,
    );
  });

  it('lowercases the id, so the URL is known before the site rebuild', () => {
    const url = canonicalUrl(site, 'posts', '01M5YZZH801VCJN4RFEFQRW6NW', 'uk');
    expect(url).toContain('/uk/posts/01m5yzzh801vcjn4rfefqrw6nw/');
    expect(url).toBe(url.toLowerCase());
  });
});

describe('canonicalLinkSettings', () => {
  const tenant = {
    featureFlags: { canonicalLinks: true },
    site,
  } as unknown as Pick<TenantConfig, 'featureFlags' | 'site'>;

  it('is present when the flag is on and the tenant has a site', () => {
    expect(canonicalLinkSettings(tenant, 'posts')).toEqual({
      links: true,
      baseUrl: 'https://fadenundstimmung.de',
      defaultLanguage: 'de',
      section: 'posts',
    });
  });

  it('carries the caller-chosen section for work announcements', () => {
    expect(canonicalLinkSettings(tenant, 'works')?.section).toBe('works');
  });

  it('is absent when the flag is off, so pre-site posts stay unchanged', () => {
    expect(
      canonicalLinkSettings({ ...tenant, featureFlags: { canonicalLinks: false } }, 'posts'),
    ).toBeUndefined();
    expect(canonicalLinkSettings({ ...tenant, featureFlags: {} }, 'posts')).toBeUndefined();
  });

  it('is absent without a site section', () => {
    expect(
      canonicalLinkSettings({ featureFlags: { canonicalLinks: true } }, 'posts'),
    ).toBeUndefined();
  });
});
