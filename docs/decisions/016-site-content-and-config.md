# 016 — Site contracts: listing content from the ContentStore, tenant `site:` section

Status: accepted · Date: 2026-10-31 · Task: T35

## Context
T35 builds the Astro site in `apps/site`. ADR 011 says the site reads content from the `ContentStore`
and its theme from a `site:` section of the tenant config. The port had only `readPost(tenantId,
postId)`, so the site could not list posts, and photos could only be reached through the Git folder
layout. The tenant schema had no `site:` section. Works and collections (T36, T45) will need listing
later. The bot Worker parses the same tenant YAML, fetched from `main` at every cron tick.

## Options
Content:
1. **`listPosts(tenantId)` plus `readPostPhoto(tenantId, postId, fileName)` on the port** (chosen).
2. The site globs `content/posts/*/` itself. Simple, but ties the site to the Git layout; another
   tenant's store (R2, tenant repo, ADR 006) would need site changes.
3. A generic `list(kind)` / `readFile(kind, id, name)`. Ready for works, but types every content kind
   as the same shape before works exist.

Tenant config:
1. **Optional, strict `site:` section with tenant-agnostic roles** (chosen).
2. Required `site:`. Forces every tenant, including bot-only groups, to have a website.
3. Loose (passthrough) schema. Typos in theme keys would pass silently.

## Decision
- `ContentStore.listPosts(tenantId): Promise<Post[]>` returns every post of the tenant, newest first by
  `date` compared as instants, ties broken by id descending (`compareNewestFirst` in `core`, shared by
  all stores). A post is in the store only after approval and the publish run, so "in the store" is
  "published"; channel delivery status stays in the ledger. A broken post fails the listing with its
  folder name (a build must fail loudly, not drop a post).
- `ContentStore.readPostPhoto(tenantId, postId, fileName): Promise<Uint8Array | undefined>`: photos are
  addressed by the names in `post.photos`; the store serves only declared names and never exposes
  paths. The site copies the bytes into its build output and makes its own URLs.
- Works and collections get their own `listWorks`/`readWorkPhoto`-style pair when T36 adds the types.
- `site:` is optional in `TenantConfig` (type `SiteConfig`); the site build refuses a tenant without it.
  Keys: `baseUrl` (https origin, no path or trailing slash; T40 builds canonical URLs from it),
  `defaultLanguage` (must be a tenant language; served at `/`, other languages under `/<lang>/`),
  `theme.colors` (`paper`, `ink`, `muted`, `rule`, all `#RRGGBB`), `theme.fonts` (`display`, `body`
  family names, self-hosted by the site, no font CDN), optional `circle` (`joinUrl`, `texts` per tenant
  language with `title`, `what`, `where`; "when" is rendered from `meetingSchedule`). Every object is
  strict. Per-work accent colours belong to works, not to the theme. The secret-value check covers the
  section like the rest of the file.

## Consequences
- The Worker parses tenant YAML from `main` with a strict schema, so the bot must be redeployed right
  after this change merges; until then the old bot rejects the `site:` key and cron ticks fail.
- The `circle.joinUrl` of the first tenant is a marked placeholder until the public channel link is
  known; the circle texts are drafts for the author to confirm. Both must be final before go-live (T41).
- A new store implementation must pass the extended `describeContentStoreContract`.
