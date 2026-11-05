import type { SiteConfig, TenantConfig } from './tenant';

/**
 * Canonical site links (F31, T40). The URL scheme mirrors
 * apps/site/src/lib/paths.ts: the default language serves at the root, every
 * other tenant language under `/<lang>/`; item pages live at
 * `/<section>/<lowercased id>/`. The post id is stable, so the canonical URL
 * is known before the site rebuild.
 */

export type CanonicalSection = 'posts' | 'works' | 'shows';

/** Canonical absolute URL of one published item in one language. */
export function canonicalUrl(
  site: Pick<SiteConfig, 'baseUrl' | 'defaultLanguage'>,
  section: CanonicalSection,
  id: string,
  lang: string,
): string {
  const prefix = lang === site.defaultLanguage ? '' : `/${lang}`;
  return `${site.baseUrl}${prefix}/${section}/${id.toLowerCase()}/`;
}

/**
 * What a channel renderer needs to append the canonical footer (T40).
 * `section` is the rendered item's site section: a work announcement links
 * to its work page, never to a (non-existent) blog post page.
 */
export interface CanonicalLinkSettings {
  links: true;
  baseUrl: string;
  defaultLanguage: string;
  section: Exclude<CanonicalSection, 'shows'>;
}

/**
 * Canonical-link settings for a tenant publication, or undefined when the
 * footer must stay off: the tenant has no site, or
 * `featureFlags.canonicalLinks` is not on. The flag keeps posts made before
 * the site (or the flag) unchanged — channel messages are immutable, so a
 * link can never be retrofitted.
 */
export function canonicalLinkSettings(
  tenant: Pick<TenantConfig, 'featureFlags' | 'site'>,
  section: CanonicalLinkSettings['section'],
): CanonicalLinkSettings | undefined {
  if (tenant.featureFlags['canonicalLinks'] !== true || !tenant.site) return undefined;
  return {
    links: true,
    baseUrl: tenant.site.baseUrl,
    defaultLanguage: tenant.site.defaultLanguage,
    section,
  };
}
