# 03 — Tasks

Small reviewable tasks with Owner, Reviewer, acceptance criteria and tests.

Status: draft v1 (2026-10-21), awaiting Volodymyr's review. Scope: MVP (spec section 5), Telegram only.
Each task: one branch `feat/<id>-<slug>`, one PR, reviewable in 10-15 minutes. Do tasks in order unless
"Depends on" says otherwise. A task is done when its tests pass in CI, docs are updated, and Volodymyr
merged it.

## Human tasks (Volodymyr only: accounts and secrets)

Agents never create accounts or handle secret values. Each item unblocks the tasks listed.

| ID | What | Unblocks |
|---|---|---|
| H1 | Create a private **test** Telegram channel; add the bot as admin. Note both channel IDs. | T07, T17 |
| H2 | Cloudflare account; `wrangler login` locally. | T13 |
| H3 | Anthropic API key (console), spending limit set to 10 EUR. | T12, T15 |
| H4 | Fine-grained GitHub token: this repo only, permission "Contents: read and write" for `repository_dispatch`. | T16 |
| H5 | Put secrets into GitHub Secrets and Worker secrets (names in `.env.example`). | T11, T16 |
| H6 | Decide O1 (Telegram DE layout) and O2 (content commits to main). | T05, T00, T10 |

## Tasks

### T00 — Allow content commits to main in AGENTS.md
- Owner: claude-code · Reviewer: Volodymyr · Depends on: H6 (O2 approved)
- Change: Git rules get an exception: the publish workflow may commit to `main` under `content/` only,
  as the bot identity. Branch protection note for Volodymyr.
- Acceptance: AGENTS.md and ADR 003 consistent; nothing else changed.
- Tests: n/a (docs).

### T01 — Workspace scaffold
- Owner: kimi-code · Reviewer: claude-code
- Change: pnpm workspace (`apps/bot`, `apps/publisher`, `packages/core`, `packages/adapters`,
  `packages/ai`), TypeScript strict base config, ESLint + Prettier, Vitest, `.nvmrc` (Node LTS),
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
- Change: zod schema for a post (architecture section 3: id ULID, group, date, publishAt, type, photos,
  channels, versions with provenance `human | ai-assisted | ai-generated`); `parsePost(md)` and
  `serializePost(post)` with `<!-- lang:xx -->` sections.
- Acceptance: round-trip `serialize(parse(x)) == x` for fixtures; invalid provenance or missing language
  section raises a clear error.
- Tests: unit tests with 3 valid and 4 invalid fixtures.

### T04 — Group config schema and loader (`core`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01
- Change: zod schema and loader for `config/groups/*.yaml`: name, languages and order, channels,
  `instagram.defaultLanguage`, meeting schedule (weekday, time, IANA zone), empty `offerings`, secret
  *names*. Add `config/groups/faden-und-stimmung.yaml` (Thursday 14:00 Europe/Berlin, languages uk, de).
- Acceptance: loader rejects any key that looks like a secret value; the real config file validates.
- Tests: unit tests for valid config, missing fields, unknown channel, secret-looking value.

### T05 — Telegram renderer and limits (`core`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T03, H6 (O1)
- Change: `renderTelegram(post, config)` returns an ordered list of send operations: UA album with
  caption if ≤ 1024 chars else album + text message (≤ 4096); DE per O1. Text over 4096 → validation
  error (F9). Plain text, no parse mode in the MVP.
- Acceptance: the same function output is used later by the bot preview and the publisher.
- Tests: table tests for 0 / 1 / 10 photos, caption at 1024 / 1025 chars, text at 4096 / 4097 chars.

### T06 — Ledger model (`core`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T03
- Change: ledger type and pure functions: `pendingChannels(ledger, post)`, `markDone`, `markFailed`;
  JSON (de)serialization.
- Acceptance: a channel marked `done` is never returned as pending; failures keep the last error.
- Tests: unit tests for all transitions, including a re-run after partial failure.

### T07 — Telegram adapter (`adapters`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T05, H1 for the manual check
- Change: `ChannelAdapter` interface (`deliver(ops) → remote IDs`) and the Telegram implementation
  (`sendMediaGroup`, `sendMessage`, `reply_parameters`) with retry on 429 honouring `retry_after`.
  Bot token injected, never logged.
- Acceptance: tests run without network; a manual script posts a sample to the **test** channel.
- Tests: HTTP fixtures (success, 429 then success, 400 error).

### T08 — Photo processing (`publisher`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01
- Change: download by `file_id` via `getFile`; re-encode to JPEG, strip all metadata, max 2048 px long side.
- Acceptance: output has no EXIF/GPS; output dimensions respect the limit.
- Tests: fixture JPEG with GPS EXIF → output checked for no metadata; PNG and large image cases.

### T09 — Content folder builder and dry-run (`publisher`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T03, T04, T05, T08
- Change: from a dispatch payload (draft ID, texts, file_ids, provenance) build
  `content/posts/<date>-<slug>/` with `index.md` and photos; `publisher --dry-run <payload.json>` prints
  the planned Telegram operations and writes nothing outside a temp dir.
- Acceptance: the folder validates with `parsePost`; dry-run output matches `renderTelegram`.
- Tests: unit test with a sample payload and mocked downloads; CI runs dry-run on `fixtures/sample-payload.json`.

### T10 — Delivery with ledger idempotency (`publisher`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T06, T07, T09, T00
- Change: `publisher publish <payload>`: build folder → commit → for each pending channel deliver →
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

### T12 — AI translation and humanizer prompt (`ai`)
- Owner: claude-code · Reviewer: kimi-code · Depends on: T01, H3 for the live check
- Change: `translateToGerman(ukText) → { de, notes }` via the official Anthropic TypeScript SDK,
  structured output, model ID from config (default `claude-opus-5-5`); prompt
  `packages/ai/prompts/humanize-de@1.md` (translation + humanizer rules); 5 sample UA texts as an eval seed.
- Acceptance: unit tests with a mocked SDK; a manual eval run on the 5 samples is attached to the PR
  for Volodymyr and his wife to judge.
- Tests: mocked success, refusal / API error → typed error the bot can show (F7).

### T13 — Bot Worker skeleton
- Owner: kimi-code · Reviewer: claude-code · Depends on: T01, H2
- Change: `apps/bot` with grammY on Cloudflare Workers, `wrangler.toml`, D1 migration (drafts,
  publish requests), webhook secret-token check, allow-list from secrets, `/start` reply. Webhook
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
- Change: after collecting, call `translateToGerman` in `waitUntil`; send preview built from
  `renderTelegram`; buttons Edit UA / Edit DE / Regenerate DE / Publish / Discard; edit by reply
  (ADR 005); limit warnings block Publish.
- Acceptance: A1 and A2 from the spec on the test bot.
- Tests: handler tests with mocked AI and Telegram API.

### T16 — Publish button, consent and dispatch (`bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T11, T15, H4
- Change: Publish → consent question → atomic `ready → publishing` → `repository_dispatch`; status
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

## After the MVP (planned, not yet broken down)
Instagram adapter (phase 1b) · F18 announcements and reminders · F19 work of the week ·
Mini App editor · scheduled publishing · website (phase 2) with Impressum / Datenschutzerklärung ·
presentation slides.
