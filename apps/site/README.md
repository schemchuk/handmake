# apps/site

Static Astro site for a tenant (T35, ADR 011 and 016). No tenant-specific code: name, colours,
fonts, languages and the circle page come from `config/tenants/<id>.yaml` (`site:` section), posts
from the `ContentStore`.

## Routes

| Path (default language `de`) | Page |
|---|---|
| `/`, `/uk/` | home: wordmark and the blog feed |
| `/posts/<post id, lowercase>/`, `/uk/posts/...` | one post (the canonical URL used by T40) |
| `/works/`, `/uk/works/` | works, newest first; localized work details at `<id>/` |
| `/collections/`, `/uk/collections/` | collections in configured order; localized details at `<slug>/` |
| `/work-media/<work id>/<file>/<width>.webp` | optimized declared work photos |
| `/kreis/`, `/uk/kreis/` | the circle page, only if `site.circle` is set |
| `/media/<post id>/<file>` | photos, written from the store at build time |

The default language comes from `site.defaultLanguage`, other tenant languages live under
`/<lang>/`. A post appears only in languages it has text for. Only posts of type `free` are on the
blog (`siteVisibleTypes` in `src/lib/site-data.ts`); announcements, reminders and polls stay in channels.

## Portfolio content

Works and collections come through `ContentStore.listWorks`, `listCollections` and
`readWorkPhoto`. A missing translation omits the item from that language's listing and produces
no detail route or language-switch link. Collection membership uses the work's `collection` slug;
a missing collection, dangling cover or missing declared photo fails the build.

Work descriptions and collection titles/descriptions are authored content. Non-human descriptions
carry a localized provenance label; it does not describe the authentic photos. Work titles in
metadata and cards are excerpts of the stored description.

Sharp auto-orients declared photos and generates WebP variants at up to 480, 960 and 1440 pixels
without upscaling; `srcset` serves them responsively. Output strips image metadata and leaves
original bytes in the content store unchanged. Regular blog photos still use their existing media
route without this optimization. Tests build an isolated tenant with structural fixtures only.

## Build

```sh
pnpm --filter @handmake/site build     # output in apps/site/dist
pnpm --filter @handmake/site dev
```

Environment (all optional):

- `SITE_TENANT`: tenant id; required when `config/tenants/` holds more than one file.
- `SITE_REPO_ROOT`: repo root; default is found by walking up to `pnpm-workspace.yaml`.
- `SITE_INDEXABLE=true`: removes `noindex`. Leave unset until the go-live checklist (T41).

Astro 6 is used because Astro 7 needs Node >= 22.23.4 and this repo runs on 22.23.2.

## Fonts

Familjen Grotesk (Latin) and Onest (Cyrillic, because Familjen Grotesk has none) are self-hosted via
`@fontsource-variable/*`; no font CDN is contacted (GDPR). `fonts.display` and `fonts.body` in the
tenant config name the preferred family; the bundled faces always load behind it.

## CI deploy

The `Site` workflow builds the latest `main` and deploys `apps/site/dist` to the
existing Cloudflare Pages Direct Upload project `fadenundstimmung` (production
branch `main`). `Publish` calls it only after its publish job succeeds, so the
checkout includes the newly committed content. Site deployments are serialized
with concurrency group `site`; the workflow never commits repository changes.

GitHub Secrets `CLOUDFLARE_API_TOKEN` (scoped to Pages) and
`CLOUDFLARE_ACCOUNT_ID` are required. Domain attachment and DNS are managed
manually by Volodymyr after review, outside this workflow.

To rebuild without publishing a post: open **Actions → Site → Run workflow**,
select `main`, and run without inputs or a payload. Check the build and deployment
steps and the resulting Pages URL. The site stays `noindex` with no sitemap until
T41; this workflow does not enable indexing.

## Manual deploy

For a local deployment with the same installed, lockfile-pinned Wrangler:

```sh
pnpm --filter @handmake/site build
PATH="$PWD/apps/bot/node_modules/.bin:$PATH" wrangler pages deploy apps/site/dist --project-name fadenundstimmung --branch main
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.
If deployment requests `--force` or delegates to Workers, stop and ask Volodymyr;
do not add the flag or expand token permissions.
