# 03 — Tasks

Small reviewable tasks with Owner, Reviewer, acceptance criteria and tests.

Status: **approved v5 (2026-11-04).** v5 follows spec v7 (audience first, legal safety first): T41
first, then an end-to-end check, then Instagram, Facebook and Threads together, email, comment inbox
and the contest on all networks; see "Order of work (v5)".
v4 (approved 2026-10-30) re-orders the work for spec v6
(POSSE: site first, then AI shows, then Instagram and contest) and adds T39-T46; see "Order of work (v4)".
v3 (approved 2026-10-28) re-plans phase 1b and phase 2 for spec v5 and
architecture v3.1, from the task split in docs/reviews/2026-10-28-v5-review.md. v2 (approved
2026-10-21) planned the MVP and T18-T24.
Scope of v2: MVP (spec section 5), Telegram only, built on the ports from architecture section 11.
Each task: one branch `feat/<id>-<slug>`, one PR, reviewable in 10-15 minutes. Do tasks in order unless
"Depends on" says otherwise. A task is done when its tests pass in CI, docs are updated, and the reviewer
agent merged it (AGENTS.md, Git rules; sensitive PRs such as T02 and T11 need Volodymyr's OK first).

## Human tasks (Volodymyr only: accounts and secrets)

Agents never create accounts or handle secret values. Each item unblocks the tasks listed.

| ID | What | Unblocks |
|---|---|---|
| H1 | Create a private **test** Telegram channel; add the bot as admin. Note both channel IDs. | T07, T17 |
| H2 | Cloudflare account; `wrangler login` locally. | T13 |
| H3 | Anthropic API key (console), spending limit set to 10 EUR. | T12, T15 |
| H4 | Fine-grained GitHub token: this repo only, permission "Contents: read and write" for `repository_dispatch`. | T16 |
| H5 | Put secrets into GitHub Secrets and Worker secrets (names in `.env.example`). | T11, T16 |
| H6 | ~~Decide O1 and O2~~ done 2026-10-21. | T05, T00, T10 |
| H7 | Random `PUBLISH_CALLBACK_SECRET` (e.g. `openssl rand -hex 32`) as GitHub Secret and Worker secret. | T19 |
| H8 | Meta (extended in v5): author switches her Instagram account to Creator or Business; a Facebook Page and a Threads profile for the brand; one Meta developer app with Instagram, Pages and Threads APIs; long-lived tokens and account/page IDs as secrets. Every profile links to the Impressum. | T26a-T26c, T49 |
| H9 | Random `NAMES_ENDPOINT_SECRET` (`openssl rand -hex 32`) as GitHub Secret and Worker secret. | T28 |
| H10 | Cloudflare Pages project; API token scoped to Pages deploy only; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Secrets. Domain fadenundstimmung.de is registered (INWX) and its zone is active on Cloudflare (done 2026-10-30); attaching it to Pages is part of T39. **Done 2026-10-31:** Pages project `fadenundstimmung` (Direct Upload, created with `wrangler pages project create --force`), both secrets set. | T39 |
| H11 | Impressum fields (author's name, home address, email) as GitHub Secrets `IMPRESSUM_NAME`, `IMPRESSUM_STREET` (street and house number), `IMPRESSUM_CITY` (postal code and city), `IMPRESSUM_EMAIL` (T41 adds these names to `.env.example`). The generator texts reach T41 with the placeholders `{{IMPRESSUM_NAME}}`, `{{IMPRESSUM_STREET}}`, `{{IMPRESSUM_CITY}}`, `{{IMPRESSUM_EMAIL}}` in place of the real values. Generate the Impressum and Datenschutzerklärung texts with a free generator by lawyers (for example datenschutz-generator.de or e-recht24), listing the processors from T41, and hand the result to the T41 owner; Volodymyr and the author confirm the final pages. **Done 2026-11-04:** the four secrets are set; texts in `docs/legal/` (`datenschutz.de.html` from datenschutz-generator.de free version, its attribution line must stay; `impressum.de.html` from e-recht24 free generator, Privatperson, §18 MStV line, no phone). The free Datenschutz modules cover hosting/CDN, logfiles, blog, email contact, web analytics, Instagram, Facebook Page and Threads; T41 adds short paragraphs for Cloudflare (named), Cloudflare Web Analytics and the Telegram channel, marked for Volodymyr's and the author's review. A shop later needs the paid license. | T41 |
| H14 | Enable Cloudflare Web Analytics for the Pages project `fadenundstimmung` (dashboard toggle, cookieless). **Done 2026-11-04:** enabled in the Pages project Metrics tab. **Reverted 2026-11-04:** Volodymyr disables it again (the JS beacon reads browser data, a §25 TDDDG consent risk); visits are read from the Cloudflare zone traffic statistics instead, which need no script; disabled and redeployed the same day (no beacon on the live site). | T41, T41b |
| H15 | Email service account with EU hosting and a data processing agreement (Brevo or MailerLite, decided in T48); the author prepares one free embroidery pattern as a PDF (lead magnet). | T48 |
| H13 | Author takes 2-3 good photos (daylight, flat, plus a close-up) of 3 real works: one clothing piece with embroidery, one pillow, one small appliqué or accessory. **Done 2026-11-01:** 11 photos of 3 works received (blouse with cross-stitch, crocheted pillow cover, crocheted flower appliqué), kept locally and NOT committed (public repo, author's works). Usable: blouse 1-3, pillow 1-2, appliqué 4 and 6; blurry or process shots skipped (pillow 3, appliqué 1-3, 5). Author's consent to send them to AI providers is still needed before T43. | T43 |
| H12 | Record a short screen video or GIF of the real flow (bot → preview → channel) on the test channel. | T34 |

## Tasks

### T00 — Allow content commits to main in AGENTS.md ✅ done 2026-10-21
- Owner: claude-code · Reviewer: Volodymyr · Depends on: H6 (O2 approved)
- Change: Git rules get an exception: the publish workflow may commit to `main` under `content/` only,
  as the bot identity. Branch protection note for Volodymyr.
- Acceptance: AGENTS.md and ADR 003 consistent; nothing else changed.
- Tests: n/a (docs).

### T01 — Workspace scaffold
- Owner: kimi-code · Reviewer: claude-code
- Change: pnpm workspace (`apps/bot`, `apps/publisher`, `packages/core`, `packages/channels`,
  `packages/stores`, `packages/ai`), TypeScript strict base config, ESLint + Prettier, Vitest, `.nvmrc` (Node LTS),
  root scripts `lint`, `typecheck`, `test`, `build`. Update `.vscode/extensions.json` with ESLint,
  Prettier, Vitest.
- Acceptance: `pnpm i && pnpm lint && pnpm typecheck && pnpm test` pass on a clean clone; each package
  has one trivial passing test.
- Tests: the trivial tests above.

### T02 — CI workflow
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01
- Change: `.github/workflows/ci.yml` on PR and push: install with cache, lint, typecheck, test, build,
  gitleaks secret scan. Minimal `permissions: contents: read`.
- Acceptance: CI is green on the PR; a commit with a fake token pattern in a test branch is flagged
  (show in the PR description, do not merge it).
- Tests: CI itself.

### T03 — Post schema and frontmatter I/O (`core`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01
- Change: zod schema for a post (architecture section 3: id ULID, tenant, date, publishAt, type, photos,
  channels, versions with provenance `human | ai-assisted | ai-generated`); `parsePost(md)` and
  `serializePost(post)` with `<!-- lang:xx -->` sections.
- Acceptance: round-trip `serialize(parse(x)) == x` for fixtures; invalid provenance or missing language
  section raises a clear error.
- Tests: unit tests with 3 valid and 4 invalid fixtures.

### T04 — Tenant config schema and loader (`core`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01
- Change: zod schema and loader for `config/tenants/*.yaml`: tenant ID and name, languages and order,
  enabled channels with per-channel settings (e.g. `instagram.language`), content store type, meeting
  schedule (weekday, time, IANA zone), work-of-week poll settings, feature flags, empty `offerings`,
  secret *names*. Add `config/tenants/faden-und-stimmung.yaml` (Thursday 14:00 Europe/Berlin, uk, de).
- Acceptance: loader rejects any key that looks like a secret value; the real config file validates;
  unknown channel keys are rejected against the channel registry's key list.
- Tests: unit tests for valid config, missing fields, unknown channel, secret-looking value, two tenants.

### T04b — Ports, channel registry and fakes (`core`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T03
- Change: TypeScript interfaces in `packages/core/ports` per architecture 11.1 (`ChannelAdapter` with
  `capabilities`, `render`, `deliver`, optional `openPoll`/`closePoll`; `ContentStore`; `DraftStore`;
  `PublishRunner`; `Translator`; `WinnerPicker`; `MediaSource`; `Notifier`; `SecretResolver`; `Clock`).
  `ChannelRegistry` (register, get, list keys). In-memory fakes for every port in `packages/core/testing`.
  Idempotency key helper `tenantId:postId:channel:opIndex`.
- Acceptance: no port imports any network, SDK or Node-only module; fakes satisfy the interfaces.
- Tests: registry tests (duplicate key rejected, unknown key error); fake contract tests reused later
  by real adapters.

### T05 — Telegram renderer and limits (`channels/telegram`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T04b
- Change: the pure `render(post, settings)` part of the Telegram `ChannelAdapter`, with declared
  `capabilities` (max 10 photos, caption 1024, message 4096, polls: true). It returns an ordered list of send operations: UA album with
  caption if ≤ 1024 chars else album + text message (≤ 4096); DE as a text-only reply to the UA album (O1). Text over 4096 → validation
  error (F9). Plain text, no parse mode in the MVP.
- Acceptance: the same function output is used later by the bot preview and the publisher.
- Tests: table tests for 0 / 1 / 10 photos, caption at 1024 / 1025 chars, text at 4096 / 4097 chars.

### T06 — Ledger model (`core`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T03
- Change: ledger type keyed by `tenantId` + `postId`, pure functions: `pendingChannels(ledger, post)`,
  `markDone`, `markFailed`; JSON (de)serialization.
- Acceptance: a channel marked `done` is never returned as pending; failures keep the last error.
- Tests: unit tests for all transitions, including a re-run after partial failure.

### T07 — Telegram adapter delivery (`channels/telegram`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T05, H1 for the manual check
- Change: `deliver(ops) → remote IDs` of the Telegram `ChannelAdapter` (interface from T04b), registered
  in the registry under `telegram`; implementation
  (`sendMediaGroup`, `sendMessage`, `reply_parameters`) with retry on 429 honouring `retry_after`.
  Bot token injected, never logged.
- Acceptance: tests run without network; a manual script posts a sample to the **test** channel.
- Tests: HTTP fixtures (success, 429 then success, 400 error).

### T08 — Photo processing (`publisher`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01
- Change: download by `file_id` via `getFile`; re-encode to JPEG, strip all metadata, max 2048 px long side.
- Acceptance: output has no EXIF/GPS; output dimensions respect the limit.
- Tests: fixture JPEG with GPS EXIF → output checked for no metadata; PNG and large image cases.

### T09 — Git-repo content store and dry-run (`stores/git-repo`, `publisher`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T03, T04, T05, T08
- Change: `GitRepoContentStore` implementing `ContentStore`. From a dispatch payload (tenant ID, draft ID,
  texts, file_ids, provenance) build
  `content/posts/<date>-<slug>/` with `index.md` and photos; `publisher --dry-run <payload.json>` prints
  the planned Telegram operations and writes nothing outside a temp dir.
- Acceptance: the folder validates with `parsePost`; dry-run output matches `renderTelegram`.
- Tests: unit test with a sample payload and mocked downloads; CI runs dry-run on `fixtures/sample-payload.json`.

### T10 — Delivery with ledger idempotency (`publisher`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T06, T07, T09, T00
- Change: `publisher publish <payload>`: composition root wires registry, store and notifier; build
  folder → commit → for each pending channel (from tenant config, via the registry) deliver →
  update ledger → commit ledger. Re-run with the same ID skips `done` channels.
- Acceptance: simulated failure on DE send → ledger `failed`; re-run sends only the missing operation.
- Tests: integration test with a fake adapter and a temp git repo.

### T11 — Publish workflow and alerts
- Owner: kimi-code · Reviewer: claude-code · Depends on: T10, H5
- Change: `.github/workflows/publish.yml`: triggers `repository_dispatch: publish-post` and
  `workflow_dispatch` (payload input); `concurrency: publish`; `permissions: contents: write`;
  operator alert to `OPERATOR_CHAT_ID` on failure; author notification on success.
- Acceptance: a manual `workflow_dispatch` with the sample payload publishes to the **test** channel;
  a second run does not duplicate.
- Tests: workflow lint (actionlint) in CI; manual run documented in the PR.
- Reviewer reminder (before merge): check `main` protection (`gh api repos/schemchuk/handmake/branches/main --jq .protected`).
  If protection or a ruleset is enabled, tell Volodymyr to allow `github-actions[bot]` to push to `main`
  (content/ only); otherwise the publish workflow cannot commit. Status 2026-10-21: not protected.

### T12 — AI translation and humanizer prompt (`ai`)
- Owner: claude-code · Reviewer: kimi-code · Depends on: T01, H3 for the live check
- Change: `ClaudeTranslator` implementing the `Translator` port: `translate(ukText) → { de, notes }`
  via the official Anthropic TypeScript SDK,
  structured output, model ID from config (default `claude-opus-5-5`); prompt
  `packages/ai/prompts/humanize-de@1.md` (translation + humanizer rules); 5 sample UA texts as an eval seed.
- Acceptance: unit tests with a mocked SDK; a manual eval run on the 5 samples is attached to the PR
  for Volodymyr and his wife to judge.
- Tests: mocked success, refusal / API error → typed error the bot can show (F7).

### T13 — Bot Worker skeleton
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01, H2
- Change: `apps/bot` with grammY on Cloudflare Workers, composition root, `wrangler.toml`, D1 migration
  (all tables keyed by `tenant_id`; drafts,
  publish requests), webhook secret-token check, allow-list from secrets mapping Telegram user ID → tenant, `/start` reply. Webhook
  setup script.
- Acceptance: non-allow-listed user gets a refusal and no D1 row is written (A6); wrong secret token → 401.
- Tests: unit tests of the middleware with grammY test utilities / mocked updates.

### T14 — Draft state machine (`bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T13
- Change: draft FSM in D1: `collecting → translating → ready → publishing → published | failed`;
  collect text + up to 10 photos (photo or document), `/new`, `/discard`; drafts older than 30 days deleted
  by a cron trigger.
- Acceptance: invalid transitions rejected; 11th photo politely refused.
- Tests: unit tests for the FSM (pure) and D1 repository against a local D1 (Miniflare).

### T15 — Preview, edit and regenerate (`bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T05, T12, T14
- Change: after collecting, call the `Translator` port in `waitUntil`; send preview built from
  `renderTelegram`; buttons Edit UA / Edit DE / Regenerate DE / Publish / Discard; edit by reply
  (ADR 005); limit warnings block Publish.
- Acceptance: A1 and A2 from the spec on the test bot.
- Tests: handler tests with mocked AI and Telegram API.

### T16 — Publish button, consent and dispatch (`bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T11, T15, H4
- Change: Publish → consent question → atomic `ready → publishing` → `PublishRunner.run` (implementation
  `GitHubActionsRunner` = `repository_dispatch`); status
  message "publishing…"; on dispatch failure revert to `ready` and inform.
- Acceptance: double press and webhook retry cause exactly one dispatch (A4).
- Tests: concurrency test on the D1 transition; mocked GitHub API.

### T17 — End-to-end check and runbook
- Owner: claude-code · Reviewer: Volodymyr · Depends on: T16, H1-H5
- Change: README sections "How it works", "Setup" (accounts, secrets, deploy), "Runbook" (re-run a
  failed publish, rotate tokens); E2E checklist A1-A9 executed on the test channel, results recorded;
  switch to the real channel after Volodymyr's go.
- Acceptance: all A1-A9 checked and documented.
- Tests: the checklist.

## Phase 1b (planned 2026-10-27, after the MVP went live)

Same rules as above. ADR 009: keep each PR under ~400 changed non-test lines.

### T18 — Published callback endpoint and D1 index (`bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T16
- Change: `POST /callbacks/published` on the Worker, HMAC-SHA256 over the raw body with
  `PUBLISH_CALLBACK_SECRET` (header `X-Handmake-Signature`, constant-time compare, 401 otherwise).
  Body: `{tenantId, postId, date, photos: [repo paths], channels: {<channel>: "done" | "failed"}}`.
  Moves the draft `publishing → published` in one guarded statement (idempotent: a second call is a
  no-op 200). Migration `0005`: table `published_posts` (tenant_id, post_id, published_at, photos JSON),
  insert-or-ignore. Old previews then answer `draftFinishedText` instead of "busy".
- Acceptance: a valid call marks the draft published and indexes it once; bad/missing signature → 401
  and nothing written; unknown draft → 200, index row still written (posts published by hand).
- Tests: signature cases, idempotency, D1 transition guard.

### T19 — Publisher sends the callback (`publisher`, workflow)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T18, H7 · Sensitive: touches `.github/workflows/`
- Change: after the ledger commit, `publish` POSTs the T18 body to `PUBLISH_CALLBACK_URL` (repo variable,
  the Worker URL) signed with `PUBLISH_CALLBACK_SECRET`. A callback failure never fails the publish: it
  notifies the operator only. `publish.yml` passes the secret and variable. Remove the "stays publishing"
  entry from docs/review-notes.md and the README runbook.
- Acceptance: live publish → draft `published` in D1, one `published_posts` row.
- Tests: signature matches T18's verifier (shared helper in `core`), callback failure path.

### T20 — Meeting announcement and reminder (F18, `bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T18
- Change: tenant config gets `announcements` (weekday/time for announcement and reminder, UA template
  text). Worker cron creates a `ready` draft from the template (German via the translator) and sends the
  author the usual preview; nothing is posted without her 🚀 (same rule as Q6). One draft per meeting
  date (unique key), so cron retries do not duplicate.
- Acceptance: on the configured time the author gets exactly one announcement preview and one reminder
  preview per meeting.
- Tests: schedule calculation in `Europe/Berlin` incl. DST change, uniqueness, template rendering.

### T21 — Poll capability in the Telegram channel (F19 part 1, `channels`, `publisher`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T19
- Change: post type `wotw-poll` (candidate photos + options); `renderTelegram` emits album then
  `sendPoll` replying to it; the ledger stores the poll message ID; `TelegramChannel.closePoll`
  (`stopPoll`) returns counts. ADR 008.
- Acceptance: dry-run shows album + poll ops; re-run never sends a second poll.
- Tests: render ops, ledger resume between album and poll, closePoll parsing.

### T22, T23 — superseded by v3
T22 (candidates from `published_posts`) and T23 (AI winner) are replaced by T27-T32: spec v5 takes the
candidates from participants' entries, and the author breaks ties (2026-10-28). What T22 had planned
(window math, deterministic per-week draft id, insert-or-ignore, feature flag, `< 2` rule) moves to T30.
T24 (Instagram) becomes T26.

## Tasks v3: phase 1b remainder (contest, Instagram, proof of use)

Rules as above; each PR under ~400 changed non-test lines (ADR 009). Owner kimi-code, reviewer
claude-code unless stated. Order here is superseded by "Order of work (v4)" below (Instagram and the contest now follow the site and the shows). Old order: T25 → T26 (Instagram) → T27 → T28 → T29 → T30 → T31 → T32; T33-T34 may run in between.

### T25 — Draft kinds and type through dispatch (`bot`, `core`)
- Depends on: T21
- Change: migration `0006`: `drafts.kind` (`post` | `work`, default `post`), `drafts.type` (post type,
  default `free`), `drafts.extras` (JSON). `PublishJob` and the dispatch `client_payload` carry `kind`,
  `type` and `poll?`; T20 announcement and reminder drafts dispatch their real type from now on (no
  backfill). Explicit per-chat session kind (post, entry, work) so cron drafts and a collecting draft no
  longer collide (review N2). Remove the unused seams: `ChannelAdapter.openPoll`, `PollSpec.photoIndexes`,
  `WinnerPicker` port and its fake (review N10, decision 2026-10-28).
- Acceptance: an announcement published after this task is committed with `type: announcement`; all
  existing flows unchanged; the publisher accepts the payload unchanged (`payload.ts` already has the
  fields).
- Tests: migration defaults, `publishJobOf` per kind/type, session-kind routing.

### T26 — Instagram adapter (former T24, `channels`)
- Depends on: T25, H8 · Sensitive: new secrets
- Change: `InstagramChannel` via the Instagram Login API (media container → publish; carousel for 2-10
  photos, single image for 1, text-only posts are skipped for Instagram with a note in the preview).
  German caption by default (tenant setting `instagram.language`), 2200-char limit shown in the bot
  preview. Photos need public URLs: the raw GitHub URLs of the photos the publish job just committed.
  Registered in the channel registry; enabled only when configured in tenant config (F12). Contest
  posts later go out without names (T28 policy) and without a poll (no `polls` capability).
- Acceptance: a live post appears on Instagram once; a re-run skips it via the ledger; a failed
  Instagram delivery does not block Telegram and alerts the operator.
- Tests: mocked Graph API, carousel vs single photo, container status polling, limit errors.

### T27 — Contest entries (F19 part 2a, `bot`, `core`)
- Depends on: T25
- Change: migration: `contest_entries` (entry_id, tenant_id, week, file_id, display_name?, consent_at,
  status `submitted` | `withdrawn`, created_at). `/entry` session: exactly one photo, optional name
  (≤ 30 chars, first name or nickname), mandatory consent button. Consent text (UA) states what is shown
  (the photo and, if given, the name), where (Telegram, Instagram, website) and how to withdraw (tell
  the author); Instagram never shows names. `AuthorEntrySource` implements `SubmissionSource`: the
  week's `submitted` entries in submission order, max 10.
- Acceptance: an entry without consent is never stored; a second photo is refused; names never appear
  in logs.
- Tests: session flow, consent required, name length, week bucketing in `Europe/Berlin`, source order.

### T28 — Names endpoint and placeholder resolution (`bot`, `publisher`, `core`)
- Depends on: T27, H9 · Sensitive: touches `.github/workflows/publish.yml` (passes the secret)
- Change: `resolveEntryNames(text, names, policy)` in `core` (`{entry:<id>}` → name or "Work No N";
  malformed token → error). Worker `GET /internal/contest-names?ids=…`: HMAC-SHA256 over
  `method + path + timestamp` with `NAMES_ENDPOINT_SECRET`, 5-minute window, constant-time compare
  (architecture 5). Publisher fetches names before rendering, masks each with `::add-mask::`, resolves
  per channel policy from tenant config (Telegram names allowed, Instagram never). Bot preview resolves
  from D1 directly. Dry-run uses a fixture instead of the endpoint.
- Acceptance: committed `index.md` contains placeholders only; Telegram ops contain names; a stale or
  wrong signature → 401.
- Tests: resolver table tests, signature/replay cases, publisher with mocked endpoint, masking call.

### T29 — Callback v2 with message IDs (`publisher`, `bot`, `core`)
- Depends on: T25
- Change: callback body `channels: { <channel>: { status, messageIds: { main?, poll? } } }`, IDs found
  by op kind at deliver time. Migration: `channel_deliveries` (tenant_id, post_id, channel, status,
  message_ids JSON), upsert. The bot accepts the v1 body during the switch-over (one release).
- Acceptance: after a poll post, D1 holds its poll message ID; re-sent callback changes nothing.
- Tests: schema v1/v2, op-kind lookup, idempotent upsert.

### T30 — Poll draft cron (F19 part 2b, `bot`)
- Depends on: T27, T28, T29
- Change: Monday-open cron (`workOfWeek.opens`) builds a `wotw-poll` draft (kind `post`, extras: poll
  spec + entry refs) from `AuthorEntrySource`: album 1..N, poll "No 1".."No N", captions with
  placeholders. `< 2` entries → the author is told, no draft. Deterministic per-week draft id,
  insert-or-ignore, flag `featureFlags.wotwPoll`.
- Acceptance: one poll draft per week; flag off → nothing; the author sees names in the preview.
- Tests: window math incl. DST, `< 2` rule, idempotent cron, flag.

### T31 — Close poll, author breaks ties, result draft (F19 part 3, `bot`)
- Depends on: T30
- Change: closing cron reads the poll message ID from `channel_deliveries` and calls `closePoll`. Most
  votes wins. Zero votes, unreadable result or a tie → the bot sends the author the tied candidates as
  inline buttons; her choice decides. A `wotw-result` draft ("chosen by readers" / "chosen by the
  author") follows for her 🚀. Winner flag stored on the entry (needed for retention, T32).
- Acceptance: each case yields exactly one result draft with the right wording; a second cron run does
  nothing.
- Tests: winner rules incl. ties and zero votes, button callback, idempotency.

### T32 — Withdrawal and retention (`bot`, `channels`)
- Depends on: T29, T31
- Change: `editMessage` capability on the Telegram adapter (`editMessageCaption` or `editMessageText`,
  adapter decides). `/entries` lists recent entries with a "withdraw name" button: the name is deleted
  in D1, the affected Telegram messages are re-rendered and edited using `channel_deliveries`. Daily
  cron deletes names of non-winning entries 90 days after the result post; winners keep the name until
  withdrawal (ADR 010). Site rebuild hook is a no-op until T39.
- Acceptance: after withdrawal the channel shows "Work No N"; Git history never contained the name.
- Tests: edit caption vs text, retention dates, winner exemption.

### T33 — Usage metrics (`bot`)
- Depends on: T25
- Change: per draft store `first_ready_at`, edit count (UA, DE, regenerate) and the final delivery
  status from the callback. Operator command `/stats`: last 4 weeks, posts published, median time from
  draft to publish, edits per post, delivery success rate. No personal data. Volodymyr uses these
  numbers to decide when phases 2b-4 start (expert review 2026-10-28); they also go into the README.
- Acceptance: `/stats` answers only the operator; numbers match a fixture.
- Tests: aggregation, allow-list.

### T34 — Portfolio pack (docs) · Owner: claude-code · Reviewer: kimi-code
- Depends on: T33, H12
- Change: English README rewritten for employers: problem, architecture diagram, demo GIF (H12),
  real usage numbers from `/stats`, design trade-offs with ADR links; `docs/operations.md`: failure and
  recovery (API down, partial delivery, re-run), security boundaries, deploy from scratch.
- Acceptance: a developer can deploy a test tenant from the docs alone (checked by kimi-code).
- Tests: n/a (docs); links checked.

## Order of work (v4), superseded by v5

T35 → T39 → T40 → T41 (site live on fadenundstimmung.de, channel posts link to it) → T42 (cost
ledger) → T36 → T43 (spike, ADR 015) → T44 → T45 → T46 (AI shows) → T26 (Instagram) → T27-T32
(contest) → T33, T34. T33-T34 may run in between. Superseded: T37 and T38 (replaced by T39-T41; the
site no longer shows contest winners, so T28 and T32 lose their site parts). Owner kimi-code,
reviewer claude-code unless stated; each PR under ~400 changed non-test lines (ADR 009).

## Tasks v4: phase 2 (site first, POSSE)

### T35 — Site scaffold (`site`) · revised in v4
- Depends on: T25
- Change: Astro static in `apps/site`: German default at `/`, Ukrainian under `/uk/`; theme and brand
  («Faden und Stimmung») from the tenant `site:` section; blog from the `ContentStore`; `/kreis/` page
  from tenant config (what, when, where, Telegram link); manual `wrangler pages deploy` documented.
- Acceptance: local build renders all published posts in both languages and the circle page; no
  tenant-specific code in the scaffold.
- Tests: build in CI, content loader tests, language routing.

### T39 — Site workflow, Pages and domain (`workflows`) · Sensitive
- Depends on: T35, H10
- Change: `site.yml` (`workflow_call` + `workflow_dispatch`, concurrency `site`, checkout `ref: main`,
  commits nothing); `publish.yml` calls it after publish. Attach fadenundstimmung.de and `www` (redirect
  to the apex) to the Pages project; DNS records in the Cloudflare zone. The site stays behind a
  non-indexed state (`noindex`, no sitemap) until T41 go-live.
- Acceptance: a publish run updates the site on the custom domain over HTTPS; a manual rebuild works
  without a payload.
- Tests: actionlint; manual run documented in the PR.

### T40 — Canonical links in channel posts (F31, `core`, `publisher`, `channels`)
- Depends on: T39
- Change: `canonicalUrl(post)` from the post id and tenant site base URL; the renderers append "Mehr
  auf der Website: <url>" (UA/DE per language) to Telegram posts; Instagram captions get the text
  without a clickable link (bio link instead). Flag `featureFlags.canonicalLinks` so posts made before
  the site is live stay unchanged.
- Acceptance: a published post links to a page that exists after the rebuild; flag off → unchanged ops.
- Review notes from PR #81: README line that a draft first published to the test channel stays
  `siteExcluded` on a later live re-dispatch with the same draft id; raise the timeout of the flaky
  `apps/bot/test/show-transport.test.ts` grants test (timed out at 5 s on main CI run 41845320494).
- Tests: URL builder, render per channel, flag.

### T41 — Legal pages and go-live (`site`) · Sensitive
- Depends on: T40, H11
- Change: Impressum from secrets (never committed, absent from the build log), Datenschutzerklärung
  listing all processors (Cloudflare, GitHub, Telegram, Anthropic, image/video providers once chosen,
  INWX as registrar), about page. Go-live checklist; Volodymyr and the author confirm the legal texts,
  then `noindex` is removed and the sitemap enabled.
- Acceptance: build with fixture secrets shows no Impressum value in logs; go-live only after both
  confirmations.
- Tests: page build tests, masking.

### T42 — AI cost ledger and cost command (F32, `bot`, `core`) · Owner: codex (Kimi Code out of limits) · Reviewer: claude-code
- Depends on: T25
- Change: migration `ai_costs` (tenant_id, at, service, unit, amount_eur, ref); a `recordCost` helper
  used by every AI call (the existing translation call is the first user); config `ai.monthlyTargetEur`
  (20) and `ai.toleranceEur` (5); operator `/cost` (month total, per show, per service, left); warning
  at the target, a hard stop for new shows above target + tolerance; summary on the 1st by cron.
- Acceptance: a fixture month yields the right totals; above the cap a new show is refused with a clear
  message; only the operator can call `/cost`.
- Tests: aggregation, thresholds, month boundaries in `Europe/Berlin`, allow-list.
- Implementation contract: all existing allow-listed users are operators (Volodymyr, 2026-10-31).
  `assertCanStartShow` is the budget gate for T44's future `/show` entry point; T42 has no show flow.
  Book shows with `ref: show:<id>` and other translations with `ref: post:<id>`. EUR translation
  estimates are operator-supplied in tenant config; T43 verifies them. No participant data is stored.

### T36 — Works and collections (`bot`, `publisher`, `core`, `ai`, `site`) · approved split
- Owner: codex · Reviewer: claude-code (each implementation PR).
- Status: split approved by Volodymyr (2026-11-01); T36a/T36b/T36c1/T36c2/T36c3 merged; T36d implemented in PR #41, awaiting claude-code review.
- Depends on: T25, T35, T42.
- Delivery: six sequential PRs (T36a, T36b, T36c1–T36c3, T36d), each targeting under ~400 changed non-test lines (ADR 009).
  Reassess scope before coding each part; propose a further split if the estimate exceeds the limit.
  T36 is complete only after T36a–T36d. Later tasks depending on T36 wait for all four parts.
- Boundaries: no deployment, invented author copy or tenant-specific core logic.
  Do not modify `apps/bot/wrangler`, credentials or D1 migrations. Explain any need to cross these boundaries separately
  before proceeding. Video generation, show budget gating and pricing verification remain T43/T44.

#### T36a — Work and collection contracts, builder and content writer
- Owner: codex · Reviewer: claude-code.
- Depends on: T25, T35, T42; first PR in the split.
- Change: add strict tenant-aware work and collection schemas and types; work fields include stable
  `id`, `tenant`, `date`, `collection`, declared photos, per-language descriptions and provenance,
  plus template `kind: worn | closeup | interior`. Keep dispatch `kind: work` distinct from the
  work's template kind. Collections contain a tenant, slug, localized titles/descriptions, order and
  cover reference. Add the pure `buildWorkFromPayload` builder and Git content-store writers for
  `content/works/<id>/index.md` with photos and `content/collections/<slug>.md`.
  Extend `ContentStore` with typed work/collection reads and listings and declared-photo access,
  following ADR 016; extend the reusable store contract tests with the first Git implementation.
  Leave dispatch orchestration and channel delivery for T36c.
- Acceptance: a valid approved payload builds and round-trips through the store with provenance;
  repeating the same write uses the same identity and paths. Reads/listings are tenant-scoped,
  listings have deterministic ordering, malformed content fails loudly, and photo access exposes
  only declared files with no path traversal. No bot, AI or site behavior changes in this PR.
- Tests: schema rejection cases and all three template kinds; builder determinism and invalid
  payloads; extended store contracts covering round-trips, repeated writes, tenant isolation,
  ordering, malformed files and undeclared/unsafe photo names. Run typecheck and lint.

#### T36b — Text generation and cost accounting
- Owner: codex · Reviewer: claude-code.
- Depends on: T36a (merged), T42; second PR.
- Change: introduce the provider-neutral `TextGenerator` port together with its first AI adapter.
  Generate a Ukrainian description from the author's note and supplied work context, then a German
  version, using existing translation conventions where applicable. Return editable text and
  provenance/model/prompt metadata. Wire paid text calls into T42 usage accounting with tenant and
  work correlation; reuse configured models/prices rather than adding prices in code.
- Acceptance: mocked generation produces both language versions with accurate provenance; the
  adapter never approves or publishes text. Every successful paid call is accounted for once,
  including a successful UA call followed by a failed DE call. Failures surface without fabricated
  text or zero-cost fallback; document the existing SDK parse-failure accounting limitation from
  T42 and avoid treating unobserved usage as free. No live provider calls in tests.
- Tests: mocked provider and translator success, malformed output, partial failure, usage hooks,
  duplicate usage events and tenant/work attribution; typecheck and lint.

#### T36c — Author work session and publishing integration
- Owner: codex · Reviewer: claude-code.
- Depends on: T36b (merged).
- Status: implementation split approved by Volodymyr on 2026-11-01; T36c1/T36c2 merged; T36c3 implemented in PR #40, awaiting review.
  The existing session, dispatch and publisher boundaries plus partial-generation recovery require
  more than ~400 changed non-test lines together. Deliver T36c as the three sequential PRs below
  (ADR 009); preserve all parent acceptance criteria. T36d waits for all three to merge.
  Each part keeps Owner: codex and Reviewer: claude-code; no deployment, credentials, Wrangler
  configuration or D1 migrations. Explain any discovered migration requirement before proceeding.
- Change: add `/work` using the existing draft/session FSM: collect photos and note, select template
  kind, select or create a collection, generate descriptions, edit, preview and explicitly approve.
  Include the author's choice of channel announcement. Dispatch approved work payloads and connect
  the publisher to T36a's builder/writers, existing photo processing and ledger/retry machinery.
- Partial failure (agreed 2026-11-01): keep a successful UA draft in the session and retry only the DE
  translation; never regenerate UA after a paid success.
- Provenance (decided 2026-11-01): set at approval by comparing the generated draft with the approved text;
  edited text is `ai-assisted`, unchanged text is `ai-generated` (DE follows the UA edit state).
- Acceptance: only the authorized author can advance the session; unapproved text is never
  dispatched. Publishing writes the work and any new collection; optional announcements use channel
  ports. Re-running the same publish payload creates neither another work nor duplicate channel
  operations. Existing post sessions and publishing continue to work. Use the existing D1 schema;
  explain any discovered migration requirement before proceeding.
- Tests: session transitions, edit/approval/cancel paths, invalid input, collection selection/creation,
  dispatch payload, processed photos, optional announcement, retry after partial delivery and post
  regression tests using fake adapters; typecheck and lint. Run actionlint if workflows change.

##### T36c1 — Work dispatch and publisher integration
- Owner: codex · Reviewer: claude-code.
- Depends on: T36b (merged); first PR, target ~200–300 changed non-test lines.
- Change: define the shared work publish-job/dispatch contract with stable work ID/date,
  template kind, collection reference or new collection data, approved localized descriptions and
  metadata, photo refs and optional channel announcement. Connect publisher parsing/routing to
  `buildWorkFromPayload`, the work/collection writers and existing photo-processing/ledger delivery.
  Create a new collection with its first work and a cover referencing that work's first photo.
  Handle successful work completion in the existing callback without adding works to the regular
  post candidate index; keep old post payloads/callbacks compatible.
- Acceptance: validate tenant languages and metadata before fetching photos or writing content.
  Publish work-only or work plus selected channel announcements using channel ports. Retries reuse
  content identities and resume the ledger without duplicate channel operations; work and new
  collection are committed together. Missing/foreign collections fail clearly. Existing post
  dispatch, publishing and completion remain compatible. This PR exposes no `/work` command.
- Tests: valid/invalid work dispatch, tenant language mismatch, existing/new collection and cover,
  processed photos and exact paths, work-only completion, announcement partial-delivery retry,
  callback indexing and ordinary-post regression; typecheck and lint. Actionlint if workflows change.

##### T36c2 — Persisted generation recovery and approval metadata
- Owner: codex · Reviewer: claude-code.
- Depends on: T36c1 (merged); second PR, target ~180–280 changed non-test lines.
- Change: expose successful UA generation before DE translation; add a work-draft application flow
  using `textGeneratorFor(tenantId, workId)` with intermediate text/metadata in existing draft JSON
  fields. Use guarded state/version updates for configuration, generated baselines and results.
  Preserve the UA result before starting DE; retry DE from that persisted result. Build approved
  work jobs through T36c1's contract with provenance computed from generated versus approved text.
- Acceptance: a DE failure leaves the paid UA draft recoverable, including after runtime restart;
  retry invokes only the paid translator. Late results cannot overwrite discarded/edited drafts or
  a newer claim. At approval, unchanged UA is `ai-generated`, edited UA is `ai-assisted`; DE follows
  the UA edit state as decided by Volodymyr. Preserve model/prompt metadata and author text exactly.
  Existing draft schema suffices; no D1 migration. This PR adds no new user entry point.
- Tests: real-D1 generation success, UA-success/DE-failure and restart recovery with call counts,
  stale/racing claims, discard/edit races, accounting failures, approval provenance with unchanged
  and edited UA, and metadata dispatch round-trip; typecheck and lint.

##### T36c3 — Author `/work` session and collection selection
- Owner: codex · Reviewer: claude-code.
- Depends on: T36c2 (merged); third PR, target ~300–380 changed non-test lines.
- Change: wire `/work` into existing collection/edit/preview/consent handlers and the background
  runner. Add template selection, inline selection of tenant collections or creation of a localized
  collection, and the preview choice of channel announcement. Supply a Worker-compatible collection
  reader through a port/adapter boundary; never import the filesystem Git adapter into the Worker.
  Use T36c2 for generation/recovery/approval and T36c1 for dispatch; retain author-entered copy.
- Acceptance: only allow-listed authors can operate their tenant's session. Work configuration is
  explicit, collection errors are visible, draft IDs isolate callbacks, and unapproved work is never
  dispatched. `/done` resumes the correct generation stage; editing, preview, consent, publish and
  cancel use the existing session FSM. Switching between post/work sessions preserves isolation.
  Existing post sessions remain compatible. End-to-end mocked flow covers the parent T36c criteria.
- Tests: commands/buttons, unauthorized and foreign-tenant access, template/collection selection and
  creation, invalid input, post/work switching, generation retry, edit/preview/approval/cancel,
  announcement choice and dispatched payload; typecheck and lint. Actionlint if workflows change.

#### T36d — Work and collection site pages
- Owner: codex · Reviewer: claude-code.
- Depends on: T36c (all three parts merged); final PR in the split.
- Change: build work and collection listings/detail pages from T36a's `ContentStore` contracts,
  never filesystem globs. Use tenant site configuration, German default routes and Ukrainian `/uk/`
  routes, localized metadata/canonical links, provenance labels and declared-photo bytes. Generate
  responsive optimized images through the site build for work/collection pages (T35 review note).
  Use structural test fixtures only; obtain real copy from the author.
- Acceptance: an approved published work appears on its localized work and collection pages after
  a build. Missing translations follow T35's existing policy: omit the work from that language's
  listing and do not emit its detail route; no silent language fallback. Navigation emits only
  existing localized links. Tenant isolation and malformed-content failures match ADR 016; photo
  optimization preserves authentic originals in the content store. No deploy in this task.
- Tests: fixture site build for both languages, collection membership/order, missing translation,
  canonical links, provenance labels, optimized image output and malformed content; typecheck and
  lint. Run actionlint if workflows change.

### T43 — Show pipeline spike and ADR 015 (docs and scripts) · Owner: claude-code · Reviewer: kimi-code
- **Closed by Volodymyr 2026-11-01** (he ran the provider comparison himself). No spike report or `docs/decisions/015-ai-show-pipeline.md` exists in the repo; the chosen provider, template prompts, per-show cost and the Q15 outcome must be recorded in ADR 015 before T44 starts.
- Depends on: T42, H13 · Resolves Q15
- Change: run 3 real works through 2-3 try-on/compositing and short-video providers; compare quality
  (does the embroidery stay unchanged?), cost per image and per video, licence terms for commercial use,
  AI-marking support. Output: `docs/decisions/015-ai-show-pipeline.md` and a short report with the
  images; the monthly cost estimate for F32. Scripts stay out of `main` unless useful.
- Acceptance: a decision with provider, template prompts, per-show cost; the author has looked at the
  results.
- Tests: n/a (spike); costs recorded in the ledger by hand.

### T44 — Show generation (F30, `bot`, `ai`, `core`)
- Depends on: T43, T36
- Change: draft kind `show`; `/show` session (2-3 photos of a work, or pick an existing work);
  `ShowGenerator` port with the provider from ADR 015; templates worn/closeup/interior; models from
  tenant config (`models:` list: id, name, look description, reference image); AI marker on every
  image; cost booked per call; preview shows the original next to the result with 🔁 regenerate; result
  stored as a content item with its images and video.
- Acceptance: a show draft goes from photos to an approvable preview and is committed as content on
  approval; models are changed by config only.
- Tests: session flow, template choice, mocked generator, cap respected, marker present.

#### Approved T44 split (Volodymyr, 2026-11-01)

T44 exceeds the ADR 009 review budget: it introduces a content kind, media persistence,
paid-call recovery, a provider adapter and a bot session. Keep T44 as the parent acceptance
criteria above; implement the following in separate sessions and PRs, each targeting fewer
than approximately 400 changed non-test lines. Approved by Volodymyr in chat on 2026-11-01.
All subtasks: **Owner: codex · Reviewer: claude-code**.

- **T44a — Show contracts and tenant configuration** (depends on T36, T43).
  Done: merged as PR #45 (`3fc6354`).
  Change: provider-neutral show/content schemas, `ShowGenerator` port, template selection,
  configurable fictional adult model identities and references, provider model identifiers and
  configured EUR rates. Define original/generated media references, provenance and marking metadata.
  Acceptance: validated contracts describe 3-5 images and one short video linked to a real work;
  model changes require config only; existing tenants remain valid with shows disabled.
  Tests: valid/invalid shows and config, template defaults/override, port purity.
- **T44b — Show storage and approval publication** (depends on T44a).
  Done: merged as PR #46 (`ecd17c1`).
  Change: persist show documents, original references, generated images/video and marking metadata;
  extend the publish job and idempotent content writer for approved shows. No channel copies (T46).
  Acceptance: retrying approval does not duplicate content or alter an already committed show;
  publication remains tenant-scoped and stores all declared media.
  Tests: store contract, serialization, retry/collision and tenant isolation.
- **T44c — Durable generation flow with a mocked generator** (depends on T44a, T42).
  Done: merged as PR #47 (`6d9bcb0`).
  Change: show draft checkpoints, per-call cost booking and budget checks, generation/regeneration
  orchestration and recovery. Use dependency injection; never enable mock output in production.
  Acceptance: completed paid results survive retries; uncertain calls require reconciliation;
  regeneration is accounted for and the cap blocks new paid attempts.
  Tests: mocked generation, concurrent claims, partial failure/restart, accounting failure and cap.
- **T44d — fal adapter and media marking** (depends on T44a, T44c).
  Change: implement the ADR 015 image/video provider behind the port, versioned template prompts,
  visible and machine-readable image markers, video labelling and durable result ingestion.
  Acceptance: provider ids come from config; outputs cannot reach approval without required markers;
  costs have provider call identity. Complete the ADR 015 model-terms check before real calls;
  reconcile configured rates with provider billing before production enablement.
  Tests: mocked provider HTTP lifecycle, failed/uncertain outcomes, marker verification,
  media validation and secret-safe errors. No paid calls or deploy implied by this subtask.
- **T44e — Author session and preview** (depends on T44b, T44c, T44d).
  Change: `/show`, 2-3 original photos or existing-work selection, model/template menus,
  original/result preview, regenerate, discard and approval dispatch. Wire the budget gate and
  recovery messages behind the allow-list; deployment requires separate authorization.
  Acceptance: the author can create and approve a show without repository edits; originals are
  visible alongside results; every generated image is labelled and approval commits show content.
  Tests: session flow with mocked generator, config-only model change, template override,
  denied budget, regeneration, approval retry and existing post/work regression checks.

### T44d split (approved by Volodymyr in chat, 2026-11-02)

T44d combines three independently reviewable adapters and is expected to exceed the ADR 009
limit of approximately 400 changed non-test lines. Keep T44d as the parent acceptance gate;
use the following implementation order. All subtasks: **Owner: codex · Reviewer: claude-code**.
No paid calls, production enablement, remote migrations or deployment are authorized.

- **T44d1 — fal HTTP adapter and versioned prompts** (depends on T44c).
  Done: merged as PR #48 (`372e026`).
  Implementation complete on `feat/t44d1-fal-adapter`; awaiting claude-code review.
  Change: implement `ShowGenerator` with injected HTTP transport, config-selected model ids,
  versioned prompts and image/video payloads; queue submission, bounded polling and media download.
  Retain provider request identity for reconciliation, including failures after submission;
  never automatically resubmit an uncertain paid call. Report configured EUR estimates explicitly,
  not as provider-invoiced prices. Verify the selected model terms before any real call; leave
  production disabled until excluded-model status and billing reconciliation are resolved.
  Acceptance: one submission per attempt, provider-unique accounting identity, no credentials or
  provider response bodies in errors; validate URLs before sending authorization headers.
  Tests: mocked HTTP lifecycle, payloads/prompts, failed/uncertain outcomes, timeouts, hostile URLs,
  malformed/oversized media and secret-safe errors.
- **T44d2 — Durable raw result ingestion** (depends on T44d1).
  Done: merged as PR #49 (`273b0f4`).
  Implementation complete on `feat/t44d2-show-result-store`; awaiting claude-code review.
  Change: implement immutable tenant/show/attempt-indexed `ShowResultStore` for raw bytes and receipt;
  implement the T44d1 `FalAttemptJournal` with atomic reservation and immutable request-id recording;
  document the storage/runtime choice and raw-media resolution contract for T44e.
  Acceptance: bytes and receipt survive restart; retries are idempotent, collisions fail closed,
  tenants remain isolated, and raw results cannot be mistaken for approved marked media.
  Tests: restart, partial write, concurrent put, collision, tenant isolation and size limits.
- **T44d3 — Media marking and approval verification** (depends on T44d2).
  Done: merged as PR #50 (`661eeb2`).
  Implementation complete on `feat/t44d3-media-marking`; awaiting claude-code review.
  Change: implement visible image/video labels and machine-readable image metadata with versioned
  processing; verify decoded outputs and persist marked bytes separately from paid raw results.
  Preserve provider provenance metadata where supported; do not claim to create C2PA signatures.
  Document the execution boundary first: the bot is a Worker and cannot execute native FFmpeg;
  ADR 012's Actions renderer is still proposed and does not authorize a new workflow here.
  Acceptance: approval consumes only verified marked bytes; every image and the full video carry
  the required label; recheck the 20 MB transport limit after processing. Processing retries never
  trigger generation or another paid call. Define the gate T44e must call before approval.
  Tests: real small media fixtures, decoding, missing/tampered metadata, absent visible label,
  invalid/truncated video, duration and post-marking size limits, immutable output and retry.

T44d1-T44d3 are merged; T44e's implementation dependencies are satisfied.
Each subtask gets a fresh session and its own PR.
Any new workflow or secret handling remains subject to the existing sensitive-merge approval rule.

### T44e split (approved by Volodymyr in chat, 2026-11-02)

T44e crosses paid-call recovery, execution lifetime, private media transport and the author UI.
It cannot fit the ADR 009 target of approximately 400 changed non-test lines in one PR.
Keep T44e as the parent acceptance gate; use the following implementation order.
All subtasks: **Owner: codex · Reviewer: claude-code**. Each requires a fresh session and its own PR.
No paid calls, remote resource creation, secret installation, migrations or deployment are authorized.
Model-terms and billing checks remain gates before the first real show, not before implementation.

- **T44e1 — Per-call checkpoints and explicit reconciliation** (depends on T44d3).
  Change: separate paid-call authorization from result/checkpoint acceptance, so orchestration can
  resume one bounded step at a time. Preserve tenant locks and refresh leases at checkpoints.
  Add application operations to recover a journalled request, account for failed/rejected paid
  outcomes, and discard an attempt only after explicit operator reconciliation (including no-spend
  attempts). Retain raw/journal evidence; never infer zero spend from a missing result/request id.
  Acceptance: no new submission while an outcome is uncertain; recovery by provider id books once
  before unlocking or authorizing further spend. Regeneration uses new attempt ids and preserves
  retired receipts. Budget checks cover each new call; lost acknowledgements cannot bypass the cap.
  Tests: mocked paid-call recovery, rejected output accounting, ledger failure/retry, concurrent
  claims, lease refresh, stale checkpoints, cap rejection and explicit no-spend discard.
- **T44e2 — Private storage composition and authenticated Worker transport** (depends on T44e1).
  Change: add the Worker side of job-scoped transport for call grants, journal reservation/recording,
  raw/marked media and result checkpoints. Compose the existing R2 adapters with local bindings;
  describe the later private bucket setup without creating remote resources or installing secrets.
  Acceptance: requests bind tenant, show, attempt and job/version; authentication, replay and stale-job
  checks fail closed. Retryable operations stay idempotent. Media remain private and size-bounded;
  neither public URLs nor credentials appear in payloads/logs. Missing configuration disables shows.
  Tests: signed/invalid/expired requests, replay, cross-tenant access, stale generation callbacks,
  Miniflare storage integration, size limits and unchanged existing webhook/callback behavior.
- **T44e3 — Resumable Node executor and marking job** (depends on T44e2).
  Change: implement the Node client/executor and its workflow dispatch. Long provider waits and
  Sharp/FFmpeg processing run in Node; the Worker owns authorization, budget and checkpoints through
  T44e1/T44e2. Execute only granted attempts, reserve the durable journal before POST, resume reads
  using recorded provider ids, and upload receipts/results through the authenticated transport.
  Call `createShowMarkingGate.prepare` before reporting a result as verified for preview/approval.
  Acceptance: no complete show runs inside webhook `waitUntil`; interruptions resume from persisted
  state without another paid submission. Raw and marked media stay separate. Paid execution remains
  disabled until the existing production gates are explicitly cleared; dispatch grants alone do not
  clear them. New workflow/secret handling requires sensitive-merge OK, not deployment permission.
  Tests: mocked end-to-end Worker/Node HTTP lifecycle, restart at paid/marked checkpoints, duplicate
  dispatch/callback, worker rejection, marking failure and secret-safe errors. No paid provider tests.
- **T44e4 — Author input and configuration menus** (depends on T44e3).
  Change: implement allow-listed `/show`, 2-3 original photos or existing-work selection, configurable
  persona choices and template defaults/override. Reuse the existing work-authoring/storage path for
  new works; ensure the linked work exists before show publication and require author approval for
  any work publication. Persist the session and original references; preserve the author's texts.
  Acceptance: no Git/Markdown interaction is needed; disabled/misconfigured shows give a clear reply.
  Models change through tenant config only. Interrupted input resumes without mixing post/work/show
  sessions, and generation starts only after validated input and explicit author action.
  Tests: new/existing work paths, missing work, 2-3 photo bounds, persona config changes, template
  override, denied access, disabled configuration and existing post/work session regressions.

#### T44e4 split (approved by Volodymyr in chat, 2026-11-02)

T44e4 needs persistent show-session routing, a tenant-scoped work reader, new-work handoff,
photo intake, configuration menus, private input persistence and executor dispatch. These cross
separate adapters and cannot fit the ADR 009 target in one reviewable PR. Keep T44e4 as the
parent acceptance gate. All subtasks: **Owner: codex · Reviewer: claude-code**. Each requires
a fresh session and its own PR; propose a further split before coding if one exceeds the target.
No paid calls, bucket creation, remote migrations or deployment are authorized.

- **T44e4a — Show sessions and linked-work selection** (depends on T44e3).
  Change: add allow-listed `/show`, persistent show-session routing and a tenant-scoped published
  work reader. Offer existing-work selection and a handoff to the existing `/work` authoring and
  approval flow for a new work, retaining the link needed to resume show setup after publication.
  Do not publish a work implicitly. Provide a clear disabled/misconfigured reply.
  Acceptance: interrupted selection resumes; missing/cross-tenant works are rejected; post, work
  and show messages stay in their own sessions. New works use the existing storage/publication
  path and require author approval before becoming eligible for show generation.
  Tests: denied access, disabled configuration, existing/missing/cross-tenant works, new-work
  handoff and approved-publication resumption, post/work session regressions.
- **T44e4b — Original photos and configuration menus** (depends on T44e4a).
  Change: collect and persist 2-3 original references for the linked work, using existing work
  photos where suitable and allowing new originals. Add persona choices from tenant config and
  work-kind template defaults with explicit overrides. Preserve the author's texts unchanged.
  Acceptance: photo bounds are enforced atomically; interrupted intake resumes; stale menus and
  removed/changed personas cannot configure a generation; non-interior templates require a persona.
  The linked work is revalidated before finalizing the input. No generation starts from intake.
  Tests: 1/2/3/4-photo inputs, concurrent album messages, resume, persona config changes, template
  overrides, missing linked work and unchanged author text.
- **T44e4c — Explicit generation start and private inputs** (depends on T44e4b).
  Change: resolve validated original/persona references into bounded private show inputs, configure
  the immutable show plan and dispatch the existing resumable Node executor only after an explicit
  author action. Use a canonical tenant/show/version payload for dispatch. Wire the production
  composition while retaining all existing disabled/missing-resource and paid-execution gates.
  Acceptance: the linked published work, current config and 2-3 originals are checked before
  starting; duplicate/stale actions cannot replace a configured plan or submit another paid call.
  Provider waits and marking remain in Node; webhook background work only prepares/dispatches.
  Failed preparation/dispatch remains resumable without mixing sessions or losing original refs.
  Tests: explicit-action requirement, invalid input, missing private storage/config, canonical
  dispatch, duplicate/stale buttons, preparation/dispatch retry and mocked Worker/Node handoff.

- **T44e5 — Preview, regeneration and recovery controls** (depends on T44e4).
  Change: show originals beside marked images/video; add regenerate, retry/reconcile and discard
  controls using T44e1 operations. Bind buttons and asynchronous results to the current draft version;
  expose billing reconciliation/discard authorization only to the operator where required.
  Acceptance: the author can inspect the actual work and every marked result. Paid regeneration is
  budget-gated and replacing an image also replaces its video. Unknown outcomes remain locked until
  reconciled; neither cancel nor stale callbacks silently clear them or restore superseded output.
  Tests: preview contents, single-image/video regeneration, budget warnings/denial, stale buttons,
  interrupted jobs, operator recovery, no-spend discard and retained evidence after cancellation.
  **Split approved by Volodymyr (2026-11-02):** the private-media
  presentation, paid execution controls and operator recovery cross separate adapters and exceed
  the ADR 009 review target together. Retain T44e5 as the parent acceptance gate. Each subtask
  requires a fresh session and its own PR, targeting under 400 changed non-test lines.
  All subtasks: **Owner: codex · Reviewer: claude-code**. No deploy or paid calls are authorized.
  - **T44e5a — Private version-bound preview** (depends on T44e4c).
    Present the linked work originals and every current marked image/video through the private
    author session; support explicit refresh after asynchronous execution. Revalidate tenant,
    draft version and current output identities before delivery; never expose raw provider output
    or public bucket URLs. Preserve marked bytes with document delivery and correct filenames.
    Tests: complete preview, missing/unfinished media, stale versions, cross-tenant denial,
    interrupted delivery and superseded asynchronous results. No approval/publication yet.
  - **T44e5b — Regeneration and resumable retry** (depends on T44e5a).
    Add version-bound single-image/video regeneration and retry through the existing budget gates,
    transport and canonical dispatch. Replacing an image invalidates its dependent video and
    superseded preview. Unknown outcomes retain their lock. Add secret-safe preparation/dispatch
    diagnostics if the existing logging still has gaps.
    Tests: image/video regeneration, budget warning/denial, duplicate dispatch no-op, stale and
    concurrent actions, expired jobs and interrupted preparation without another paid submission.
  - **T44e5c — Operator reconciliation and safe discard** (depends on T44e5b).
    Wire recovery to the immutable provider journal with GET-only resumption; expose billing
    reconciliation and no-spend discard authorization only to the operator. Cover lost grants and
    unavailable/oversized inputs. Cancellation retains journal, billing and output evidence and
    cannot silently unlock an unknown attempt or restore superseded output.
    Tests: author denial, operator recovery, billed/no-spend reconciliation, lost grant, unknown
    outcome cancellation, stale callbacks and retained evidence. Close the parent acceptance gate.

- **T44e6 — Verified approval and publication integration** (depends on T44e5).
  Change: build approval payloads only from the current generation's verified marked snapshot;
  ingest PNG and MP4 as documents preserving exact bytes and `.png` names. Recheck transport size
  and integrity, then use T44b's idempotent show dispatch/callback path. Document the deployment
  checklist and deferred model/billing, private-bucket and migration gates without executing them.
  Acceptance: author approval publishes the show linked to its real work; retry never duplicates
  content or changes an approved snapshot. Raw/unmarked, altered or stale media cannot be approved;
  the publisher independently verifies downloaded markers. All parent T44e criteria are covered.
  Tests: mocked full author-to-publication flow, exact document bytes, marker stripping/tampering,
  regeneration versus approval races, dispatch/callback retries, tenant isolation and post/work
  regressions. Keep live calls and deployment as separately authorized follow-up work.

  **Accepted (claude-code review, 2026-11-03):** T44e6a/b/c merged with green CI; the parent T44e6
  and T44e acceptance gates are closed. Production, legal, billing and deployment gates stay open
  in `docs/show-deployment.md`.

  **Split approved by Volodymyr (2026-11-03):**
  Inspection found that Node verifies marked bytes, but the Worker has no durable verification
  evidence to bind to approval. The generic publish handler explicitly rejects shows. Adding that
  boundary, immutable approval, document ingestion and end-to-end coverage in one PR would exceed
  the ADR 009 target. Preserve the parent acceptance above across these sequential subtasks, each
  in a fresh session and its own PR, targeting under 400 changed non-test lines.
  All subtasks: **Owner: codex · Reviewer: claude-code**. No deployment or paid calls authorized.
  - **T44e6a — Durable verified marked snapshot** (depends on T44e5).
    Merged as PR #66 (`869477e`) after claude-code review.
    Extend the authenticated Node/Worker boundary to persist verification evidence only after
    `createShowMarkingGate.prepare` succeeds. Bind evidence to tenant, show, attempt, raw and
    marked byte digests, receipt and marker declaration. Recheck stored integrity and transport
    size when resolving a current generation snapshot; reject incomplete, superseded, cancelled
    or cross-tenant results. Do not import Node image/video tooling into the Worker.
    Tests: successful verification, missing evidence, raw/unmarked media, altered bytes/receipts,
    stripped markers, duplicate/interrupted evidence delivery, stale generations and isolation.
  - **T44e6b — Immutable author approval and document dispatch** (depends on T44e6a).
    Merged as PR #67 (`49a5a4e`) after claude-code review; retry-label fix PR #68.
    Present the exact proposed language versions and linked work with all verified marked media
    before offering version-bound approval. Reuse existing text provenance without silently
    rewriting the author's text. Upload PNG/MP4 as documents with stable names, check exact returned
    document identities and transport limits, and freeze the validated show publication payload
    atomically against regeneration/cancellation. Reuse T44b's publish runner and callback path;
    dispatch retries must use the same approved snapshot. Approval must remain recoverable after
    interrupted upload, notification or dispatch without approving a different generation.
    Tests: author flow, exact document bytes and `.png` names, failed/partial uploads, stale buttons,
    regeneration/approval races, duplicate approval, dispatch retries and tenant isolation.
  - **T44e6c — Publication integration and deployment gates** (depends on T44e6b).
    Merged as PR #69 (`8890601`) after claude-code review. Rollout gates: `docs/show-deployment.md`.
    Exercise the mocked author-to-publisher-to-callback flow through the production adapters.
    Confirm independent downloaded-marker verification, immutable retries, work linkage and
    post/work regressions. Document the deployment checklist, distinguishing already applied
    setup from deferred exact-model terms/billing, private-bucket/binding, migration and deployment
    gates. Do not execute remote setup, deployment or paid calls. Close the parent T44e6 and T44e
    acceptance gates only after the combined evidence passes review.
    Tests: full flow, marker stripping/tampering, publication/callback retries, approved-snapshot
    stability, tenant isolation and existing post/work publication.

#### T44e7 — Backfill verification for shows generated before T44e6a (`bot`, `publisher`)
- Status: done, PR #75 merged as `3ace26a`; bot deployed 2026-11-03 (version `15458a36`).
  Missing attestations trigger a recovery-only job from preview; retained outputs are verified
  without generation grants or accounting checkpoints. Production backfill of show `01M6ECR1…` pending.
- Owner: codex · Reviewer: claude-code.
- Problem: show `01M6ECR1Z295C1WN4H5C7BBNBB` (tenant `faden-und-stimmung`, chat `6127139155`) is
  `ready` v37 with 4 outputs (3 images + video, 0.70 EUR already paid on 2026-11-02). Raw and marked
  objects exist in R2 for all 4 attempts, but `show-verified/v1/...` is missing for all of them,
  because attestation (`verified-put`, PR #66) did not exist when they were generated. `/show` then
  fails in `resolveVerifiedShowSnapshot` ("verification missing") and the author only sees
  "Перегляд перервано або результати змінились", so the show can never be approved.
- Change: give a `ready` show with missing attestations a way to get them without regeneration or
  paid calls. Reuse `executeShow`'s existing `prepare` step (marking gate + `verified-put`) for the
  existing outputs. For example, the Worker detects missing attestation when presenting a ready show
  and dispatches an attest-only `show.yml` job, then tells the author to refresh. An operator command
  is also acceptable. A fresh job record must not reopen authorization: `authorize` must return
  nothing for a complete show, and `SHOW_ALLOW_PAID_CALLS` stays `false`. Replace the misleading
  "interrupted" reply with a clear state message for this case.
- Acceptance: after the bot deploy and one backfill, `/show` → «Оновити перегляд» for show
  `01M6ECR1…` sends the 3 PNGs and the MP4 and offers «Схвалити показ», with the same attempt IDs.
  No fal call is made and no `ai_costs` row is added. A marked/raw mismatch still blocks approval.
- Tests: ready show with missing attestations → backfill → approval offered; no generation grant for a
  complete show; tampered marked object stays blocked; existing verified shows unchanged.
- After merge: the bot needs a deploy (Volodymyr's OK); the backfill may need one `show.yml` run.

#### T44e8 — Backfill dispatch hygiene (`bot`)
- Status: done, PR #76 merged as `e387bde`; bot deployed 2026-11-03 (version `5adb7478`).
- Owner: codex · Reviewer: claude-code.
- Review notes from PR #75: (1) every «Оновити перегляд» press while verification is pending
  dispatches another `show.yml` run; dispatch only when `open` creates a new recovery job (or
  throttle). (2) If some attempts have evidence and a later one is missing, earlier documents are
  sent before the backfill message; check all evidence before sending any document.
- Tests: repeated refresh with a live recovery job dispatches once; mixed present/missing evidence
  sends no documents and starts one backfill.

#### T44e9 — Backfill claim release and cleanup (`bot`)
- Status: merged as PR #77 (`f7dabf3`) after claude-code review; review notes moved to T44e10.
- Owner: codex · Reviewer: claude-code.
- Review notes from PR #76: (1) after a successful dispatch the claim holds until `job.expires`
  (1 h); if that `show.yml` run fails, refreshes stay suppressed while the author still reads
  "Запущено перевірку…". Release the claim when the recovery job ends without evidence, or reply
  with a distinct "перевірка вже триває" message when suppressed. (2) `show-backfill-dispatch/v1/*`
  objects are never deleted; delete on success or document an R2 lifecycle rule. (3) Preflight reads
  every media object twice per preview; keep, but note it in docs/show-recovery.md.
- Tests: failed recovery run → next refresh dispatches again; suppressed refresh shows the
  "already running" text; claim object removed after verification succeeds.

#### T44e10 — Notify the author when a show run ends (`bot`, `publisher`, `workflows`) · Sensitive
- Status: merged as PR #78 (`a893c9a`) with Volodymyr's OK; bot deployed 2026-11-03 (version `0baeb5b6`). Review notes moved to T44e11.
- Owner: codex · Reviewer: claude-code · Depends on: T44e9 · Sensitive: touches
  `.github/workflows/show.yml`.
- Review notes from PR #77: (1) `show-transport.ts` catch: wrap `bucket.delete(recoveryClaim)` in
  `.catch(() => undefined)` so an R2 failure does not turn the 409 into a 500; (2) the claim is
  released on deterministic recovery failures (tampered/invalid media), so each refresh dispatches
  another run that fails the same way: the `failed` message for recovery runs must say a retry will
  not help without operator action; (3) a failing duplicate run can release the claim while another
  run for the same job is live (one extra dispatch, fenced): note it in `docs/show-recovery.md`;
  (4) rewrap the long "This preflight deliberately reads…" line in `docs/show-recovery.md`.
- Problem (2026-11-03): after «Запустити генерацію» the bot says "Результати готуються" and goes
  silent. Two `show.yml` runs failed with `SHOW_ALLOW_PAID_CALLS=false` and the author was never
  told; a later paid run succeeded (10 min) and the author was not told either, so it looked like
  money was charged with no result.
- Change: add a transport operation (e.g. `finish`) the executor calls once per run with an outcome:
  `ready` (no pending attempt left), `paid-calls-disabled` (generator refused because the paid gate
  is closed), or `failed`. `show-cli.ts` classifies the error instead of swallowing it. Add an
  `if: failure()` step in `show.yml` that reports `failed` when the CLI never reached the Worker
  (install or setup failure). The Worker sends the author one message per job: ready → "Результати
  готові" with the «Оновити перегляд» button; paid gate closed → that generation is paused, nothing
  was charged, «Продовжити генерацію» works once paid calls are allowed; failed → nothing new was
  generated beyond what is stored, «Продовжити генерацію» resumes. No secrets, prompts or provider
  errors in the message.
- Acceptance: a run with the gate closed tells the author within a minute of the failure; a
  successful run tells the author without a `/show`; a repeated `finish` for the same job sends no
  second message; recovery (backfill) runs keep their own messages from T44e7-T44e9.
- Tests: executor reports each outcome; CLI maps the paid-gate error; Worker sends once per job and
  rejects `finish` for an unknown job; workflow failure step uses only the transport secret.
- After merge: the bot needs a deploy (Volodymyr's OK).

#### T44e11 — Silent ready rejection after authorize (`publisher`)
- Status: merged as PR #79 (`1448417`) after claude-code re-review; no deploy needed (publisher only).
- Owner: codex · Reviewer: claude-code · Depends on: T44e10.
- Review notes from PR #78: (1) `show-executor.ts`: when `authorize` returns no grant, `finish('ready')`
  errors are swallowed; if the Worker rejects it with 409 `unfinished job` (outputs incomplete), the
  run ends green and the author gets no message. Report `failed` in that case. (2) Rewrap the
  "A new explicit generation retry…" and "Runner cancellation…" lines in `docs/show-recovery.md`.
- Tests: executor sends `failed` after a rejected `ready` with incomplete outputs; a successful run
  with a Telegram delivery failure stays green.
- After merge: bot deploy not needed (publisher only).

### T45 — Shows on the site (F30, `site`)
- Owner: codex · Reviewer: claude-code.
- Status: merged as PR #70 (`18116a9`) after claude-code review; review notes in a follow-up PR.
- Depends on: T44, T41
- Change: shows list and show pages (images, video, work link, model name, "KI-generiertes Model"
  label), home page highlights the latest show, German default and `/uk/`.
- Acceptance: a published show appears on the site after the rebuild; every generated image is labelled
  on the page.
- Tests: page build tests, label presence.

### T46 — Show copies to channels (F30-F31, `publisher`, `channels`)
- Owner: codex · Reviewer: claude-code.
- Status: done 2026-11-03: T46a (PR #72), T46b (PR #73) and T46c (PR #74) merged after claude-code review.
- Depends on: T45, T40
- Change: a show publishes to the site first, then Telegram (album + video + canonical link) and, once
  T26 exists, Instagram (carousel and Reels). A failed copy never blocks the site.
- Acceptance: a show post links to its page; a re-run does not duplicate.
- Tests: render per channel, ledger resume.

The existing publisher deliberately saves shows with an empty channel list; the site job runs
after publishing. T46 therefore needs a video-capable channel contract, a separate resumable copy
runner, and CI ordering changes. Keep these in three PRs under ~400 changed non-test lines each
(ADR 009). No production rollout or paid generation is included. Instagram delivery remains
conditional on T26; these tasks must not introduce an Instagram-specific branch in the core.

#### T46a — Show rendering and video delivery
- Status: merged as PR #72 (`805082e`) after claude-code review.
- Owner: codex · Reviewer: claude-code.
- Depends on: T45, T40; first PR.
- Change: extend the network-neutral channel contract for show rendering and video bytes/operations.
  Implement Telegram rendering as an image album, the short video and localized descriptions with
  canonical show links and AI disclosure. Deliver marked PNG/MP4 bytes unchanged through the
  existing adapter, reporting each operation through its existing progress callback. Keep ordinary
  post rendering and delivery compatible. Do not wire production publishing in this PR.
- Acceptance: rendering is deterministic; links use the tenant's site origin and localized show
  routes. Descriptions are preserved, limits are checked, and the video replies to the album.
  Resuming at the video uses the recorded album id without sending the album again. Core types
  remain independent of a particular network; unsupported show delivery fails explicitly.
- Tests: localized rendering and limits; exact uploaded media bytes, missing video, reply targets,
  progress persistence and resume, rate limits and delivery errors; existing post/poll regressions.

#### T46b — Resumable copies from published show content
- Status: merged as PR #73 (`f30874d`) after claude-code review. Recovery: `docs/show-copies.md`.
- Owner: codex · Reviewer: claude-code.
- Depends on: T46a; second PR.
- Review notes from PR #72: in `renderTelegramShow`, render only `context.languages` (a version in a
  non-tenant language gets a canonical link the site never builds); move the AI disclosure into a
  per-language map instead of German for every language except `uk`.
- Change: add a separate publisher command that reads a tenant-scoped show and its marked media from
  the content store, without re-downloading draft references or regenerating media. Persist a stable
  delivery plan before sending and reuse it on retries, so changes to language order, canonical
  origin or rendering settings cannot change the meaning of a recorded operation prefix. Reuse the
  channel registry, per-operation ledger and content-only Git commits. Support the empty ledger
  created by site-only show publication and keep that publication path retryable after copies exist.
- Acceptance: a repeated copy skips completed channels; failure after the album resumes at the
  missing video/message. Copy failure preserves the published show, records the delivered prefix
  and alerts the operator. A completed site-only show is not reverted to a failed draft because a
  copy failed. A missing/cross-tenant show, missing media or invalid progress fails before sending.
  Existing post/work delivery and callbacks keep their behavior. CI invocation is added in T46c.
- Tests: real store/ledger round-trips, byte preservation and tenant isolation; successful retry,
  partial failure, interrupted persistence, changed configuration, completed-channel skip and
  site-publication retry after copies; notifier/callback and ordinary post/work regressions.

#### T46c — Site-first CI orchestration · Sensitive
- Status: merged as PR #74 (`961bf33`) after claude-code re-review and Volodymyr's sensitive-merge OK
  (2026-11-03). Both PR #74 review notes and both PR #73 notes are fixed in it.
- Review notes from PR #74 (fix in PR #74 itself, then hand back for re-review):
  1. Blocking: actionlint/shellcheck SC2129 at `.github/workflows/publish.yml:73`, step
     "Select show copy routing": group the three writes into one `{ ...; } >> "$GITHUB_OUTPUT"`
     block. Run actionlint v1.7.12 locally before pushing; CI must be green.
  2. Non-blocking: in "Push copy progress" and "Push published content", set
     `git config user.name/user.email` from `PUBLISHER_GIT_NAME`/`PUBLISHER_GIT_EMAIL` before the
     `git pull --rebase` loop, so a rebase after `main` moved can create commits.
- Owner: codex · Reviewer: claude-code.
- Depends on: T46b; third PR.
- Review notes from PR #73: in `apps/publisher/src/publish.ts`, require `TELEGRAM_BOT_TOKEN` when the
  show is not yet published (the `''` fallback gives an unclear fetch error); in `copy-show.ts`,
  decide whether a configured channel without `renderShow` is skipped or fails the copy, before
  T26 adds Instagram.
- Change: wire the copy command after successful content push and site deployment for shows.
  Pass only the stable show identity/routing needed for copies; preserve live/test channel selection.
  Keep delivery serialized, push ledger progress even on failure, and document retry/recovery in the
  runbook. Reuse existing credentials; do not change production secrets, deploy the bot or generate
  a paid show. Sensitive merge requires Volodymyr's explicit OK under AGENTS.md.
- Acceptance: a failed site build/deploy sends no copies. A copy failure never prevents or undoes
  site publication. Re-running the failed copy job reads current persisted progress and skips sent
  operations, without requiring expiring draft media. Ordinary posts/works retain their existing
  workflow behavior. The parent T46 closes only after all three PRs pass independent review.
- Tests: actionlint and workflow ordering/routing checks, including site failure and copy failure;
  local fixture execution of publication followed by copy failure/resume. Document a separately
  authorized test-channel smoke run; do not imply it ran during implementation.

## Tasks v3: phase 2 (website), superseded in v4

T35 was revised above. T36 was revised above. **T37 and T38 are superseded** by T39-T41, T45 (contest
winners are no longer on the site). The text below is kept for history.

### T37 — Site pages (`site`)
- Depends on: T35, T36, T28, H11
- Change: about, collections and works, contest winners (names via the endpoint, masked), legal pages
  from secrets. The site stays unpublished until Volodymyr confirms the legal texts.
- Acceptance: build with fixture names; no name or Impressum value in the build log.
- Tests: page build tests, masking.

### T38 — Site workflow and go-live (`workflows`) · Sensitive
- Depends on: T37, H10, H11
- Change: `site.yml` (`workflow_call` + `workflow_dispatch`, concurrency `site`, checkout `ref: main`,
  commits nothing); `publish.yml` calls it after publish; T32 rebuild hook becomes real. Go-live
  checklist: legal texts, Datenschutzerklärung with all processors (incl. Cloudflare for contest names).
- Acceptance: a publish run updates the live site; a manual rebuild works without a payload.
- Tests: actionlint; manual run documented in the PR.

## Tasks v5: legal first, end-to-end check, Meta channels, funnel (spec v7)

## Order of work (v5)

T41 (legal pages and go-live) → T41b (test posts off the site, indexing on) → T47 (end-to-end check) → T40 (canonical links) → T26a → T26b →
T26c (Instagram, Facebook, Threads) → T48 (email and lead magnet) → T49 (comment inbox) → T27-T32
(contest on all networks) → T33, T34. Owner codex, reviewer claude-code unless stated; each PR under
~400 changed non-test lines (ADR 009). Fixes found by T47 are inserted right after it.

T47a-T47f added 2026-11-04 from the T47 check (docs/e2e-v7.md, defects D1-D8); they run after T47,
before T40.

T47g added 2026-11-05 by Volodymyr as a priority: it runs first, before T47a.

T41 changes in v5: depends on H11 and H14 only (not on T40); scope as below.

T41b added 2026-11-04 after the T41 merge (PR #80); it runs before T47.

### T41b — Keep test posts off the site, drop the beacon, enable indexing (`site`, `publisher`) · Sensitive
- Owner: codex · Reviewer: claude-code · Depends on: T41, H14 revert
- Change: (1) a post can be excluded from the site by a frontmatter field (posts stay in `content/`,
  ledger and Telegram untouched); set it on the two test posts `01JBCA1B2C3D4E5F6G7H8J9K0M` («Сьогоднішнє
  засідання…») and `01M5YZZH801VCJN4RFEFQRW6NW` («Тест після оновлення GitHub Actions»); publish runs to
  the test channel (`live` off) set it automatically, so future test posts never reach the site.
  (2) Remove the Cloudflare Web Analytics script exception from `build-policy.ts` and its tests; update
  `apps/site/README.md` (statistics come from the Cloudflare zone, no script). (3) Last commit of the
  PR: `SITE_INDEXABLE: 'true'` in `site.yml` (both legal approvals recorded in PR #80; Volodymyr
  decided 2026-11-04 to index once the test posts are hidden).
- Acceptance: a fixture build excludes a flagged post from lists, pages and sitemap; a test-channel
  publish run writes the flag; the build fails on any external script, the beacon included; indexable
  build has no `noindex` and a sitemap without the two test posts.
- Tests: flag filter, publish flag for test runs, resource check, sitemap.
- Review notes from PR #80 (fix in this PR): (0) first review commit `89640da` (Datenschutz additions moved before
  `m15`, analytics module rewritten; written by the reviewer at Volodymyr's request, merged without
  independent review); (1) `apps/site/src/lib/legal.ts` resolves `docs/legal/` from
  `findRepoRoot(process.cwd())` and ignores `SITE_REPO_ROOT`, unlike `site-data.ts`; (2) the CSS check
  in `build-policy.ts` rejects any backslash with a generic error; name the file, never echo content.

### T41 — Legal pages and go-live (`site`) · Sensitive · revised in v5
- Owner: codex · Reviewer: claude-code · Depends on: H11, H14
- Change: Impressum and Datenschutzerklärung pages (`/impressum/`, `/datenschutz/`, also under `/uk/`
  with the German legal text as the binding version) built from the H11 texts; the name, address and
  email come from secrets at build time (never committed, masked in the build log) and feed both the
  Impressum and the controller section of the Datenschutzerklärung. Footer link to both on every page.
  Processors listed: Cloudflare (Pages, Workers, D1, R2, Web Analytics), GitHub, Telegram, Anthropic,
  fal.ai, INWX. A build check fails if a page loads fonts, scripts, iframes or images from any host
  other than our own domain and the Cloudflare Web Analytics beacon. Unknown paths return a real 404
  page instead of the home page. `.env.example` gets the secret names. Go-live: after Volodymyr and the
  author confirm the pages, `noindex` is removed and the sitemap enabled.
- Acceptance: a fixture build shows no Impressum value in logs or committed files; both legal pages
  and the 404 exist in both languages; the third-party check fails on a test page with an external
  font; go-live only after both confirmations (recorded in the PR).
- Tests: page build tests, masking, third-party host check, 404.

### T47 — End-to-end check of what exists · Owner: claude-code with Volodymyr · Reviewer: Volodymyr
- Status: done 2026-11-04, record in docs/e2e-v7.md; defects D1-D8 became T47a-T47f.
- Depends on: T41
- Change: walk every live flow once in production and record the result in `docs/e2e-v7.md`: post
  (UA → DE, preview, edit, publish to Telegram and site), work and collection, a show run through
  approval and copy to Telegram (includes the T44e11 finish message to the author), site rebuild,
  `/cost`, operator failure alert, `/show_status`. Any paid show run needs Volodymyr's OK first. Each
  defect becomes a small fix task inserted after T47.
- Acceptance: every flow marked pass or fail with evidence (message, URL or run link); no secrets or
  personal data in the doc.
- Review notes from PR #81: check whether a show published from a test run can reach the site
  (shows do not carry `siteExcluded`).
- Tests: n/a (manual check).

### T47g — Join the Telegram channel from the site and from every post (`site`, `channels`) · Priority
- Status: done 2026-11-05, PR #82 merged (`f18593e`).
- Owner: codex · Reviewer: claude-code · Depends on: T47
- Why: the channel `https://t.me/Faden_und_Stimmung` (public, `site.circle.joinUrl`) is linked
  only on `/kreis/`; a visitor of a post, work or show page, or a reader of a forwarded post, has
  no direct way to subscribe. Telegram's own "Join" button shows only to non-members, so admins
  never see it.
- Change: (1) site: a "join the channel" link (DE/UK texts in `apps/site/src/lib/i18n.ts`) in the
  header or footer of every page and below each post, work and show, from the tenant config, not
  hard-coded; (2) Telegram: a short last line with the channel link in the German reply of every
  post, work announcement and show copy ("Kanal abonnieren: <link>"), from a tenant config
  field; it counts towards the 1024/4096 limits and
  shares one footer with the T40 canonical link so T40 extends it instead of adding a second one.
- Acceptance: every built page links to the channel; the next published post has the line; posts
  already sent stay unchanged.
- Tests: site layout and detail pages render the link from config; renderer appends the line once,
  respects caption/message limits, absent field → unchanged ops.

### T47a — Pending edit survives publish and discard (D4, `bot`)
- Status: done 2026-11-05, PR #83 merged (`d3b2801`).
- Owner: codex · Reviewer: claude-code · Depends on: T47
- Change: clear `pending_edit` whenever a draft leaves `collecting`/`ready` (publishing claim,
  discard, show/work hand-offs) and ignore a pending edit whose draft is no longer editable, so a
  stale flag can never capture the chat's text messages. Add a D1 migration only if needed.
- Acceptance: press Edit DE, then Publish without sending text: the next text in that chat reaches
  `/work` or a new draft, not `editConflictText`.
- Tests: publish with an armed edit; discard with an armed edit; stale flag on a published draft.
- Review notes from PR #82 (T47g): (1) `apps/bot/src/preview.ts` renders without channel settings,
  so the preview limit check ignores the subscription footer; pass the tenant `channels.telegram`
  settings (keep uk-first order); (2) the channel URL lives in `site.circle.joinUrl` and
  `channels.telegram.joinUrl`; derive one or add a schema check that they match; (3) move the `<p>`
  wrapper into `JoinChannel.astro` so no empty `<p>` remains without a URL; (4) move the new
  joinUrl test in `packages/core/test/tenant.test.ts` inside `describe('parseTenantConfig')`.

### T47b — Publish result reaches the chat that approved (D2, `publisher`, `bot`)
- Status: done 2026-11-05 (PR #84, merged `da6b35a`).
- Owner: codex · Reviewer: claude-code · Depends on: T47
- Change: after the signed published callback the bot sends a short Ukrainian result to the chat
  that pressed Publish/approve (post, work, show), with the site link when there is one. The
  publisher's `author` notice stays for `AUTHOR_CHAT_ID` but becomes Ukrainian and readable.
- Acceptance: publishing from a non-author allow-listed chat gives that chat the result message.
- Tests: callback → message to the stored chat id; duplicate callback sends once.
- Review notes from PR #83 (T47a): (1) `buildTenantPreview` in `apps/bot/src/preview.ts` throws
  when the tenant-config fetch fails on a cold isolate, so the author gets no preview; catch it and
  fall back to `buildPreview` without settings, with a warning; (2) the preview hard-codes
  `languages: ['uk', 'de']`; derive the order from the loaded tenant config or document why the
  draft key order must stay fixed.
- Review notes from PR #84 (blocking): (1) show approval never stores the approving chat:
  `freezeShowApproval` (`draft-store.ts`) and the re-claim in `show-approval.ts` must write
  `approvalChatId`; add a test through `approve()`, not the `claimPublishing` test helper; (2) build
  the `/posts/<id>/` link only for `draft.type === 'free'`, since announcements, reminders and polls are
  not on the site. Non-blocking: (3) `extras.siteExcluded` is never written; send it in the callback
  body or drop the check (T47d); (4) log the Telegram `sendMessage` status when it is not ok, with no
  body or token.

### T47c — Diagnosable show failures and the checkpoint 409 (D6, D7, `publisher`, `ai`, `bot`)
- Owner: codex · Reviewer: claude-code · Depends on: T47
- Change: (1) log a sanitized cause in `show-cli.ts` and the transport `catch` (error class and
  message, fal HTTP status; never tokens, URLs with keys, or media); (2) enable Worker
  `[observability]` logs in `apps/bot/wrangler.toml`; (3) find and fix why `checkpoint` right after
  a fresh generation threw in 2 of 5 slots on 2026-11-04 (image-0 after ~9 s, video after ~100 s)
  while the same checkpoint passed on resume.
- Acceptance: a failed run names its cause in the Actions or Worker log; a test reproduces the D7
  path and passes after the fix.
- Tests: error logging redaction; the reproduced checkpoint case.
- Implementation note (2026-11-05): sanitized diagnostics and bounded conditional R2 job-write
  retries cover injected error 10058 during checkpoint claim/release. The historical D7 cause
  remains unconfirmed because its exception was discarded; see docs/show-recovery.md.
- Review notes from PR #84 (T47b): the show approval test in `apps/bot/test/show-approval.test.ts`
  approves from chat `11`, which is also the draft's chat, so it would pass even if the callback
  ignored `approvalChatId` and fell back to `chatIdOf`; approve from a different chat.
- Done 2026-11-05: PR #85 merged (`ddd8713`), bot deployed (Worker version
  `82dafe71-1183-460a-b4f8-baccdd7276df`) with persistent Worker logs. D7 root cause still open:
  confirm or reject the R2 10058 hypothesis from Worker logs on the next failing show run.

### T47d — Test-run shows and works stay off the site (D8, `publisher`, `site`)
- Owner: codex · Reviewer: claude-code · Depends on: T47
- Change: apply `SITE_EXCLUDE_POST`/`siteExcluded` to shows and works as T41b did for posts; the
  site filters them from lists, pages, media and the sitemap.
- Acceptance: a test-channel show or work run commits content with `siteExcluded: true` and has no
  site page.
- Tests: publisher marks shows/works; site filters them.
- Review notes from PR #85 (T47c): (1) the show transport operation allow-list is duplicated in
  `apps/bot/src/show-transport.ts` and `apps/publisher/src/show-executor.ts` and already differs
  (`journal`); export one list from `@handmake/core`. (2) Worker logs are now persisted, but
  `apps/bot/src/work-session.ts` (two `console.error('work setup failed', error)` calls) logs the raw
  error object, which may carry the author's text or chat id; route it through the redacting
  `safeErrorMessage` path used in `composition.ts`.

- Done 2026-11-05: PR #86 merged (`f548588`), bot deployed (Worker version
  `236786fc-8c99-44cb-bad2-acfc28518bac`). Exclusion persists across retries for
  works/shows and follows a hidden linked work. Site lists, pages, media and sitemap exclude them;
  collections use a visible replacement cover or are omitted when their cover has no visible
  replacement. Existing show visibility can narrow without changing approved metadata or bytes.
  PR #85 follow-ups use the shared core operation list and composition's redacting work logger.

### T47e — Smaller UX fixes (D3, D5, `bot`)
- Owner: codex · Reviewer: claude-code · Depends on: T47a
- Change: (1) the `/work` new-collection form text says the four lines describe the collection,
  and the work text comes from the photo caption; (2) a show waiting for a new work whose draft was
  discarded offers the work list again instead of `showMissingWorkText`.
- Acceptance and tests: form text test; discarded awaited work → selection menu.
- Review notes from PR #86 (T47d): (1) `apps/bot/src/published-callback.ts` still builds a site
  URL in the "published" notice for site-excluded works, shows and test posts, so a test run sends a
  link that returns 404; pass `siteExcluded` in the publish callback and omit the link when set.
  (2) `WorkSessionOptions.logError` in `apps/bot/src/work-session.ts` is optional, so a missing
  logger silently drops work setup failures; make it required or fall back to a redacted log.

- Done 2026-11-05: PR #87 merged (`b198432`), bot deployed (Worker version
  `99aecbb3-66d9-403b-b7dd-d8613bd8d310`). The publish callback carries optional `siteExcluded`;
  work setup requires the composition logger. Regression tests cover restored selection and
  excluded publication notices.

### T47f — Flaky show transport test (D1, `bot`)
- Owner: codex · Reviewer: claude-code · Depends on: T47
- Change: make `apps/bot/test/show-transport.test.ts` "runs grants, private source reads, journal,
  raw upload, checkpoint and separate marked storage" deterministic (or raise its timeout with a
  reason); it timed out at 5000 ms on CI run 41849567117.
- Tests: the suite passes 10 consecutive local runs.
- Review notes from PR #87 (T47e): (1) `apps/publisher/test/publish-callback.test.ts` covers
  `siteExcluded` in the callback only for `kind: post`; add a work or show case so the
  `publication.post` path is pinned. (2) `apps/bot/src/show-session.ts` wraps the selection block in
  `if (!(selection?.awaitingWorkId && !pending && !work))`; name the condition
  (`const awaitedDiscarded = ...`) for readability.

### T26a — Instagram adapter · revised in v5
- Owner: codex · Reviewer: claude-code · Depends on: T25, T40, H8 · Sensitive: new secrets
- Change: T26 as written above, plus the v7 caption rules from F33: the first ~125 characters carry
  the message (the bot preview shows that window), at most 5 hashtags (hard limit), carousels in 4:5
  (1080x1350, crop or pad without cutting the work), shows as a carousel of their images plus the AI
  label in the caption. A shared Meta token/refresh helper in `channels` is reused by T26b-T26c.
  Rules ported from instagram-agent-skill (MIT) keep its license notice in the ported file.
- Acceptance and tests: as T26, plus caption window, hashtag limit and 4:5 framing tests.

### T26b — Facebook Page adapter (F33, `channels`) · Sensitive: new secrets
- Owner: codex · Reviewer: claude-code · Depends on: T26a
- Change: `FacebookPageChannel` via the Pages API: photo or multi-photo post with the German caption
  and the canonical link (clickable on Facebook); registered and enabled by tenant config.
- Acceptance: one live post appears once; a re-run skips it via the ledger; a failure does not block
  other channels and alerts the operator.
- Tests: mocked Graph API, single vs multi photo, errors.

### T26c — Threads adapter (F33, `channels`) · Sensitive: new secrets
- Owner: codex · Reviewer: claude-code · Depends on: T26a
- Change: `ThreadsChannel` via the Threads API: text plus image or carousel, 500-character limit shown
  in the preview, canonical link in the text.
- Acceptance and tests: as T26b.

### T48 — Email sign-up and lead magnet (F27, `site`, ADR 013) · Sensitive: personal data
- Owner: codex · Reviewer: claude-code · Depends on: T41, H15
- Change: ADR 013 email part accepted with the chosen provider (EU hosting, DPA). Sign-up form on the
  site (German and Ukrainian) posting to the provider's double opt-in form; the provider sends the
  pattern PDF after confirmation. No addresses touch our storage or logs. Datenschutzerklärung gets
  the provider section (texts from the H11 generator, confirmed by Volodymyr). One call to action on
  show and work pages.
- Acceptance: a test address receives the confirmation mail, and the PDF only after confirming; the
  third-party check from T41 allows only the provider's form endpoint.
- Tests: form rendering, build check; the live opt-in is checked manually and recorded in the PR.

### T49 — Comment inbox with author-approved replies (F34, `bot`, `channels`, `ai`) · Sensitive: reader data
- Owner: codex · Reviewer: claude-code · Depends on: T26a-T26c
- Change: `comments` capability on the Meta adapters (list new comments on our posts, reply). A cron
  collects new comments into D1 (tenant, network, comment id, handle, text, status), sends each to
  the author with a Ukrainian translation and a German draft reply (prompt with rules ported from
  `/ig-reply`, MIT notice kept); buttons Send / Edit / Skip. Handled comments are deleted after 30
  days; nothing reaches Git or logs. Costs are booked via `recordCost`.
- Acceptance: a comment is answered at most once; skipped and sent comments disappear after 30 days;
  only allow-listed users see the inbox.
- Tests: mocked APIs, idempotent collect and reply, retention, cost booking.

### Contest on all networks (T27-T32, revised in v5)
- T30 also drafts one numbered carousel post per Meta network (no names, see T28 policy).
- T31 also counts comment votes on those posts through the T49 comment reader (one vote per account
  per network, digits 1..N only), adds the Telegram poll counts and shows the author the total;
  commenter accounts are not stored after the result. Depends additionally on T49.
- No prizes; if a prize is ever added, contest terms and the Meta disclaimer are required first.

## Later (not yet broken down)
Phase 2b video (ADR 012), phase 3 metrics and email (ADR 013), phase 4 shop (ADR 014): started only when
the T33 numbers show the channels are used. Mini App editor, scheduled publishing.

Idea from Volodymyr (2026-11-04, T47 session), not yet a task: a "real model" show on the site,
built from authentic photos of the work worn by Volodymyr, the author, or a faceless model (no
identifiable face, so no consent paperwork), published without the AI label because nothing is
generated. Needs a spec decision (show type, how authenticity is recorded in `provenance`) before
it becomes a task.
