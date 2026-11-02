# STATUS

- **Active agent:** codex
- **Current task:** T44e4c — explicit generation start and private inputs (Owner codex, Reviewer claude-code).
- **Branch:** none yet (`feat/t44e4c-<slug>` from `main`).
- **Last commit:** `eae36a4` — feat: collect show originals and configuration (#56).
- **Next step:** Codex: start T44e4c in a fresh session. Revalidate `extras.showInput` (work, config, 2-3 originals, persona) before resolving private media and dispatching with a canonical tenant/show/version payload. Read docs/review-notes.md "Show input menus (T44e4b)". No deploy or paid calls; do not touch secrets/vars/migrations. Deploy waits for T44e4c and Volodymyr's explicit OK.
- **Blocked on:** nothing for implementation. migration 0008 applied to remote D1 (2026-11-02, Volodymyr's OK; additive table only, bot not yet redeployed); show secrets/vars are installed (2026-11-02): GitHub secrets `FAL_KEY` (set by Volodymyr) and `SHOW_TRANSPORT_SECRET`, vars `SHOW_WORKER_ORIGIN`, `SHOW_ALLOW_PAID_CALLS=true`, `SHOW_VERIFIED_MODELS` (the two ADR 015 models, opened 2026-11-02 after Volodymyr confirmed terms and prepaid billing); Worker secret `SHOW_TRANSPORT_SECRET` (same value). Private R2 bucket `handmake-show` created (2026-11-02, free tier; binding `SHOW_MEDIA` merged in PR #55, not yet deployed); paid gates are open but nothing can run until deploy and T44e4c.
- **Open questions for Volodymyr:** none now. Actual persona identities/reference media remain configuration work before production shows.
- **POSSE discussion, round 1 answered (2026-10-30):**
  1. Why own-site-first: (c) the author's future business + (d) portfolio.
  2. Domains Volodymyr owns: eko-flow.de, couchhelp.eu, coachhelp.de. None matches a crafts brand;
     fadenundstimmung.de and faden-und-stimmung.de are free (whois 2026-10-30).
  Findings so far: content already lands in Git first and the site is planned from it (ADR 011), so
  POSSE means (1) moving T35 site scaffold ahead of T26-T34, (2) a new feature: every channel post links
  to its canonical site URL (post id is stable, URL known before the rebuild), (3) a custom domain.
  Fediverse adapter is a later option. Outcome goes into spec/tasks after round 2.
- **Round 2 answered (2026-10-30):** business name = «Faden und Stimmung» (so domain candidate
  fadenundstimmung.de); social audience may widen to all German-speaking regions (DACH). The site is
  the author's own "model agency": regular shows of her works worn/presented by AI-generated models.
  The circle may get a small section or none. Extends spec v5 vision ("site presents the author and
  her collections like a small agency").
- **Round 3 answered (2026-10-30, corrected):** only real works are shown (no fully generated
  items): clothing decorated with the author's embroidery, embroidered pillows, her embroideries,
  small appliqués and small accessories. Implies try-on/compositing from real photos, AI label on
  every image. Three show templates: worn (embroidered clothing), held/close-up (appliqués,
  accessories), interior scene (pillows, embroideries).
- **Round 4 answered (2026-10-30):** format accepted: one show = one work, 3-5 images + 1 short
  video, every 1-2 weeks, author sends 2-3 photos to the bot, approves like any post, published to the
  site first, then copied to Instagram and Telegram.
- **Round 5 answered (2026-10-30):** order accepted: (1) site scaffold + domain with real photos and
  existing posts, canonical links from channel posts; (2) AI show pipeline; (3) Instagram (T26-T34) as
  a copy of the site, DACH audience.
- **Round 6 answered (2026-10-30):** site languages: German default (DACH, search), Ukrainian under
  /uk/ via the existing translation step, no English for now.
- **Round 7 answered (2026-10-30):** one page /kreis/ (what, when, where, Telegram link), no
  participants' works or contest results on the site. The whole site targets all German-speaking
  regions (DE/AT/CH), not Landshut: the circle is local, but its work is shown to everyone. Search
  focus = brand and works, not local keywords.
- **Round 8 answered (2026-10-30):** AI budget 20 EUR/month target with 5 EUR tolerance: the bot
  warns the operator at 20 EUR, stops new shows at 25 EUR until next month. The bot shows the
  bookkeeping: a cost command for the operator (spent this month, per show, per service, left) plus
  a monthly summary on the 1st. Prices still to verify in the show-pipeline task.
- **Round 9 answered (2026-10-30):** 2-3 fixed fictional adult models for now; models and their
  number must be changeable (config, not code). Looks and names decided in the show-pipeline task.
- **Discussion closed.** Next: spec v6 + tasks v4 from rounds 1-9 for Volodymyr's approval.
  Domain fadenundstimmung.de registered by Volodymyr at INWX (2026-10-30). Zone added in Cloudflare
  (Free) and nameservers switched at INWX to dahlia/khalid.ns.cloudflare.com (2026-10-30, verified
  with dig). Zone confirmed Active (Free, full DNS). Spec v6 + tasks v4 drafted: docs/01-spec.md, docs/03-tasks.md (order: T35, T39-T42, T36, T43-T46, then Instagram and contest). Human tasks now: H13 (photos of 3 works), H10 (Pages project).

## Reminders
- T44e4a validation: bot 368 tests and core 213 tests pass; workspace typecheck/build, lint, formatting and staged secret scan pass. Selection only: no generation dispatch, paid calls, workflow changes, migration or deploy.
- T44e3 validation: full bot suite 350 tests; final transport suite 27 tests (three originals and real fal adapter with mocked HTTP); publisher 137 and AI 116 tests pass. Workspace typecheck/build, lint, format and actionlint pass. No paid calls or deploy.
- T44e1 review-fix validation: bot 324 tests and core 213 tests passed; workspace typecheck, lint and format passed. Five invalid-billing cases assert an unchanged draft and a successful corrected retry; a controlled stale-callback interleaving verifies that another draft can acquire the tenant lock. Commit secret scan passed.
- T44d3 validation: publisher 137 and bot 303 tests pass (bot uses `--maxWorkers 1` locally); format, lint, workspace typecheck/build and actionlint pass. Real PNG/JPEG/WebP and MP4 tests cover per-frame labels, metadata tampering, retries and separate R2 persistence. No paid calls or deploy.
- If `main` ever gets branch protection or a ruleset, allow `github-actions[bot]` to push (content/ only), otherwise publish cannot commit. Checked at the T11 merge (2026-10-24): `main` is not protected.
- Bot deploy: `cd apps/bot && pnpm run deploy` (`pnpm deploy` is a built-in pnpm command). Apply D1
  migrations first: `pnpm run db:migrate`.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
Moved to docs/review-notes.md (ADR 009). Read it only when your task touches an area it names.

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21); v3 approved 2026-10-28 (T25-T38). T00-T21 and T25 done (MVP live 2026-10-27; T21 merged as PR #31). History: `git log --merges` / GitHub PRs.
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
- Agent context budget, no code graph: ADR 009 (2026-10-27).
- Spec v5 approved 2026-10-28; architecture v3.1 + ADR 010-014 approved 2026-10-28 after review:
  docs/reviews/2026-10-28-v5-review.md (approve with changes, B1-B3).
