# 011 — Website: Astro static site on Cloudflare Pages, built after each publish

Status: accepted (with architecture v3) · Date: 2026-10-28

## Context
Spec v5 F22-F24: a bilingual author showcase (about, collections, blog, contest, legal pages), rebuilt
after each publish, themed per tenant. Budget 0-10 EUR/month. ADR 001 already reserved `apps/site`
(Astro). The Impressum address (Q2) and contest display names (ADR 010) must not be in Git.

## Options
Hosting:
1. **Cloudflare Pages.** Free, same account as the Worker, preview deployments per branch, custom
   domain, deploy from Actions with `wrangler pages deploy`.
2. GitHub Pages. Free, but one site per repo and no preview deployments; weaker for multi-tenant.
3. Vercel/Netlify. Free tiers, another vendor and account.

Build trigger:
1. **A `site` job in the publish workflow (and a manual/`workflow_dispatch` entry).** Commits pushed
   with `GITHUB_TOKEN` do not trigger other workflows, so a `push` trigger on `content/**` would not
   fire for bot commits.
2. `workflow_run` on Publish. Works, but splits one logical run into two.

## Decision
Astro (static output) in `apps/site`, deployed to **Cloudflare Pages**; built by a `site` job that
runs after the publish job and on `workflow_dispatch`.
- Content comes from the `ContentStore` (Git for the circle): posts, works, collections, contest
  results. Pages per language under `/uk/` and `/de/`.
- Secrets at build time: Impressum fields from GitHub Secrets; contest display names from the Worker
  endpoint `GET /internal/contest-names` (HMAC, same scheme as the publish callback).
- Tenant theme (`site:` section in tenant config: name, colours, logo path, languages, nav) drives
  layout; no tenant-specific code in `apps/site`.
- Collections (`content/collections/<slug>.md`) and works (`content/works/<id>/index.md` + photos) are
  new content types (architecture v3, section 3), created through the bot (`work` draft type).
- Legal pages are drafts; the site does not go live until Volodymyr confirms them (spec Q2, 7).

## Consequences
- New secrets: `CLOUDFLARE_API_TOKEN` (Pages deploy only), `CLOUDFLARE_ACCOUNT_ID`, Impressum fields.
- The publish workflow file changes: a sensitive PR (AGENTS.md), needs Volodymyr's OK.
- Another tenant gets its own Pages project and config, same code.
