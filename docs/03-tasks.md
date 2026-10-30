# 03 — Tasks

Small reviewable tasks with Owner, Reviewer, acceptance criteria and tests.

Status: **draft v4 (2026-10-30), awaiting Volodymyr's approval.** v4 re-orders the work for spec v6
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
| H8 | Instagram: author switches her account to Creator; Meta developer app with Instagram Login API; long-lived token and IG user ID as secrets. | T26 |
| H9 | Random `NAMES_ENDPOINT_SECRET` (`openssl rand -hex 32`) as GitHub Secret and Worker secret. | T28 |
| H10 | Cloudflare Pages project; API token scoped to Pages deploy only; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Secrets. Domain fadenundstimmung.de is registered (INWX) and its zone is active on Cloudflare (done 2026-10-30); attaching it to Pages is part of T39. | T39 |
| H11 | Impressum fields as GitHub Secrets (names in `.env.example`); confirm the legal page texts. | T41 |
| H13 | Author takes 2-3 good photos (daylight, flat, plus a close-up) of 3 real works: one clothing piece with embroidery, one pillow, one small appliqué or accessory. | T43 |
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

## Order of work (v4)

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

### T42 — AI cost ledger and cost command (F32, `bot`, `core`)
- Depends on: T25
- Change: migration `ai_costs` (tenant_id, at, service, unit, amount_eur, ref); a `recordCost` helper
  used by every AI call (the existing translation call is the first user); config `ai.monthlyTargetEur`
  (20) and `ai.toleranceEur` (5); operator `/cost` (month total, per show, per service, left); warning
  at the target, a hard stop for new shows above target + tolerance; summary on the 1st by cron.
- Acceptance: a fixture month yields the right totals; above the cap a new show is refused with a clear
  message; only the operator can call `/cost`.
- Tests: aggregation, thresholds, month boundaries in `Europe/Berlin`, allow-list.

### T36 — Works and collections (`bot`, `publisher`, `core`, `ai`) · revised in v4
- Depends on: T25, T35, T42
- Change: as v3 (kind `work`, `/work` session, `TextGenerator` port, UA description plus DE version,
  works writer `content/works/<id>/`, `content/collections/<slug>.md`), plus a `kind` field on the work
  (`worn` | `closeup` | `interior`) used to pick the show template; text calls book their cost (T42).
  Site pages for works and collections.
- Acceptance: a published work appears in `content/works/` and on the site with valid frontmatter.
- Tests: schema, builder, mocked generator, site build.

### T43 — Show pipeline spike and ADR 015 (docs and scripts) · Owner: claude-code · Reviewer: kimi-code
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

### T45 — Shows on the site (F30, `site`)
- Depends on: T44, T41
- Change: shows list and show pages (images, video, work link, model name, "KI-generiertes Model"
  label), home page highlights the latest show, German default and `/uk/`.
- Acceptance: a published show appears on the site after the rebuild; every generated image is labelled
  on the page.
- Tests: page build tests, label presence.

### T46 — Show copies to channels (F30-F31, `publisher`, `channels`)
- Depends on: T45, T40
- Change: a show publishes to the site first, then Telegram (album + video + canonical link) and, once
  T26 exists, Instagram (carousel and Reels). A failed copy never blocks the site.
- Acceptance: a show post links to its page; a re-run does not duplicate.
- Tests: render per channel, ledger resume.

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

## Later (not yet broken down)
Phase 2b video (ADR 012), phase 3 metrics and email (ADR 013), phase 4 shop (ADR 014): started only when
the T33 numbers show the channels are used. Mini App editor, scheduled publishing.
