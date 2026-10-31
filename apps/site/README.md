# apps/site

Static Astro site for a tenant (T35, ADR 011 and 016). No tenant-specific code: name, colours,
fonts, languages and the circle page come from `config/tenants/<id>.yaml` (`site:` section), posts
from the `ContentStore`.

## Routes

| Path (default language `de`) | Page |
|---|---|
| `/`, `/uk/` | home: wordmark and the blog feed |
| `/posts/<post id, lowercase>/`, `/uk/posts/...` | one post (the canonical URL used by T40) |
| `/kreis/`, `/uk/kreis/` | the circle page, only if `site.circle` is set |
| `/media/<post id>/<file>` | photos, written from the store at build time |

The default language comes from `site.defaultLanguage`, other tenant languages live under
`/<lang>/`. A post appears only in languages it has text for. Only posts of type `free` are on the
blog (`siteVisibleTypes` in `src/lib/site-data.ts`); announcements, reminders and polls stay in channels.

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

## Manual deploy (until T39 adds the workflow)

```sh
pnpm --filter @handmake/site build
npx wrangler pages deploy apps/site/dist --project-name <pages-project> --branch main
```

Needs a Cloudflare API token scoped to Pages (H10). The site stays `noindex` until T41.
