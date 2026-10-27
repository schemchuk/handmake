# 03 — Tasks

Small reviewable tasks with Owner, Reviewer, acceptance criteria and tests.

Status: approved v2 (2026-10-21). v2 adds ports and tenancy (spec v4).
Scope: MVP (spec section 5), Telegram only, built on the ports from architecture section 11.
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
| H8 | Instagram: author switches her account to Creator; Meta developer app with Instagram Login API; long-lived token and IG user ID as secrets. | T24 |

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

### T22 — Work-of-the-week candidates and poll draft (F19 part 2, `bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T21
- Change: Monday cron (tenant `workOfWeek.opens`) takes the last 7 days from `published_posts`, one
  photo per post, newest 10, and creates a `wotw-poll` draft for the author's preview and 🚀. Fewer than
  2 candidates → no poll, the author is told. Runs only with `featureFlags.wotwPoll: true`.
- Acceptance: one poll draft per week; feature flag off → nothing.
- Tests: candidate selection, flag, idempotent cron.

### T23 — Close poll, pick winner, result draft (F19 part 3, `bot`, `ai`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T22
- Change: closing cron calls `closePoll`; most votes wins; zero votes, unreadable result or a tie →
  `WinnerPicker` (Claude with the candidate photos, one-line reason). Creates a `wotw-result` draft
  ("chosen by readers" / "chosen by AI") for the author's 🚀.
- Acceptance: each case yields exactly one result draft with the right wording.
- Tests: winner rules incl. ties and zero votes, mocked WinnerPicker.

### T24 — Instagram adapter (phase 1b, `channels`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T19, H8
- Change: `InstagramChannel` via Instagram Login API (container → publish, carousel for 2-10 photos),
  German caption by default (tenant setting), 2200-char limit in the preview; channel enabled only when
  configured (F12). Photos need public URLs: serve them from the repo's raw URLs of the committed post.
- Acceptance: a live post appears on Instagram once; re-run skips it via the ledger.
- Tests: mocked Graph API, carousel vs single photo, limit errors.

## Later (not yet broken down)
Mini App editor · scheduled publishing · website (phase 2) with Impressum / Datenschutzerklärung ·
participant submissions (phase 3, needs Volodymyr's approval: personal data) · presentation slides.
