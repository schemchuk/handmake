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

Work descriptions and collection titles/descriptions are authored content. Only AI-generated descriptions
carry a public AI note. Photo posts, works and shows carry a localized authenticity label;
AI-assisted translation provenance remains internal. Shows also retain their generated-model disclosure. Work titles in
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

Gabriela (display) and Onest (body), each with Latin and Cyrillic subsets, are self-hosted via
`@fontsource/gabriela` and `@fontsource-variable/onest`; no font CDN is contacted (GDPR). `fonts.display` and `fonts.body` in the
tenant config name the preferred family; both configured families must be bundled.

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

## Shows

Published shows are read through `ShowContentStore`, linked to their real work, and listed newest
first at `/shows/` and `/uk/shows/`. Only existing language versions receive detail routes; the
home page highlights the latest show available in its language. Each generated image and video
has a visible `KI-generiertes Model` caption. Fictional persona names come from the approved show
snapshot. A work link appears only when that work has the current language version.

`/show-media/<id>/<file>` serves declared approved media without resizing or re-encoding, preserving
embedded marking evidence byte for byte. Missing declared media or a dangling work reference fails
the build. The site does not read private generation storage or start generation. Publication-time
marker verification remains the publisher's responsibility.

## Legal pages and go-live (T41)

The reviewed generator sources are in `docs/legal/`; preserve their attribution.
`services.de.html` contains project-specific additions awaiting Volodymyr and the
 author's review. German legal text is served on both language routes. These drafts
are not a final legal assessment; confirm provider coverage, legal bases, transfers
and retention against the actual configuration before approval.

Local and CI builds use named placeholders when legal fields are absent. The deploy
workflow requires all four `IMPRESSUM_*` secrets (see `.env.example`). Values are
HTML-escaped and never intentionally logged. GitHub masks secret values; do not
upload the generated site as a CI artifact or paste its legal pages into PR comments.
The published legal pages necessarily disclose the supplied contact information.

Every Astro build checks generated HTML and CSS for external resources; only our
origin is allowed. Ordinary external links in legal texts are allowed. Statistics
come from Cloudflare zone traffic data without a browser script; keep Pages Web
Analytics disabled and verify the deployed page has no beacon. Root `404.html`
disables Pages' SPA fallback; localized `/uk/404/` is also available.

Go-live checklist (record evidence in the T41 PR):

1. Review `/impressum/`, `/datenschutz/` and their `/uk/` versions with real values
   privately. Record Volodymyr's and the author's explicit approvals without values.
2. Resolve the carried review note about test-channel posts reaching the public site
   (`docs/review-notes.md`); confirm the content intended to be indexed.
3. After both approvals, set `SITE_INDEXABLE: 'true'` in `site.yml` in a reviewed
   follow-up commit. Builds then require legal fields, reject configured placeholders,
   remove `noindex`, allow crawling and generate `sitemap.xml`.
4. The reviewer merges only after CI passes and Volodymyr explicitly authorizes this
   sensitive PR. Run Site, verify HTTPS, legal links, analytics, sitemap and an unknown
   URL returning HTTP 404. Until then the deploy workflow keeps indexing disabled.

Technical sources for the additions:
[Cloudflare analytics](https://developers.cloudflare.com/web-analytics/about/),
[Cloudflare privacy](https://www.cloudflare.com/privacypolicy/),
[Telegram privacy](https://telegram.org/privacy).

Posts with frontmatter `siteExcluded: true` have no site pages, list entries, media
routes or sitemap entries. Test-channel publish runs set it automatically (works and
shows too); the flag is sticky per content id — a draft first published to the test
channel stays `siteExcluded` on a later live re-dispatch with the same draft id, and
retries preserve it. Existing posts without the field remain visible.

Channel copies carry a canonical link to their site page from the moment they are
delivered (T40), but this workflow deploys only after the publish job, so the link can
briefly point to a page that does not exist yet. Recovery is a manual Site run (above);
the publish run itself never needs a re-run for this.

T48 newsletter integration uses optional tenant `site.newsletter.formAction`. The localized form on
work/show detail pages posts directly to Brevo with `EMAIL`, an empty `email_address_check`, `locale`
and `html_type=simple`. It has no JavaScript, provider assets, server endpoint or subscriber logging.
The build policy allows only the exact form action from tenant configuration with POST. Tenants without newsletter
configuration keep their channel CTA. The PDF in `public/geschenk/rosenbluete.pdf` is the approved
original, copied without changes; it is publicly downloadable, not protected by confirmation.

Before the sensitive T48 merge, record these checks in the PR (no addresses or confirmation URLs):

1. Confirm the new German Datenschutz newsletter section and draft Brevo provider details with
   Volodymyr and the author; verify the entity/address against the account DPA.
2. Confirm one German DOI email for both site languages, or provide a separate Ukrainian form.
3. Submit the form in a browser using an operator-controlled test address. Verify the non-JS success
   response in both languages, exactly one confirmation email, and no subscription before the click.
4. Follow the email link, verify `/geschenk/` and the two-page German PDF, then test unsubscribe.
   Direct PDF access remains public by design. Do not record the address or unique links.

Provider inspection on 2026-11-11: GET with browser User-Agent returned HTTP 200 and matching form
fields/action. Plain URL-encoded empty POST (`html_type=simple`, `locale=de`) returned HTTP 400,
`application/json`, with the configured German EMAIL validation message. Thus server validation
errors can appear as JSON after navigation; native required/email validation prevents the common
empty/malformed cases. Successful non-JS POST and mail delivery are still manual acceptance gates.
No live subscriber was created during automated inspection. Default urllib GET returned HTTP 403.

Provider sources: [EU storage](https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location),
[DPA location](https://help.brevo.com/hc/en-us/articles/15403782599570-Where-can-I-find-the-Data-Processing-Agreement-DPA).
The legal pages themselves blocked automated retrieval; the draft entity/address needs account-DPA
confirmation before go-live. Legal additions are review inputs, not final legal advice.
