# STATUS

- **Active agent:** kimi-code
- **Current task:** T49c3 — author reply handling + legal draft (`bot`, docs/legal)
- **Branch:** none yet (`feat/t49c3-<slug>`)
- **Last commit:** `3d33793` — feat(bot): collect comments and wire Worker inbox (#101)
- **Next step:** kimi-code starts T49c3 in a fresh session (docs/03-tasks.md), including the
  "Review notes from PR #101" line. Sensitive: Volodymyr's OK before merge.
- **T49c2b live:** migration 0009 applied to remote D1 by Volodymyr; bot deployed 2026-11-09.
  Volodymyr accepted collecting before the F34 Datenschutz paragraph (T49c3) and the token scope check (2026-11-09).
  The first tick without a watermark drafts (paid) and cards every comment of the last 30 days
  on the 25 newest posts per network.
- **T49c2b validation:** all 584 bot tests covered across runs (full 582/584, corrected final
  changed suites 45/45, --maxWorkers 1); channels 210/210. Workspace typecheck, ESLint,
  Prettier and staged secret scan pass. Sandbox Miniflare stalled; unrestricted runs completed.
  No deployment, remote migration, paid calls, publishing or secret changes.
- **T49c2a validation:** bot 575/575 (--maxWorkers 1), including 16 local D1 store
  tests; AI 139/139 and channels 209/209. Workspace typecheck, ESLint, Prettier
  and staged secret scans pass. Sandboxed Miniflare initialization stalled;
  unrestricted full bot rerun passed. No deploy, remote migration, paid calls,
  live publishing or secret changes. Original WIP branch remains intact.
- **Bot Worker:** `4599dc95-95db-4461-9b7a-7ecd64c43bad` (deployed by claude-code after PR #101, 2026-11-09).
- **Blocked on:** T48 waits on H15. T26c unblocked: Threads secrets are in GitHub Secrets since 2026-11-09.
- **Open questions for Volodymyr:** author should reread the changed analytics paragraph in the Datenschutzerklärung; draft
  retention policy remains open; idea "real model show without AI label" recorded under Later in
  docs/03-tasks.md, needs a spec decision. T49c go-live (before the first live comment collect):
  the Instagram System User token must carry `instagram_manage_comments`, and the F34
  reader-data paragraph must be added to the Datenschutzerklärung (draft in T49c3, marked for review).
- **T49b validation (PR #98):** channels 205/205 (22 new comments tests — list posts
  /comments/reply per network, watermark as unix `since`, paging bound + early stop,
  malformed pages/reply, per-call 429 retry + exhaustion, 190 refresh once per run,
  empty-secret and argument validation, no reader data in errors), core 233/233.
  Workspace typecheck/build, `eslint .`, `prettier --check .` and staged gitleaks pass.
  New optional `ChannelAdapter.comments` port + shared `meta/comments.ts`; Instagram
  (`/{user}/media`, `/{media}/comments`, `/{comment}/replies`) and Facebook
  (`/{page}/feed` our-posts-only, `/{post}/comments` reader-only, `/{comment}/comments`).
  Mocked Graph API only — no live Meta calls, no deploy, no secret or workflow changes.
- **T49a validation (PR #97):** channels 183/183 (new: renderFacebookShow rejects 0 and 11
  show images at render time), bot 559/559 with `--maxWorkers 1` (new: 6 Facebook-block preview
  tests — caption length + clickable canonical link line, no-link state, three skip reasons,
  absent settings), publisher 220/220 (push counts now 1 per run; the push-rejection test
  rewritten: a rejected push fails the first Meta channel — Instagram — and the ledger-driven
  resume delivers Facebook), core 233/233. Workspace typecheck, `eslint .`, `prettier --check .`
  pass. The T49 split (T49a-T49c) is recorded in docs/03-tasks.md (`6cf5552` on main).
  No workflow, secret, tenant-config, deploy or live-call changes.
- **T26b validation:** channels 181/181 (new: facebook-render 26, facebook-adapter 19; the
  Instagram adapter refactored onto the shared MetaGraphClient with its 47 tests unchanged and
  green), publisher 220/220 (new facebook-publish 7: plain raw-GitHub URLs, no framed copies,
  push gating, delivery- and push-failure isolation, ledger re-run skip, show-copy URLs;
  instagram-publish updated for the facebook-enabled tenant), core 233/233 (facebook schema key +
  language guard), bot 553/553 (work-session announce-yes lists all three channels; full suite
  green only with `--maxWorkers 1` — default workers hit random 5s timeouts from contention),
  site 50/50, ai 121/121, stores 46/46. Workspace typecheck/build, eslint, changed-file prettier
  and staged gitleaks pass; publish.yml parses (actionlint runs in CI). Mocked Graph API only — no
  live Meta calls, no deploy, no secret changes.
- **T26a3 validation:** channels 136/136 (new: call-level 429 retry keeps earlier carousel children,
  link_preview_options on text messages, site-excluded show renders without the show link), publisher
  213/213 (new: URL builder, real-sharp 1080x1350 framing, runPublish/runCopyShow wiring with mocked
  adapters, push gating and push-failure isolation), core 232/232, bot 553/553 (full suite green only
  with `--maxWorkers 1` — default workers hit random 5s timeouts from contention; each failing file
  passes in isolation), site 50/50, ai 121/121. Workspace typecheck/build, eslint, actionlint,
  changed-file prettier and staged gitleaks pass. Mocked Graph API only — no live Meta calls, no
  deploy, no secret changes.
- **T47f validation:** transport suite passes 10 consecutive local runs (55/55 each, real D1/R2); show-session 46/46 and publisher callback 10/10 pass. Workspace typecheck/build, lint and changed-file formatting pass. The target test now allows 30 seconds for sequential storage operations and bounded R2 throttle retries. Work callback coverage pins the transient publication projection; the discarded awaited-work condition is named. Initial non-TTY Miniflare runs stalled and were interrupted; TTY runs completed. The initial concurrent callback run timed out; final rerun used a 30-second CLI limit after correcting the new expected work kind. No deployment, production publishing, workflows, migrations, paid calls or secrets changed.
- **Viability check (2026-11-04):** goal order changed to audience and business first, portfolio as by-product; checkpoints after 4 shows (~mid-December) and 2027-01-21; legal safety first. Record: docs/00-interview.md round 6, spec v7 section 14.
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
- T26a2 (PR #94): channels 133/133 (26 new: instagram-adapter 20, meta-token 6), core 232/232,
  publisher 191/191; workspace typecheck/build, lint, changed-file formatting and staged gitleaks
  pass. Mocked Graph API only — no live calls, no real secrets, no deploy, no workflow changes.
- T50: core 232/232, site 50/50 (incl. new group-link build test), workspace typecheck/build, lint and changed-file formatting pass; staged gitleaks clean. Site builds with and without `site.groupUrl`; the real config sets the group invite `https://t.me/+Q7txJldGFzh0Wy` (valid per its t.me page, read from Volodymyr's screenshot — he double-checks the characters). The site fixture tenant drops the real link like it drops the circle. One CI run failed on exactly that leak; fixed in `92a9265`, CI green on PR #90. No bot, D1, publisher, workflow, deploy or secret change. Rules (DE/UK) and the Datenschutzerklärung group paragraph are drafts for the author / Volodymyr.
- T47b PR #84 fixes: show approval, published callback and draft-store suites 74/74; bot typecheck/build, workspace lint and changed-file formatting pass. Both initial approve and frozen dispatch retry persist approvalChatId; non-free posts omit site links; failed Telegram notices log only HTTP status. The unwritten extras.siteExcluded check was removed; site exclusion propagation remains T47d. No deployment, production publication, migrations, workflows, paid calls or secret changes.
- T47b validation: 124 targeted bot tests covered across runs (final callback/preview 21/21), publisher 180/180 plus final publish 7/7; workspace typecheck/build, lint, changed-file formatting and staged gitleaks pass. Initial sandbox bot invocation selected the full suite and was stopped after local-service initialization stalls; targeted D1 suites passed outside the sandbox. Publication result uses the approving chat captured atomically with the publishing claim; shows now capture approvalChatId on both initial consent and retry. Callback notices are at most once: failure or interruption after the state transition is not retried. Config failure falls back to a result without a link and a preview without settings. No deployment, production publishing, workflows, migrations, paid calls or secret changes.
- T47a validation: 147 targeted bot tests covered across runs (final bot handler rerun 52/52); work-session also passed in the earlier targeted run. Core 215/215 and site 46/46 pass; workspace typecheck/build, lint, changed-file formatting and staged gitleaks pass. Earlier in-flight bot runs loaded the pre-fix handler/old hand-off assertion; the final handler rerun verifies publication winning after edit lookup. Sandboxed Miniflare stalled and Astro child diagnostics were unavailable; integration tests ran outside the sandbox. Site fixture URLs now satisfy the new equality guard. No deployment, production publishing, migrations, workflows, paid calls or secret changes.
- T47g validation: channels 68/68, core 214/214, site 46/46 and publisher 180/180 pass. Workspace typecheck/build, lint and changed-file formatting checked. The sandboxed site malformed-document test lost child-process diagnostics; unrestricted full rerun passed. Site fixture checks every generated HTML page and localized post/work/show detail links; Telegram tests cover optional settings, caption/message limits and persisted show-copy footer. No deployment or production publishing.
- T41b validation: site 46/46, publisher 180/180, core 213/213; workspace typecheck/build, lint, formatting and actionlint pass. Sandboxed site malformed-document test lost child-process diagnostics; unrestricted full rerun passed. Initial concurrent tests hit five-second timeouts; publisher passed with one worker and 30-second limit. Existing publisher test File type mismatch fixed by inferred narrowing. No deploy, publishing or paid calls. PR #80 commit 89640da code review recorded in review-notes.md.
- T44e11 review-fix validation: full bot 505/505 and publisher 180/180 tests pass; workspace typecheck/build, lint and changed-file formatting pass. Sandbox transport run could not bind Miniflare (EPERM); full bot suite passed outside the sandbox. Only the explicit bounded finish response `unfinished job` gets a typed rejection; other Worker 409 errors retain the generic message and ambiguous delivery keeps successful execution green. Two real D1/R2 Worker regressions cover both paths. No deployment, workflows, paid calls, migrations, Worker runtime or secrets changed.
- PR #78 review fix: failed finish callbacks now use `retry`, collecting uses `start`, other states omit resume. Two D1-backed session tests route the actual finish notification button for paid-gate and failed outcomes through the bot. Session 48/48, notification 8/8 and publisher finish 4/4 tests pass; bot/publisher typecheck and changed-file lint/format pass. Ready-notification failures leave successful generation/recovery green; finish nonce idempotence is documented inline. No deploy, production dispatch, paid calls, workflows or secrets changed in this fix.
- T44e10 validation: transport 48/48 across the full 47-test rerun and one added pending-grant test; approval 13/13, notification 5/5, publisher 177/177 pass. Workspace typecheck/build, changed-file lint/format, actionlint and staged secret scan pass. Initial new media test exceeded the default five-second timeout and contaminated a later assertion; the corrected full transport rerun passed. Sandbox Miniflare bind was denied; integration runs passed outside the sandbox. Finish claims delivery before Telegram (at most once); ambiguous delivery is not retried automatically. No deploy, production dispatch, paid calls, migrations or secret/var changes.
- T44e9: 51/51 targeted approval/transport tests passed with local D1/R2; final backfill regressions 2/2 passed after executor failure reporting. Workspace typecheck/build and changed-file lint/format pass; bot/publisher typecheck passed after executor failure reporting. Initial accidental full-suite run was stopped after an unrelated show-start concurrency failure. No deployment, workflows, paid calls or production bucket settings changed.
- T44e8 validation: approval/transport 50/50 plus the added dispatch-lease test 1/1 pass with local D1/R2. Mixed evidence sends no documents, failed dispatch retries, repeated refresh dispatches once, concurrent refresh and interrupted lease recovery are covered. Workspace typecheck/build and changed-file lint/format pass. The initial sandbox full-suite invocation was stopped after Miniflare failures; targeted unrestricted runs passed. No deployment, production dispatch, paid calls, workflows or secret changes.
- T44e7 validation: transport 37/37, approval and draft flow 58/58 pass with local D1/R2 and real marked media. Workspace typecheck/build, lint, changed-file formatting and staged gitleaks pass. Initial sandbox run could not initialize Miniflare; unrestricted targeted suites passed. The new test covers missing attestations, a fresh recovery job, unchanged attempts/cost rows, four document uploads, approval offered and tampered media rejection. No production backfill, deployment, paid calls, workflows, migrations or secret/var changes.
- PR #74 review fixes: grouped routing outputs and configured Git identity before both rebase/push loops. actionlint v1.7.12 with ShellCheck v0.11.0, workflow tests 11/11 and changed-file formatting pass. CI caught missing step env in the shell integration harness; the harness now passes the workflow env. Publisher 175/175 and publisher typecheck pass locally; full GitHub CI passed on `cfa7c6c` (run 41640589460). No deployment or publishing run.
- T46c validation: publisher 175/175 tests pass; workspace typecheck/build, lint, formatting and actionlint pass. Workflow guards/routing and a local Git remote with failed-progress push, fresh checkout and resumed copies are covered. Recovery and separately authorized smoke procedure: docs/show-copies.md. No remote deployment, dispatch, paid generation or production secret changes.
- T46b validation: publisher 160/160 plus the added operation-commit interruption case pass; channels 64/64, core 213/213 and stores 45/45 pass. Workspace typecheck/build, lint and formatting pass. Stored marked PNG/MP4 bytes, real Git ledger commits, failure/resume, config drift, tenant/progress guards and site callbacks are covered. Recovery: docs/show-copies.md. No workflow, deployment, production publishing, paid call or secret changes.
- T46a validation: channels 63/63 and core 213/213 tests pass; workspace typecheck/build, lint and formatting pass. Publisher 137/137 passes with one worker and a 30-second timeout after an initial 136/137 run with one timeout during concurrent build. Tests assert unchanged uploaded PNG/MP4 bytes using structural fixtures, not real Telegram playback or server-side preservation. No production publishing, paid calls, workflow, deployment or secret changes.
- PR #71 review: CI passed; local site tests 29/29 and site typecheck passed. The sandboxed run had one child-process diagnostic failure; the unrestricted rerun passed. MIME guard, indexed image alt text and latest-show selection reviewed. No workflow, secret, deployment or production changes.
- T45 validation: site 29/29 tests, workspace typecheck/build, lint, formatting and staged secret scan pass. Fixture builds cover localized show pages, AI captions, persona/work links, latest-show selection, escaping and byte-preserved PNG/MP4 delivery. Structural media fixtures do not test playback or re-verify markers; publisher verification remains the publication gate. No workflows, deployment, paid calls or production settings changed.
- T44e6c validation: full bot suite 479/479 and publisher 137/137 pass, including five new production-adapter publication integration cases with real local D1/R2, marked PNG/MP4 and Git commits. Workspace typecheck/build, lint, formatting and staged secret scan pass. Tests cover downloaded marker stripping/tampering, immutable dispatch and callback retries, persistence recovery, work linkage and tenant isolation. No runtime code, dependencies, workflows, secrets/vars, migrations, remote setup, deployment or paid calls changed. Parent T44e6/T44e gates await independent combined review; rollout checklist and evidence map: docs/show-deployment.md.
- T44e6b validation: 146/146 targeted bot tests pass (approval, session, verification transport, D1, runner and callback), including 11 new author-approval tests. Workspace typecheck/build, lint, formatting and staged secret scan pass. Initial full runs were interrupted; targeted real-media transport tests completed successfully. No deployment, paid calls, workflows, production secrets/vars or migrations changed. Approval consumes verified media sequentially; marker declaration constants remain duplicated in core/publisher for future cleanup.
- T44e6a validation: bot 463/463, core 213/213, publisher 137/137 and AI 117/117 pass; workspace typecheck/build, lint, formatting and staged secret scan pass. Signed verification evidence and current-generation resolution are implemented; approval/publication remain T44e6b/c. No deployment, paid calls, production secrets/vars, workflows or migrations changed.
- T44e5c validation: all 459 bot tests covered across runs (initial full run 457/458 with one invalid new fixture; corrected changed suites 120/120 plus final cancellation-journal test 1/1). AI 117/117, publisher 137/137; workspace typecheck/build, lint, format and staged secret scan pass. No deployment, paid calls, production secrets/vars, workflows or migrations changed.
- T44e5b validation: full bot run passed 452/453 with one invalid new fingerprint fixture; after correcting that fixture, the entire transport suite passed 29/29 (all 453 tests covered across the runs). Workspace typecheck/build, lint, formatting and staged secret scan pass. No deploy, paid call, workflow, secret or migration changes.
- T44e4c validation: bot 401 tests pass, including explicit start, private snapshots, stale/concurrent input, failed preparation/dispatch retry and signed Worker handoff. Workspace typecheck/build, lint, formatting and staged gitleaks scan pass. No deploy, paid calls, secrets/vars or migrations changed.
- T44e4a validation: bot 368 tests and core 213 tests pass; workspace typecheck/build, lint, formatting and staged secret scan pass. Selection only: no generation dispatch, paid calls, workflow changes, migration or deploy.
- T44e3 validation: full bot suite 350 tests; final transport suite 27 tests (three originals and real fal adapter with mocked HTTP); publisher 137 and AI 116 tests pass. Workspace typecheck/build, lint, format and actionlint pass. No paid calls or deploy.
- T44e1 review-fix validation: bot 324 tests and core 213 tests passed; workspace typecheck, lint and format passed. Five invalid-billing cases assert an unchanged draft and a successful corrected retry; a controlled stale-callback interleaving verifies that another draft can acquire the tenant lock. Commit secret scan passed.
- T44d3 validation: publisher 137 and bot 303 tests pass (bot uses `--maxWorkers 1` locally); format, lint, workspace typecheck/build and actionlint pass. Real PNG/JPEG/WebP and MP4 tests cover per-frame labels, metadata tampering, retries and separate R2 persistence. No paid calls or deploy.
- If `main` ever gets branch protection or a ruleset, allow `github-actions[bot]` to push (content/ only), otherwise publish cannot commit. Checked at the T11 merge (2026-10-24): `main` is not protected.
- Bot deploy: `cd apps/bot && pnpm run deploy` (`pnpm deploy` is a built-in pnpm command). Apply D1
  migrations first: `pnpm run db:migrate`.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

- T47e validation: 89 targeted bot tests covered across runs (initial run 88/89; corrected discarded-work reader fixture passed its final targeted rerun); publisher callback 8/8 and core 222/222 pass. Workspace typecheck/build, lint and changed-file formatting pass. Initial sandbox D1 run stalled and was interrupted; unrestricted targeted suites completed. No deployment or production publishing. Optional callback field requires the updated bot before excluded production publishing; reviewer deploys after merge.

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
