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
| H8 | Meta (extended in v5): author switches her Instagram account to Creator or Business; a Facebook Page and a Threads profile for the brand; one Meta developer app with Instagram, Pages and Threads APIs; long-lived tokens and account/page IDs as secrets. Every profile links to the Impressum. **Done 2026-11-09:** GitHub Secrets set: `META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `THREADS_APP_ID`, `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN`. Worker `handmake-bot` secrets set: the six `META_*`/`INSTAGRAM_*`/`FACEBOOK_*` names read by `apps/bot/src/env.ts`. Impressum links in the profiles not verified. | T26a-T26c, T49 |
| H9 | Random `NAMES_ENDPOINT_SECRET` (`openssl rand -hex 32`) as GitHub Secret and Worker secret. **Done 2026-11-11:** one value generated locally and piped via stdin into GitHub Secret and Worker `handmake-bot` secret `NAMES_ENDPOINT_SECRET` (both verified by `secret list`). | T28 |
| H10 | Cloudflare Pages project; API token scoped to Pages deploy only; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Secrets. Domain fadenundstimmung.de is registered (INWX) and its zone is active on Cloudflare (done 2026-10-30); attaching it to Pages is part of T39. **Done 2026-10-31:** Pages project `fadenundstimmung` (Direct Upload, created with `wrangler pages project create --force`), both secrets set. | T39 |
| H11 | Impressum fields (author's name, home address, email) as GitHub Secrets `IMPRESSUM_NAME`, `IMPRESSUM_STREET` (street and house number), `IMPRESSUM_CITY` (postal code and city), `IMPRESSUM_EMAIL` (T41 adds these names to `.env.example`). The generator texts reach T41 with the placeholders `{{IMPRESSUM_NAME}}`, `{{IMPRESSUM_STREET}}`, `{{IMPRESSUM_CITY}}`, `{{IMPRESSUM_EMAIL}}` in place of the real values. Generate the Impressum and Datenschutzerklärung texts with a free generator by lawyers (for example datenschutz-generator.de or e-recht24), listing the processors from T41, and hand the result to the T41 owner; Volodymyr and the author confirm the final pages. **Done 2026-11-04:** the four secrets are set; texts in `docs/legal/` (`datenschutz.de.html` from datenschutz-generator.de free version, its attribution line must stay; `impressum.de.html` from e-recht24 free generator, Privatperson, §18 MStV line, no phone). The free Datenschutz modules cover hosting/CDN, logfiles, blog, email contact, web analytics, Instagram, Facebook Page and Threads; T41 adds short paragraphs for Cloudflare (named), Cloudflare Web Analytics and the Telegram channel, marked for Volodymyr's and the author's review. A shop later needs the paid license. | T41 |
| H14 | Enable Cloudflare Web Analytics for the Pages project `fadenundstimmung` (dashboard toggle, cookieless). **Done 2026-11-04:** enabled in the Pages project Metrics tab. **Reverted 2026-11-04:** Volodymyr disables it again (the JS beacon reads browser data, a §25 TDDDG consent risk); visits are read from the Cloudflare zone traffic statistics instead, which need no script; disabled and redeployed the same day (no beacon on the live site). | T41, T41b |
| H16 | (F35, spec v8 approved 2026-11-06) Volodymyr creates a Telegram group «Faden und Stimmung · Austausch» and links it to the channel as its discussion group (channel settings → Discussion). Group settings: only members may write and comment; slow mode 30 s; members may send photos and text only (video, files, voice, stickers, polls off), link previews off, adding members/pinning/changing info off; built-in anti-spam on. Telegram cannot block plain-text links or forwards by setting, so that rests on anti-spam, moderation and the rules. Volodymyr is the admin; the bot is not added; the author joins only if she wants, with notifications off. He adds the group link to the channel description and pins the rules once the author approves their wording (T50). **Done 2026-11-06:** group created and linked, rules approved and pinned, link in the channel description. | T50 |
| H15 | Email service account with EU hosting and a data processing agreement (Brevo or MailerLite, decided in T48); the author prepares one free embroidery pattern as a PDF (lead magnet). **Account part done 2026-11-11:** Brevo (free plan: 500 contacts, 300 mails/day; EU hosting, DPA part of the terms; MailerLite free dropped to 250 subscribers in June 2026). Account login is a dedicated brand Gmail (Volodymyr has access). Cloudflare Email Routing forwards `hallo@fadenundstimmung.de` to it (MX/SPF by Cloudflare). Domain `fadenundstimmung.de` authenticated in Brevo: TXT `brevo-code` at the apex, CNAME `brevo1._domainkey`/`brevo2._domainkey` (DNS only), TXT `_dmarc` `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`. Verified sender `Faden und Stimmung <hallo@fadenundstimmung.de>` (the Gmail sender removed). Empty list `Newsletter` (id 3). No branded subdomain, no API key, no form yet (T48). **Lead magnet done 2026-11-11:** `Rosenbluete_Kreuzstichvorlage_v2.pdf` (German, A4, 2 pages, 78 KB; 54 × 67 stitches, Aida 14, 4 DMC colours) charted from a photo of the author's own work; the author approved it with the review fixes (84 isolated stitches merged, decimal commas, grid numbered from 1). Kept locally by Volodymyr, NOT committed; T48 decides where the provider hosts it. | T48 |
| H17 | Fine-grained GitHub token for T26d: this repo only, permission "Secrets: read and write", longest expiry offered; store it as GitHub Secret `SECRETS_WRITE_TOKEN` and note its expiry date in STATUS.md. **Done 2026-11-10:** token `handmake-secrets-write` (repo `schemchuk/handmake` only, Secrets read/write, Metadata read) with no expiration (Volodymyr's choice), stored as GitHub Secret `SECRETS_WRITE_TOKEN`. | T26d |
| H18 | (T49d go-live) Re-authorize the Threads token with `threads_basic`, `threads_content_publish`, `threads_read_replies` and `threads_manage_replies`, then update GitHub Secret `THREADS_ACCESS_TOKEN` and set Worker `handmake-bot` secrets `THREADS_USER_ID` and `THREADS_ACCESS_TOKEN`. Create a Cloudflare API token limited to "Workers Scripts: Edit" on this account and store it as GitHub Secret `CLOUDFLARE_WORKERS_TOKEN`. Apply the T49d D1 migration to remote. **Partly done 2026-11-10:** new Threads token (issued 16:16 UTC, expires 2027-01-09; scopes `threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies`, `threads_manage_insights`) in GitHub Secret `THREADS_ACCESS_TOKEN` and Worker secrets `THREADS_ACCESS_TOKEN`/`THREADS_USER_ID`; `CLOUDFLARE_WORKERS_TOKEN` (Workers Scripts: Edit, one account, expires 2030-05-31) set. Migration waits for the T49d PR. | T49d |
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
- Split approved by Volodymyr in chat 2026-11-11 before coding (ADR 009): T27a → T27b keeps each PR below
  approximately 400 changed non-test lines. T28 and T30 depend on completion of both parts.
- Scope confirmed by Volodymyr in chat 2026-11-11: optional consented first names/nicknames may
  be stored in D1; participants' works are not published on the website. This is the explicit
  contest exception to the Phase 1 participant-data prohibition in AGENTS.md. No deployment or
  remote migration is authorized by this scope confirmation.

### T27a — Contest persistence and submission source (`bot`, `core`)
- Done: PR #108 merged 2026-11-11 (`f346d5a`) with Volodymyr's OK. Migration 0012 applied remotely and
  bot deployed (Worker `8b18b4da`) by Volodymyr 2026-11-11.
- Owner: kimi-code (Codex per AGENTS.md) · Reviewer: claude-code · Depends on: T25
- Change: add the network-independent `SubmissionSource` port and contest entry types; add a D1
  migration and tenant-scoped store for `contest_entries` (entry_id, tenant_id, week, file_id,
  display_name?, consent_at, status `submitted` | `withdrawn`, created_at). Persist submitted
  entries only with explicit consent. Add `AuthorEntrySource`: submitted entries for the requested
  week, in stable submission order, max 10; names stay outside Git and source payloads.
- Contest week is the Monday calendar date (`YYYY-MM-DD`) in `Europe/Berlin`, shared with T27b.
  Equal creation timestamps are ordered by entry ID. No participant Telegram IDs.
- Acceptance: missing consent is rejected; tenant isolation holds; repeat insertion is idempotent;
  source ordering is deterministic and limited to 10; errors never contain display names.
- Tests: real local D1 migration/store, consent validation, tenant isolation, duplicate insertion,
  withdrawn filtering, equal-timestamp ordering, source limit, Berlin week/year and DST boundaries.
- Review notes from PR #107 (T48, `site`, fix in this PR): (1) remove the stale `<!-- T48 DRAFT ... -->`
  comment from `docs/legal/datenschutz.de.html` and the test expecting it; (2) `site.newsletter.formAction`
  is duplicated by the hard-coded `newsletterFormAction` (Newsletter.astro throws on mismatch): derive the
  build-policy allow-list from tenant config or reduce the field to a flag; (3) delete or mark archived
  `docs/legal/newsletter.de.html`; (4) drop the double blank line before the T48 section in `apps/site/README.md`.
- Validation for carried-forward fixes: site legal/build-policy tests and fixture builds.

### T27b — Author contest-entry session (`bot`)
- Done: PR #109 merged 2026-11-11 (`3f76758`) with Volodymyr's OK. Lifecycle and rollout:
  `docs/contest-entry-session.md`. Migration 0013 applied remotely and bot
  deployed (Worker `7d463a14`) by Volodymyr 2026-11-11.
- Owner: kimi-code (Codex per AGENTS.md) · Reviewer: claude-code · Depends on: T27a
- Change: wire an explicit `/entry` session, isolated from post/work/show drafts: exactly one photo,
  optional first name/nickname (≤ 30 characters), anonymous option and mandatory consent button.
  Use a session-specific callback identity and atomic persistence so stale/repeated/concurrent
  confirmations cannot submit changed content or duplicate entries. Unconfirmed input must not be
  stored as a submitted entry; document the transient input lifecycle and cancellation behavior.
- Consent text (UA) states that the photo may appear on Telegram, Instagram, Facebook and Threads;
  an optional name may appear on Telegram only. No website publication. It explains withdrawal via
  the author and the ADR 010 retention policy. It also requires no identifiable faces without written
  consent. Legal wording remains subject to Volodymyr's review before sensitive merge.
- Acceptance: no submitted entry without consent; second photos are refused; names never appear in
  logs, post drafts or dispatch payloads; switching flows cannot route entry input into post drafts.
- Tests: full session flow, anonymous entry, consent required, 30-character boundary, second photo,
  cancellation, stale/repeated/concurrent callbacks, flow switching and no name-bearing diagnostics.
- Rollout: reviewer requests Volodymyr's approval before applying the new remote D1 migration.
- Review notes from PR #108 (T27a, fix in this PR): (1) `packages/core/test/contest.test.ts` DST cases
  hit Sunday transition instants; add the Monday-midnight boundaries `2026-03-29T21:59:59Z→2026-03-23`,
  `2026-03-29T22:00:00Z→2026-03-30`, `2026-10-25T22:59:59Z→2026-10-19`, `2026-10-25T23:00:00Z→2026-10-26`;
  (2) `NewContestEntry.photoRef` is stored as `file_id`: align the names or document the mapping.

### T28 — Names endpoint and placeholder resolution (`bot`, `publisher`, `core`)
- Done: PR #111 merged 2026-11-11 (`2aea875`) with Volodymyr's OK. Bot deployed from clean `main`
  (Worker `48923756`) 2026-11-11; unsigned endpoint request returns 401. No migration.
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
- Done: PR #110 merged 2026-11-11 (`168615f`) with Volodymyr's OK. Migration 0014 applied and bot
  deployed (Worker `468958bb`) by Volodymyr 2026-11-11.
- Depends on: T25
- Change: callback body `channels: { <channel>: { status, messageIds: { main?, poll? } } }`, IDs found
  by op kind at deliver time. Migration: `channel_deliveries` (tenant_id, post_id, channel, status,
  message_ids JSON), upsert. The bot accepts the v1 body during the switch-over (one release).
- Acceptance: after a poll post, D1 holds its poll message ID; re-sent callback changes nothing.
- Tests: schema v1/v2, op-kind lookup, idempotent upsert.

### T30 — Poll draft cron (F19 part 2b, `bot`)
- Done: PR #112 merged 2026-11-11 (`696e610`) with Volodymyr's OK. Migration 0015 applied remotely; bot deployed (Worker `0f645813`).
- Depends on: T27, T28, T29
- Change: Monday-open cron (`workOfWeek.opens`) builds a `wotw-poll` draft (kind `post`, extras: poll
  spec + entry refs) from `AuthorEntrySource`: album 1..N, poll "No 1".."No N", captions with
  placeholders. `< 2` entries → the author is told, no draft. Deterministic per-week draft id,
  insert-or-ignore, flag `featureFlags.wotwPoll`.
- Acceptance: one poll draft per week; flag off → nothing; the author sees names in the preview.
- Tests: window math incl. DST, `< 2` rule, idempotent cron, flag.
- Implementation notes: opening selects the previous calendar week, `contestWeek(opening - 7 days)`
  (decision Volodymyr 2026-11-11: the circle meets on Thursday, the poll opens on Monday). The 45-minute catch-up window uses the tenant timezone.
  `poll_openings` receipts (migration 0015) atomically record a draft or a skipped week, so retries,
  concurrent ticks and discarding a draft cannot reopen the same week. Fixed UA/DE starter texts
  remain editable before Publish; cron makes no paid calls. Delivery of the private preview or
  skipped-week notice is best effort after the receipt: failed/ambiguous notification is not retried.
  Production flag remains off; migration and deployment require Volodymyr's approval.
- Review notes from PR #112 (non-blocking, fix in T31): (1) `poll-opening-store.ts` duplicates the
  drafts `INSERT` column list from `draft-store.ts`; share one statement builder; (2) the `Work No N`
  name fallback is English inside UA/DE captions; localize it.
- Review notes from PR #111 (addressed in T30): (1) replace inline `import('@handmake/core').EntryNames`
  types in `apps/bot/src/bot.ts` and `apps/bot/src/preview.ts` with `import type`; (2)
  `resolveEntryNames` parses the text twice when `order` is defaulted; (3) move
  `export * from './entry-names'` in `packages/core/src/index.ts` into the file's export ordering;
  (4) a stray `{entry` in an author's draft makes `buildTenantPreview` throw
  `Invalid entry placeholder`: show a friendly preview message instead.

### T31 — Close poll, author breaks ties, result draft (F19 part 3, `bot`)
- Depends on: T30
- Change: closing cron reads the poll message ID from `channel_deliveries` and calls `closePoll`. Most
  votes wins. Zero votes, unreadable result or a tie → the bot sends the author the tied candidates as
  inline buttons; her choice decides. A `wotw-result` draft ("chosen by readers" / "chosen by the
  author") follows for her 🚀. Winner flag stored on the entry (needed for retention, T32).
- Acceptance: each case yields exactly one result draft with the right wording; a second cron run does
  nothing.
- Tests: winner rules incl. ties and zero votes, button callback, idempotency.

#### T31 implementation split — approved 2026-11-11

The complete task includes the v7 all-network extension below. Closing/recovery, transient
comment counting, author callbacks and atomic result persistence exceed the ADR 009 budget
for one PR. Approved order: T31a → T31b → T31c → T31d. Each subtask has Owner: codex and
Reviewer: claude-code, needs a fresh session and its own PR, and targets fewer than 400 changed
non-test lines. T31 remains incomplete until all four pass independent review. Volodymyr approved
this split in chat on 2026-11-11 (AGENTS.md workflow step 4).
The production flag stays off; no deployment, remote migration or live publication is part
of this proposal.

##### T31a — Shared draft insertion and localized entry fallback

- Done 2026-11-11: PR #113 reviewed by claude-code and merged (`95a9afd`). The shared statement also serves
  collecting drafts. UA/DE captions resolve in their own language; unkeyed poll fields use
  the first post language. Unknown languages retain the English fallback.
- Depends on: T30 and approval of this split.
- Change: address both PR #112 review notes: share the draft INSERT statement builder between
  the draft and poll-opening stores without changing transactional receipt semantics; localize
  the numbered fallback in UA/DE captions, including previews and channel rendering.
- Acceptance: skipped/discarded/concurrent opening behaviour is preserved; missing or hidden
  names use the caption language, and names remain outside persisted drafts and Git.
- Tests: draft/opening D1 regressions; UA/DE fallback with names present, absent and disallowed.

##### T31b — Durable closing state and Telegram tally

- Done 2026-11-11: PR #115 reviewed by claude-code and merged (`2729560`). Migration 0016 not yet
  applied remotely; the closing service has no caller until T31d.

- Depends on: T31a.
- Change: add tenant/week closing persistence and a network-independent tally model; resolve
  the published poll and its ordered entry refs from channel deliveries; close through the
  channel capability and save validated counts. Specify retry/recovery for a poll stopped
  before counts were saved; unreadable results must reach author selection without inventing
  counts. Keep the incomplete closing flow disabled until T31d wires it.
- Acceptance: unpublished/skipped openings produce no result; repeated or concurrent work
  cannot replace a completed tally; candidate order and tenant identity are checked. A failed
  close is distinguished from zero votes. Any migration is local/test-only in this task.
- Tests: delivery lookup, option/count validation, zero/tie/unique-leader rules, tenant isolation,
  concurrent claims and interruption before/after closing the remote poll.
- Review notes from PR #113: (1) replace the nested ternary for fallback labels in
  `packages/core/src/entry-names.ts` with a `Record<string, string>` lookup; (2) unkeyed poll
  fields take the first `texts` key (YAML order): document this in the content format docs or
  add an explicit poll language.

##### T31c — Transient Meta vote totals

- Done 2026-11-11: PR #116 merged after claude-code review (no blocking findings). Deterministic collection rules:
  [contest-vote-collection.md](contest-vote-collection.md). Includes both PR #115 notes:
  30-second `stopPoll` deadline and an explicit skipped-opening receipt regression
  (delivery status supports only `done`/`failed`; skipped publication has no delivery).
- Depends on: T31b, T49b and T49d.
- Change: use the existing comment-reader capability on the published contest posts for
  Instagram, Facebook and Threads; accept digits 1..N only, count one vote per account per
  network and combine with Telegram counts. Keep account identifiers in memory only; persist
  aggregate counts and collection completeness. Do not use the persisted comment inbox as
  the vote source. Define deterministic duplicate-comment handling in the implementation
  notes before coding.
- Acceptance: counts are tied to the published candidate order and tenant; pagination is
  complete or explicitly unreadable; partial/API-failed counts cannot silently become a
  final reader result; no voter identifiers enter D1, drafts, Git or logs.
- Tests: pagination, duplicate accounts, invalid/out-of-range votes, cross-network identity,
  missing/unpublished posts, reader failures and aggregate persistence without voter data.
- Review notes from PR #115: (1) `closePoll` (`stopPoll`) has no request timeout; a call that
  outlives the 5-minute closing lease loses real counts to `unreadable` recovery. Bound the call
  well below the lease (e.g. `AbortSignal.timeout`). (2) `apps/bot/test/poll-closing.test.ts`
  "ignores skipped, failed and legacy deliveries" lacks an explicit `skipped` delivery case.

##### T31d — Author selection, result draft and cron integration

- Depends on: T31c.
- Change: wire the configured closing window and author callbacks to the durable tally.
  Telegram-only unique leaders use reader wording; ties offer tied candidates, zero/unreadable
  results offer all candidates and use author wording. For combined network votes, follow
  spec v7 F19: show totals and require the author's winner decision. Atomically create one
  deterministic `wotw-result` draft and set the entry winner flag for T32. Result content uses
  name placeholders and goes through the existing preview/Publish flow for all channels.
- Acceptance: exactly one result per tenant/week, including competing callbacks and cron
  retries; only authorized authors can choose from that closing's candidates; stale buttons
  cannot alter a result. Notifications can fail without losing durable state or creating
  duplicate drafts. No automatic result publication or flag enablement.
- Tests: full closing-to-preview cases, source wording, callback authorization and tenant
  isolation, stale/concurrent choices, atomic winner/draft rollback, DST/year boundaries,
  flag-off behaviour and cron failure isolation. Run affected suites plus workspace checks.
- Review notes from PR #116: (1) Instagram `mapComment` does not skip the owner account, so an
  author comment like "1" under the ballot counts as a vote; skip owner comments in the contest
  path. (2) Meta collection has no overall deadline inside the 5-minute closing lease; bound it
  well below the lease or log when `finish` returns false. (3) Skip Meta sources when the
  Telegram tally is already `unreadable`. (4) Only ASCII `1..N` count (keycap emoji ignored):
  the ballot text must say "reply with a plain digit". Before going live, check on a real Page
  post that Facebook returns `from.id` for reader comments; without it any digit comment makes
  the whole result unreadable (fail-closed, accepted for now).

###### T31d split — approved by Volodymyr, 2026-11-12

Inspection of the existing closing store and cron shows three distinct remaining units:
collection hardening, atomic result persistence, and bot/cron integration. Implementing them
together would exceed the ADR 009 budget of roughly 400 changed non-test lines. The parent
acceptance criteria above remain unchanged. Approved order: T31d1 → T31d2 → T31d3, each in a
fresh session with its own PR. Owner: codex. Reviewer: claude-code. Volodymyr approved this
split in chat on 2026-11-12 (AGENTS.md workflow step 4).

- **T31d1 — Closing collection hardening.** Address all four PR #116 notes above: exclude
  Instagram owner comments in contest counting, bound total collection below the closing lease,
  skip Meta reads after an unreadable Telegram tally, and make the generated ballot explicitly
  request a plain digit. Keep other comment inbox behaviour intact. Acceptance: no owner vote,
  no partial counts on timeout, durable unreadable recovery, and no unnecessary Meta calls.
  Tests: owner/reader fixtures, stalled collection and late completion, unreadable Telegram,
  and generated UA/DE ballot instructions. No live caller or flag change.
- **T31d2 — Atomic result persistence and winner rules.** Derive allowed choices from the stored
  immutable tally: Telegram-only positive unique leader uses reader wording; ties allow tied
  candidates; zero/unreadable allows all; combined counted sources require an author choice
  from all candidates and expose totals. Persist one deterministic ready `wotw-result` draft
  with name placeholders and the chosen entry's photo, atomically with its winner flag for T32.
  Use the existing closing snapshot and draft insertion helper; no stored display names or
  commenter identities. Acceptance: tenant/week isolation, no overwrite by stale or competing
  decisions, and rollback of both draft and winner on failure. Tests: decision table, real D1
  concurrency/retries/rollback and placeholder-only persisted content. No live caller yet.
  Done: PR #118 merged 2026-11-12; remote migration 0017 applied, Worker
  `2ead6d29-f799-45fc-a620-8f7cc933878a`.
  Review notes from PR #117: Instagram comment `from.id` is documented as an Instagram-scoped
  ID and may never equal the IG User ID secret, and the owner filter fails open without `from`.
  Before T31d goes live, verify on a real owner comment; if the IDs differ, also match
  `from.username` against the account username fetched once per contest read.
- **T31d3 — Author callbacks, preview and cron.** Wire configured closing windows, channel
  adapters and the durable result service into the existing scheduler. Route author choices
  through the allow-list and the closing's candidate restrictions, show combined totals, and
  send the existing tenant preview/Publish flow after result creation. Acceptance: full
  closing-to-preview flow; callbacks check tenant, author and current feature flag; stale
  buttons cannot change results; failed notification cannot undo state or duplicate drafts;
  failed tenant/cron work does not prevent other scheduled work. Tests: authorized/unauthorized
  and cross-tenant callbacks, competing cron/callback execution, notification failure,
  DST/year boundaries, flag-off behaviour and cron failure isolation. Run affected suites
  and workspace checks. No automatic publication or flag enablement.
  Done: PR #119 merged 2026-11-12; Worker `45accbdd-6840-4ffa-863b-33ed8d2e342e`.
  Rollout prerequisites before enabling `wotwPoll`: docs/contest-vote-collection.md.

### T32 — Withdrawal and retention (`bot`, `channels`)
- Depends on: T29, T31
- Until T32 ships (Volodymyr, 2026-11-11): the T27b consent text keeps the 90-day name-deletion
  promise; names are deleted manually in D1.
- Change: `editMessage` capability on the Telegram adapter (`editMessageCaption` or `editMessageText`,
  adapter decides). `/entries` lists recent entries with a "withdraw name" button: the name is deleted
  in D1, the affected Telegram messages are re-rendered and edited using `channel_deliveries`. Daily
  cron deletes names of non-winning entries 90 days after the result post; winners keep the name until
  withdrawal (ADR 010). Site rebuild hook is a no-op until T39.
- Acceptance: after withdrawal the channel shows "Work No N"; Git history never contained the name.
- Tests: edit caption vs text, retention dates, winner exemption.

#### T32 implementation split — approved by Volodymyr 2026-11-12

The original task exceeds the ADR 009 review budget. Callback v2 retains only `main` and `poll`,
although Telegram also publishes separate language replies. Draft cleanup removes the source needed
for later edits. Implement in order, one fresh session and PR per subtask; keep `wotwPoll` disabled
until the complete withdrawal/retention path is reviewed and deployed. No production publishing,
name deletion, migration application or flag enablement is authorized by this proposal.

#### T32a — Optional message editing capability (`core`, `channels`)
- Owner: codex · Reviewer: claude-code · Depends on: T29
- Change: define a network-independent optional `editMessage` capability. Telegram selects
  `editMessageCaption` for a media caption and `editMessageText` for a text operation; resolve the
  destination through tenant secrets. Reuse bounded retry/error handling without logging names,
  request bodies or token-bearing URLs. Treat an unchanged message as successful reconciliation.
- Acceptance: edits target an existing message, never send a new post; unsupported operation kinds
  fail safely. Other adapters need no implementation.
- Tests: caption versus text, target/secret resolution, unchanged-message success, rate limiting,
  permanent rejection and sanitized network failures. Run affected channels tests and workspace checks.

#### T32b — Durable anonymous edit receipts (`core`, `publisher`, `bot`)
- Owner: codex · Reviewer: claude-code · Depends on: T32a
- Change: extend the signed callback compatibly to record all editable operation IDs and their
  anonymous source/render metadata, including language replies. Store a bounded, tenant-scoped D1
  receipt that survives draft cleanup; source contains entry placeholders only, never resolved names.
  Preserve publication layout/settings needed to re-render after config changes. Persist the first
  successful result-publication timestamp for retention; draft creation and callback receipt time are
  not substitutes for publication time. Add a migration if required, without applying it remotely.
- Acceptance: retries preserve receipts and the original publication timestamp; legacy callbacks remain
  accepted but incomplete receipts are detectable. No name enters Git, callback payloads or receipts.
  Enumerate every affected message after draft cleanup, including both languages and result posts.
- Tests: real D1 callback round-trips, duplicate/legacy callbacks, tenant isolation, receipt bounds,
  placeholder-only payloads, all operation IDs and stable publication time. Run affected publisher,
  core and bot suites plus workspace checks.
- Review notes from PR #120 (non-blocking): the Telegram `retry_after` bound (finite, 0..300 s)
  also applies to the send path, so an out-of-range value is now a permanent error, not a retry.
  Add tests for out-of-range `retry_after` on both send and edit.

- Implementation contract (T32b): optional per-channel `editReceipt` carries the anonymous
  operation plan, all ordered remote IDs and channel completion time. The ledger freezes the plan
  before sending; subsequent runs resolve current names into that fixed layout and reuse its secret
  names/settings. Name expansion beyond the fixed layout fails safely. Legacy/partial ledgers are
  not retrofitted: absence of a receipt means reconciliation is incomplete.
  D1 `anonymous_edit_receipts` is independent of draft cleanup; `poll_results.published_at` records
  the first successful result delivery, never the callback arrival time. Apply migration 0018 before
  deploying the receiving bot, with Volodymyr's approval; leave `wotwPoll` disabled through T32d.

#### T32c — Author withdrawal and recoverable message reconciliation (`bot`)
- Owner: codex · Reviewer: claude-code · Depends on: T32b
- Change: allow-listed `/entries` lists bounded recent entries with a withdraw-name action. Clear only
  the name, retaining the submitted work, numbering, consent and winner status. Atomically queue
  affected receipt reconciliation with deletion; render using current D1 names and the durable source,
  then edit every affected Telegram message through the capability. Persist retry progress after
  failures; repeated actions and cron retries converge without restoring a name. Guard tenant access
  and concurrent withdrawals so an older render cannot leave a withdrawn name visible. Expose missing
  legacy receipts/edit failures to the author without claiming that public removal succeeded.
  Provide an injectable site rebuild hook; verify the current site integration before deciding whether
  the original T39 no-op assumption is still valid. No new workflow or live dispatch in this PR.
- Acceptance: withdrawal removes the name in D1 immediately; successful reconciliation replaces it
  with the existing localized anonymous work label in every affected caption/text, including after
  draft cleanup. Winner names can also be withdrawn. Failures remain recoverable and visible.
- Tests: allow-list, forged/cross-tenant actions, repeated/concurrent withdrawal, multi-language and
  multi-post edits, retry after partial failure, absent receipts and rebuild-hook failure isolation.
  Run affected bot D1 files with `--maxWorkers=2` under a memory/CPU cap, plus workspace checks.
- Review notes from PR #121 (non-blocking): (1) bound the whole serialized receipt in
  `anonymousEditReceiptSchema` so it can never exceed the D1 `CHECK` (70000), with a test;
  (2) `poll_results.published_at` is set only from channels carrying `editReceipt` (Telegram):
  record the first `done` channel or document it as a T32d prerequisite; (3) test that
  `resolveEditPlan` and `resolvePostEntryNames` pick the same poll language for multi-language
  polls; (4) Telegram cannot edit sent polls: guarantee polls never carry names or report those
  operations as non-reconcilable instead of claiming removal.

##### T32c split — approved by Volodymyr (2026-11-12)

Keep the parent acceptance criteria above; complete these sequentially in separate sessions/PRs,
targeting at most ~400 changed non-test lines each. T32c1 is merged and deployed; T32c2 is merged (PR #123, migration 0020 applied); T32c3 is implemented and awaiting independent review.

- **T32c1 — Receipt safety and atomic withdrawal queue**
  - Owner: codex · Reviewer: claude-code · Depends on: T32b
  - Address all four PR #121 notes above. Add tenant-scoped durable reconciliation jobs and
    a migration, applied locally only. Clear only `display_name` and queue affected receipts in
    one transaction; preserve work, consent, numbering and winner state. Record absent legacy
    receipts explicitly. Expose an internal withdrawal boundary; no author command yet.
  - Tests: real D1 atomicity, tenant isolation, repeated/competing withdrawals, missing receipts,
    receipt size boundary, publication timestamp, language parity and non-editable poll safety.
- **T32c2 — Recoverable message reconciliation** (done, PR #123)
  - Owner: codex · Reviewer: claude-code · Depends on: T32c1
  - Render durable anonymous plans with current D1 names, edit every supported Telegram operation,
    and persist progress/errors for cron retries independently of the creation flag. Serialize edits
    per affected publication and fence stale workers so concurrent withdrawals converge without an
    older render restoring a name. Unknown remote outcomes require reconciliation before completion.
    Provide an injectable rebuild hook with failure isolation; no workflow or live dispatch.
  - Tests: real D1 multi-language/multi-message progress, partial failure/retry, draft cleanup,
    concurrent withdrawals and stale workers, unsupported operations and rebuild-hook failures.
T32c2 recovery contract: see `docs/name-reconciliation.md`. Migration 0020 adds a durable
non-expiring owner token; ambiguous remote outcomes retain that token until operator-confirmed
quiescence and a full reconciliation. No timed takeover can safely fence Telegram requests.
Creation flags never gate recovery; `PUBLISH_LIVE` still gates public edits. The site hook
defaults to a no-op after verifying blog, portfolio and show paths.

- **T32c3 — Author entries and withdrawal actions** (done, PR #124)
  - Owner: codex · Reviewer: claude-code · Depends on: T32c2
  - Add allow-listed `/entries` with bounded recent entries and tenant-bound withdrawal actions.
    Report immediate private deletion separately from pending/failed/complete public edits;
    expose missing legacy receipts. Wire the internal boundary without changing authored content.
  - Rollout: apply migration `0021_name_reconciliation_attempts.sql` before bot deploy; production
    migration/deploy require Volodymyr approval. Recovery runbook: `docs/name-reconciliation.md`.
  - Tests: allow-list, forged/cross-tenant and repeated callbacks, bounded listing, winner withdrawal,
    localized status and end-to-end recovery after draft cleanup. Recheck all parent acceptance criteria.
  - Review notes from PR #124 addressed: identifiable private photo/name rows with poll number
    when available; confirm/cancel before withdrawal; unpublished versus missing legacy receipts;
    re-queued attempt counts documented. Awaiting independent re-review.
  - Review notes from PR #123: (1) permanent 4xx edit rejections (deleted message, lost chat
    permission) stay `failed` forever and `tick()` orders `tenant_id, post_id LIMIT 10`, so ≥10 such
    jobs starve later publications; use fair ordering (least-recently-attempted/attempt counter) and
    surface persistently rejected jobs as a distinct author-visible state. (2) Reconciliation runs
    inline before announcement/closing crons and 429 sleeps (≤300 s each) can delay them or exceed
    wall time leaving `running / remote_inflight`; bound total retry time per tick or run it after
    the other crons. (3) Add an operator runbook (exact `wrangler d1 execute` steps or internal
    script) for `recoverQuiescent` to docs/name-reconciliation.md.

For each subtask run affected bot D1 files with `--maxWorkers=2` under a memory/CPU cap and
workspace checks. T32d depends on completion of all three. Site inspection: the current
`apps/site/src/lib/site-data.ts` includes only `free` posts and has no D1 entry-name resolver;
`.github/workflows/site.yml` already supports manual rebuild. Verify portfolio/show paths in T32c2
before choosing the default hook; do not dispatch a production rebuild in these PRs.

T32c1 retention prerequisite (PR #121 note 2): callbacks currently establish
`poll_results.published_at` only from channels with edit receipts. Before implementing T32d,
add a compatible per-channel completion timestamp to the callback and publisher for every
successful channel, preserving the first successful result time. Legacy callbacks without that
proof must leave retention blocked; neither callback arrival nor draft creation is a substitute.
T32c1 does not introduce that callback rollout change.

T32c1 implementation contract: migration 0019 must be applied before deploying the updated
callback receiver (Volodymyr approval required). Withdrawal markers contain IDs/timestamps only;
queue generations count distinct withdrawn entry refs. Callbacks enqueue late receipts in the same
transaction as receipt insertion. Repeated requests preserve progress. Status reports missing known
legacy receipts and name-bearing poll operations as incomplete; it cannot prove coverage for a
legacy publication missing both its receipt and independent result/closing index. No command,
cron edits or rebuild dispatch is introduced until T32c2/T32c3. New plans freeze `pollLanguage`;
legacy plans retain their old fallback. Telegram polls with name placeholders are non-editable
and must remain visible as unresolved even after supported caption/message edits succeed.

#### T32d — Daily non-winner name retention (`bot`, docs)
- Implementation: done (PR #125, merged 2026-11-12). Recovery and rollout:
  `docs/name-reconciliation.md`. No new migration required.
- Owner: codex · Reviewer: claude-code · Depends on: T32c
- Change: daily cleanup clears non-winner names 90 days after the week's successful result publication,
  atomically queuing the same reconciliation as manual withdrawal. Keep winner names until explicit
  withdrawal; do not expire names for unpublished results. Resume pending edits independently of the
  feature flag, so disabling contest creation cannot interrupt an erasure already requested.
  Document legacy receipt recovery, failed-edit operations and rollout prerequisites.
- Review notes from PR #124: in `/entries` (`apps/bot/src/author-entries.ts`) one failing
  `replyWithPhoto` (e.g. an unusable `file_id`) aborts the loop and the remaining rows are never
  sent; isolate per-row failures (fallback text row) and test it.
- Acceptance: exact 90-day cutoff, winner exemption, anonymous records retained, no premature deletion
  from draft/selection dates. Failed edits retry without restoring names or blocking other cleanup.
- Tests: before/at/after cutoff, UTC/DST boundaries, unpublished results, winner exemption, withdrawn
  winner, multiple tenants, repeated/concurrent cleanup and partial edit failure. Run affected bot
  suites and workspace checks. Reviewer handles deploy/migration approval under AGENTS.md.

### T33 — Usage metrics (`bot`)
- Owner: codex · Reviewer: claude-code · Depends on: T25
- Change: per draft store `first_ready_at`, edit count (UA, DE, regenerate) and the final delivery
  status from the callback. Operator command `/stats`: last 4 weeks, posts published, median time from
  draft to publish, edits per post, delivery success rate. No personal data. Volodymyr uses these
  numbers to decide when phases 2b-4 start (expert review 2026-10-28); they also go into the README.
- Acceptance: `/stats` answers only the operator; numbers match a fixture.
- Tests: aggregation, allow-list.
- Review notes from PR #125 (non-blocking): `expireNonWinnerNames`
  (`apps/bot/src/name-retention.ts`) swallows every tenant error, so a full D1 outage still
  reports a successful cron; keep per-tenant isolation but rethrow/report after the loop, with a test.
- Review notes from PR #127 (non-blocking): `appendAuthenticity`
  (`packages/channels/src/authenticity.ts`) throws a plain `Error` for a tenant language outside
  de/uk/en, so the bot preview crashes instead of showing a blocked state; use a render error or skip
  the label, with a test. When a caption ends with hashtags the label lands after them; consider
  inserting it before a trailing hashtag block. Site `authenticityLabel` duplicates `linkedWork`.

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
- Done 2026-11-05: PR #89 merged (`6a33893`); bot deploy pending (Volodymyr runs it by hand).
  Includes the PR #81 and PR #88 review notes.
- Owner: kimi-code · Reviewer: claude-code · Depends on: T39
- Change: `canonicalUrl(post)` from the post id and tenant site base URL; the renderers append "Mehr
  auf der Website: <url>" (UA/DE per language) to Telegram posts; Instagram captions get the text
  without a clickable link (bio link instead). Flag `featureFlags.canonicalLinks` so posts made before
  the site is live stay unchanged.
- Acceptance: a published post links to a page that exists after the rebuild; flag off → unchanged ops.
- Review notes from PR #81: README line that a draft first published to the test channel stays
  `siteExcluded` on a later live re-dispatch with the same draft id; raise the timeout of the flaky
  `apps/bot/test/show-transport.test.ts` grants test (timed out at 5 s on main CI run 41845320494).
- Review notes from PR #88 (T47f): the git-backed `apps/publisher/test/publish-callback.test.ts`
  cases hit the 5 s default timeout in a concurrent local run; if CI flakes there, give the suite an
  explicit timeout with a reason, as done for show-transport.
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
(contest on all networks) → T33, T34. Owner kimi-code (codex stood in until 2026-11-05),
reviewer claude-code unless stated; each PR under
~400 changed non-test lines (ADR 009). Fixes found by T47 are inserted right after it.

T47a-T47f added 2026-11-04 from the T47 check (docs/e2e-v7.md, defects D1-D8); they run after T47,
before T40.

T47g added 2026-11-05 by Volodymyr as a priority: it runs first, before T47a.

T41 changes in v5: depends on H11 and H14 only (not on T40); scope as below.

T41b added 2026-11-04 after the T41 merge (PR #80); it runs before T47.

T26d added 2026-11-10 by Volodymyr (Threads token refresh); it runs right after T26c, before T48.

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
- Done 2026-11-05: PR #88 merged (`8658ac6`), bot deployed (Worker version
  `1e9a25aa-3098-451e-8964-6c2c4f633763`). Includes both PR #87 review notes.
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
- Owner: kimi-code · Reviewer: claude-code · Depends on: T25, T40, H8 · Sensitive: new secrets
- Change: T26 as written above, plus the v7 caption rules from F33: the first ~125 characters carry
  the message (the bot preview shows that window), at most 5 hashtags (hard limit), carousels in 4:5
  (1080x1350, crop or pad without cutting the work), shows as a carousel of their images plus the AI
  label in the caption. A shared Meta token/refresh helper in `channels` is reused by T26b-T26c.
  Rules ported from instagram-agent-skill (MIT) keep its license notice in the ported file.
- Acceptance and tests: as T26, plus caption window, hashtag limit and 4:5 framing tests.
- Split 2026-11-08 into T26a1-T26a3 (one PR each, ADR 009); the acceptance below is complete with
  T26a3. The caption rules are ported from instagram-agent-skill
  (github.com/Jakeschincariol/instagram-agent-skill, MIT); the license notice is kept in the ported
  file. Review of PR #93 (blocking, fixed in the PR): the preview applies Instagram rules only to
  items that actually copy to Instagram (works: `config.channels` includes `instagram`; a test
  publish is projected site-excluded via the bot PUBLISH_LIVE flag — no Instagram copy, no
  canonical footer); work drafts show the exact failing rule (only broken work setup hides behind
  the generic text); a missing caption language skips the section quietly (the "DE missing" state
  stays).

#### T26a1 — Instagram caption rules and author preview (`channels`, `bot`)
- Owner: kimi-code · Reviewer: claude-code · Depends on: T25, T40; first PR.
- Change: `renderInstagram` + `renderInstagramShow` + `instagramCapabilities` in
  `packages/channels/src/instagram/render.ts` (settings `{language, canonical?}`; 10 photos, 2200
  caption, no polls). v7 rules: first ~125 chars carry the message (`instagramCaptionWindow`), ≤5
  hashtags (hard limit), only site-worthy `free` posts are rendered (announcements/reminders and
  text-only posts are skipped — `[]` ops, the preview says why), shows = one image-carousel op with
  the AI label and the canonical show URL in the caption. `instagramCarouselFrame` (1080x1350) is
  exported for the publisher's framing. Bot preview: when the tenant enables Instagram, show the
  caption window, the caption length vs 2200 and the skip reason; a caption breaking an Instagram
  limit blocks publishing exactly like a Telegram limit error.
- Tests: render (single vs carousel, skip reasons, limits, hashtags, window, show caption), preview
  lines with and without Instagram.

#### T26a2 — Instagram delivery and Meta token helper (`channels`, `core`) · Sensitive: new secrets
- Owner: kimi-code · Reviewer: claude-code · Depends on: T26a1; second PR.
- Change: `InstagramAdapter` (Graph API content publishing: media container → status polling →
  publish; carousel children for 2-10 photos, single image container for 1; only `mediaGroup` ops —
  video/Reels stays a later task). `DeliverContext` gains optional `photoUrls` (public https URLs
  aligned with `photoIndexes`; core stays network-agnostic, the publisher fills it). Secrets via the
  resolver by fixed name: `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN`; `META_APP_ID`/
  `META_APP_SECRET` feed the shared `channels/src/meta/token.ts` `exchangeLongLivedToken`
  (`fb_exchange_token`), used at most once per deliver to retry an expired-token error. 429 retried
  like Telegram; tokens never logged.
- Review notes from PR #93: (1) `countHashtags` counts only ASCII tags — switch to
  `\p{L}\p{N}_` with the `u` flag (our captions are DE/UK; 6 Cyrillic tags currently pass the
  5-tag cap); (2) make `showDisclosures` explicitly read-only (`as const`), it is shared by two
  renderers (and drop the pointless alias in `renderTelegramShow`).

- Done 2026-11-08: PR #94. `InstagramAdapter` (container → status polling → `media_publish`,
  carousel children for 2-10 photos, single container for 1, `mediaGroup` only; ledger resume
  is the idempotency mechanism). `DeliverContext` gained optional `photoUrls` (public https,
  aligned with `photoIndexes`). Secrets by fixed name (`INSTAGRAM_USER_ID`,
  `INSTAGRAM_ACCESS_TOKEN`); expired-token 190 exchanges via shared
  `channels/src/meta/token.ts` `exchangeLongLivedToken` (`META_APP_ID`/`META_APP_SECRET`) at
  most once per deliver; 429 retried per op; tokens never logged. Note: PR #93 note (2) was
  already fixed in the merged #93 (`as const`, no alias) — verified, only the Unicode
  `countHashtags` fix landed here. Tests: mocked Graph API (26 new), no live calls, no
  secrets, no deploy.

#### T26a3 — Instagram publishing wiring (`publisher`, `stores`, workflow, tenant) · Sensitive: publish.yml
- Owner: kimi-code · Reviewer: claude-code · Depends on: T26a2, H8; third PR. Closes T26a acceptance.
- Change: register the adapter for the `instagram` channel key; build public raw-GitHub photo URLs
  (`https://raw.githubusercontent.com/$GITHUB_REPOSITORY/$GITHUB_REF_NAME/...`, local override
  `CONTENT_RAW_BASE_URL`) for posts, works and show copies; the publisher pushes the content commit
  before delivery when the workflow opts in (GitCommitter `push` with the same pull-rebase retry
  loop) so Meta can fetch fresh photo URLs; when Instagram receives a carousel the publisher frames
  4:5 copies (1080x1350 pad, no cutting, sharp) committed beside the item; `publish.yml` passes the
  Meta secrets to the publish and copy-show jobs; the tenant yaml enables `instagram: {language: de}`
  after `telegram` (telegram stays first, so an Instagram failure never blocks Telegram).
- Review notes from PR #94 (T26a2), fixed here: (1) Meta's `fb_exchange_token` does not accept an
  already-expired token, so the reactive 190 retry rarely helps; document the real rotation path
  (refresh the stored `INSTAGRAM_ACCESS_TOKEN` before its ~60-day expiry: operator runbook or a
  scheduled job); (2) a 429/190 at any step restarts the whole op and recreates every carousel
  child container; retry at the call level instead; (3) `children` is sent as a JSON array, Meta
  documents a comma-separated string; verify on the first live carousel and switch to
  `children.join(',')` if rejected; (4) `deliver` validates each op and builds its URLs twice;
  reuse the pre-check result.
- Acceptance: a live post appears on Instagram once; a re-run skips it via the ledger; a failed
  Instagram delivery does not block Telegram and alerts the operator.
- Review notes from PR #89 (T40), fixed here: (1) send `link_preview_options` on Telegram text
  messages (no site-page card instead of the join link); (2) the bot preview must not show the
  canonical footer while publishes still go to the test channel (bot `PUBLISH_LIVE` var);
  (3) `renderTelegramShow` must not append the show link for a `siteExcluded` show copy.
  Note: (2) is already resolved in T26a1 (the preview projects site-excluded publishes via
  `publishesLive`).
- Review notes from PR #93: (1) the Instagram caption window (`slice(0, 125)`) and `.length` work
  in UTF-16 code units — an emoji at position 124–125 splits into a lone surrogate; slice by code
  points (`Array.from` / `Intl.Segmenter`) when touching the preview again; (2) the MIT warranty
  disclaimer paragraph was added to the notice in T26a1.
- Tests: mocked registry/adapter delivery through runPublish and copy-show, URL builder, framed
  copies with real sharp, push gating and failure.
- Review notes from PR #89 (T40): (1) no `link_preview_options` is sent, so Telegram text messages
  now preview the site page instead of the `t.me` join link; check the first live post and set the
  options explicitly if the card is unwanted. (2) The bot preview shows the canonical footer for a
  draft later published to the test channel, where the post has none. (3) `renderTelegramShow`
  appends the show link even for a `siteExcluded` show copy, whose page is never built.
- Done 2026-11-08: PR #95. `InstagramAdapter` registered for the `instagram` key; public raw-GitHub
  photo URLs for posts, works and show copies (`CONTENT_RAW_BASE_URL` local override);
  `GitCommitter.push` (pull-rebase retry) fires before delivery with the workflow opt-in
  (`CONTENT_PUSH_BEFORE_DELIVERY` in the publish and copy-show jobs) so Meta can fetch fresh URLs;
  every photo (single and carousel — Instagram rejects feed aspects outside 4:5..1.91:1) framed
  4:5 (sharp, 1080x1350 white pad) with `*.ig.jpg` copies committed beside the item; `publish.yml`
  passes INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN / META_APP_ID /
  META_APP_SECRET; the tenant yaml enables `instagram: {language: de}` after telegram.
  PR #94 review notes: (1) docs/instagram-runbook.md documents the real rotation path (exchange the
  still-valid token before ~60-day expiry; fb_exchange_token refuses expired tokens); (2) 429/190
  retries happen at the call level — a late carousel failure no longer recreates earlier child
  containers; (3) `children` stays a JSON array with a live-check note to switch to
  `children.join(',')` on Meta rejection; (4) `deliver` reuses the pre-check op/URL pairs.
  PR #89 review notes: (1) Telegram text messages send `link_preview_options {is_disabled: true}`;
  (2) was already resolved in T26a1; (3) `renderTelegramShow` omits the show link for a
  site-excluded copy. PR #93 review note: the bot preview slices the Instagram caption window by
  code points. Tests: channels 136/136, publisher 213/213, core 232/232, bot 553/553, site 50/50,
  ai 121/121; workspace typecheck/build, lint, actionlint, prettier, staged gitleaks. Mocked Graph
  API only — no live Meta calls, no deploy, no secret changes. Sensitive (publish.yml + tenant
  enables Instagram): Volodymyr's OK wanted before merge.

### T26b — Facebook Page adapter (F33, `channels`) · Sensitive: new secrets
- Owner: kimi-code · Reviewer: claude-code · Depends on: T26a
- Change: `FacebookPageChannel` via the Pages API: photo or multi-photo post with the German caption
  and the canonical link (clickable on Facebook); registered and enabled by tenant config.
- Acceptance: one live post appears once; a re-run skips it via the ledger; a failure does not block
  other channels and alerts the operator.
- Tests: mocked Graph API, single vs multi photo, errors.
- Done 2026-11-09: PR #96. `FacebookAdapter` + `renderFacebook`/`renderFacebookShow`: 1 photo →
  `POST /{page}/photos` (published); 2-10 photos → unpublished uploads + one `/{page}/feed` post
  via `attached_media`; German caption with the clickable canonical link (F33 "where the network
  allows it"); same site-worthy skips as Instagram. Shared `MetaGraphClient` (meta/graph.ts):
  query-token auth, per-call 429 retry, once-per-deliver 190 refresh, never-log-tokens mapping,
  `metaPhotoUrls` pre-check; the Instagram adapter refactored onto it with unchanged messages and
  behaviour. Publisher `prepareFacebookDelivery`: plain raw-GitHub URLs (no 4:5 framing — Facebook
  accepts original aspects), opted-in pre-delivery push, wired into runPublish/runCopyShow and the
  default registry. Tenant yaml enables `facebook: {language: de}` after telegram/instagram;
  publish.yml passes FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN in the publish and copy-show
  jobs. core `channelsSchema` gains the `facebook` key + language-in-tenant-languages guard.
  Operator doc: docs/facebook-runbook.md (non-expiring System User Page token, rotation, first
  live checks). Tests: channels 181/181, publisher 220/220, core 233/233, bot 553/553, site 50/50,
  ai 121/121, stores 46/46; workspace typecheck/build, eslint, changed-file prettier, staged
  gitleaks pass. Mocked Graph API only — no live Meta calls, no deploy, no secret changes.
  Sensitive (publish.yml + tenant enables Facebook): Volodymyr's OK wanted before merge; GitHub
  Secrets FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN must exist for live deliveries.
  Review note candidates: (1) the bot author preview has no Facebook block (T26b scope is the
  adapter + wiring) — a preview line can follow as a small task; (2) under
  CONTENT_PUSH_BEFORE_DELIVERY=true both Meta preparations push (the second is a no-op) — dedupe
  later if it ever matters; (3) facebookMaxPhotos=10 mirrors the other channels — verify against a
  real 10-photo post on the first live carousel.

### T26c — Threads adapter (F33, `channels`) · Sensitive: new secrets
- Unblocked 2026-11-09: Threads publishing secrets exist in GitHub Secrets.
- Owner: codex · Reviewer: claude-code · Depends on: T26a
- Review notes from PR #102 (`apps/bot`): (1) drop the hard-coded `countUncertain().notifications`
  field from the type and query; (2) in `collectTenant`, catch a failed author warning after
  `reclaimSending` (log a count only) so that tenant's collect still runs; (3) an edited reply
  longer than the 4096-char card is cut in the card but sent in full — reject or cap edits that
  do not fit (Instagram's comment limit is lower).
- Change: `ThreadsChannel` via the Threads API: text plus image or carousel, 500-character limit shown
  in the preview, canonical link in the text.
- Acceptance and tests: as T26b.
- ✅ Merged 2026-11-10 as PR #103: text/image/carousel + shows, canonical
  links, conservative 500-byte preview gate, shared Meta transport and original-photo URL wiring.
  PR #102 notes resolved (count removal, isolated warning failures, fully visible capped edits).
  Operator steps and live-check caveats: docs/threads-runbook.md. No live publishing or deploy.

### T48 — Email sign-up and lead magnet (F27, `site`, ADR 013) · Sensitive: personal data ✅ done 2026-11-11
- Merged 2026-11-11 as PR #107 (`0c1f942`) with Volodymyr's sensitive-merge OK. Volodymyr decided: one
  German DOI mail for both UI languages; Datenschutz section and Brevo entity/address checked against
  the account DPA; live operator test declined, so non-JS success page, `locale=uk`, DOI mail,
  redirect and unsubscribe are unverified in production.
  Provider inspection: GET 200; empty URL-encoded non-JS POST 400 JSON with German EMAIL validation.
  No live subscriber created. PDF is public by explicit hosting decision, not access controlled.
  Validation: site 52/52, core 234/234, workspace typecheck/build and changed-file lint/format pass.
  Initial sandbox site run lost malformed-document child diagnostics; full unrestricted rerun passed.
- Owner: codex · Reviewer: claude-code · Depends on: T41, H15
- Reassigned 2026-11-11 by Volodymyr from kimi-code to codex. Ready from H15 (verified in public DNS
  2026-11-11): Brevo free plan, domain `fadenundstimmung.de` authenticated (brevo-code, DKIM
  `brevo1`/`brevo2._domainkey`, `_dmarc` p=none), sender `Faden und Stimmung <hallo@fadenundstimmung.de>`
  (Cloudflare Email Routing forwards replies), empty list `Newsletter` (id 3), approved pattern PDF
  kept locally. Not yet done (Volodymyr, in the Brevo UI): the double opt-in sign-up form, the
  post-confirmation PDF delivery and the confirmed Brevo privacy text.
- PDF hosting decided 2026-11-11 by Volodymyr: the lead-magnet PDF is served from the site (for example
  `/geschenk/rosenbluete.pdf`) and committed to the public repo (Brevo Media accepts images only). The
  Brevo confirmation flow redirects to the page that links it. Source file (author-approved, outside
  the repo): `~/handmake-inputs/rosenbluete.pdf`; copy it into the site so it is served at
  `/geschenk/rosenbluete.pdf`.
- Brevo form ready 2026-11-11 (public config, no secret): form `Newsletter DE`, list `Newsletter` (id 3),
  double opt-in with template #1 `Default Template Double opt-in confirmation` (German text, sender
  `Faden und Stimmung <hallo@fadenundstimmung.de>`, subject `Bitte bestätige deine Anmeldung`, no Google
  Fonts), redirect after the confirmation click to `https://fadenundstimmung.de/geschenk/` (T48 builds
  that page with the download of `/geschenk/rosenbluete.pdf`); no final confirmation email; German
  success/error messages. Simple-HTML form: `method="POST"` `action="https://d2c04417.sibforms.com/serve/MUIFANZ2KTD7DrH6FXtIYdhL5lv5Olz9vYwkGcbbejUlT3kvUGgNAa1blz-Ef3XyHWmKhmMuREDoIiIxKbgOTvs-gUrwVf4OBvzgEqt-xkWV9qe7STw7XoOD6a1U35HlsyDKyfJtw42ynwHCwVgJZ-06SGnjWR8KPPuufg3f7xh8hHSFOUXChnorbAdKAWgqFsU3NtEuLHAubfFHew=="`;
  fields `EMAIL` (required), honeypot `email_address_check` (hidden, must stay empty), hidden
  `locale` (Brevo gave `en`; send `de`/`uk` per page), hidden `html_type=simple`. No reCAPTCHA, no Brevo
  JS. Do NOT load Brevo's `sib-styles.css` or `assets.brevo.com` fonts; only the form POST leaves the site.
  Check what Brevo returns to a plain (non-JS) POST and record it in the PR. Ukrainian sign-up: either
  this form (German DOI mail) or a second Brevo form for a Ukrainian mail; decide in the PR, ask Volodymyr.
- Datenschutz input ready 2026-11-11: `docs/legal/newsletter.de.html` holds the generator's newsletter
  section (verbatim) plus the Rechtsgrundlagen and overview additions; see its header comment for the
  merge steps and the Brevo bullet T48 still drafts for Volodymyr's review.
- Change: ADR 013 email part accepted with the chosen provider (EU hosting, DPA). Sign-up form on the
  site (German and Ukrainian) posting to the provider's double opt-in form; the provider sends the
  pattern PDF after confirmation. No addresses touch our storage or logs. Datenschutzerklärung gets
  the provider section (texts from the H11 generator, confirmed by Volodymyr). One call to action on
  show and work pages.
- Acceptance: a test address receives the confirmation mail, and the PDF only after confirming; the
  third-party check from T41 allows only the provider's form endpoint.
- Tests: form rendering, build check; the live opt-in is checked manually and recorded in the PR.

### T26d — Automatic Threads token refresh (`workflows`, `publisher`) · Sensitive: workflows, secrets
- Implementation complete 2026-11-10, PR #104 (`feat/t26d-threads-token`); independent review,
  sensitive merge approval and post-merge live acceptance pending. Includes all three PR #103 review notes.
- Added 2026-11-10 by Volodymyr: the Threads long-lived token expires 60 days after issue or last
  refresh (the one from 2026-11-09 around 2027-01-08). Must be merged and run once before mid-December 2026.
- Owner: codex · Reviewer: claude-code · Depends on: T26c, H17
- Review notes from PR #103 (`apps/bot`, `apps/publisher`): (1) the Threads preview label
  "N/500 байт UTF-8" means nothing to the author; keep the byte budget but say it plainly (umlauts
  and emoji count double); (2) drop the unused `prepareFacebookDelivery` alias and rename
  `PrepareFacebookDeliveryDeps`/`PreparedFacebookDelivery` to Meta names; (3) container polling
  (6 × 60 s, carousel children one by one) can hold a 10-photo carousel ~55 min; shorten the interval
  or poll children in parallel.
- Change: scheduled workflow `threads-token.yml` (weekly cron plus `workflow_dispatch`) calls
  `GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token` with the current
  `THREADS_ACCESS_TOKEN` (the token must be at least 24 hours old and unexpired). On success it masks
  the new token with `::add-mask::` before any other step, checks `expires_in` is at least 50 days,
  and writes it back with `gh secret set THREADS_ACCESS_TOKEN` (value via stdin, never as an argument)
  using `SECRETS_WRITE_TOKEN`. The job has `permissions: {}` apart from what it needs and
  `concurrency` against itself. Any failure (HTTP error, missing field, short expiry) fails the job
  without printing the response body, so GitHub mails Volodymyr; weekly runs leave about eight
  retries before expiry. Update docs/threads-runbook.md (rotation is now automatic; manual reauth only
  after expiry; `SECRETS_WRITE_TOKEN` has no expiry, revoke and replace it if it leaks) and `.env.example`.
  When T49d puts the Threads token into the Worker, the same job also updates that Worker secret.
- Acceptance: a manual `workflow_dispatch` run on `main` refreshes the secret and the next publish
  run delivers to Threads with it; the run log shows no token or response body.
- Tests: actionlint; a small script or unit test for the response check (valid, missing token,
  short `expires_in`, error JSON) if the logic lives outside the YAML; manual run recorded in the PR.

### T49 — Comment inbox with author-approved replies (F34, `bot`, `channels`, `ai`) · Sensitive: reader data
- Owner: kimi-code · Reviewer: claude-code · Depends on: T26a-T26b (Threads comments join when T26c
  is done)
- Change: `comments` capability on the Meta adapters (list new comments on our posts, reply). A cron
  collects new comments into D1 (tenant, network, comment id, handle, text, status), sends each to
  the author with a Ukrainian translation and a German draft reply (prompt with rules ported from
  `/ig-reply`, MIT notice kept); buttons Send / Edit / Skip. Handled comments are deleted after 30
  days; nothing reaches Git or logs. Costs are booked via `recordCost`.
- Acceptance: a comment is answered at most once; skipped and sent comments disappear after 30 days;
  only allow-listed users see the inbox.
- Tests: mocked APIs, idempotent collect and reply, retention, cost booking.
- Review notes from PR #96: (1) `renderFacebookShow` must reject 0 or more than
  `facebookMaxPhotos` show images at render time, like `renderFacebook`; (2) docs/facebook-runbook.md
  should say plainly that a 190 on the non-expiring System User token means re-issuing the token
  (the `fb_exchange_token` refresh cannot help there); (3) add a Facebook block to the bot author
  preview; (4) optional: push once before the Meta channels instead of once per preparation.
- Split 2026-11-09 into T49a-T49c (one PR each, ADR 009); Threads comments join as T49d after T26c.
  Go-live gates before the first live collect (Volodymyr): the Instagram System User token must
  carry `instagram_manage_comments` (Facebook already has `pages_read_engagement` /
  `pages_manage_engagement`, docs/facebook-runbook.md) and the F34 reader-data paragraph must be in
  the Datenschutzerklärung (draft in T49c, marked for review).

#### T49a — PR #96 review notes (`channels`, `publisher`, `bot`, docs) · first PR
- Owner: kimi-code · Reviewer: claude-code · Depends on: T26b.
- Change: (1) `renderFacebookShow` rejects a show with 0 or more than `facebookMaxPhotos` images at
  render time, like `renderFacebook`; (2) `docs/facebook-runbook.md` states plainly that a 190 on
  the non-expiring System User token means re-issuing the token (`fb_exchange_token` cannot help
  there); (3) the bot author preview shows a Facebook block — the caption with the canonical link
  line or the skip reason — mirroring the Instagram block; (4) the publisher pushes once before the
  Meta deliveries when both Meta channels run (the second preparation's push is skipped) instead of
  once per preparation.
- Acceptance: a bad show fails in preview and render before any network write; the runbook wording
  is unambiguous; the preview Facebook block matches what `renderFacebook` produces; a
  two-Meta-channel publish pushes exactly once.
- Tests: facebook-render image-count cases; preview Facebook block (caption, skip reason, canonical
  link); publisher push-count assertions in the publish and copy-show paths.
- Done 2026-11-09: PR #97 merged (`43f740d`), no review findings.

#### T49b — Meta comment reader/reply capability (`channels`) · second PR
- Done 2026-11-09: PR #98 merged (`75ec2d7`); bot deployed by Volodymyr (Worker `c382a608`).
- Owner: kimi-code · Reviewer: claude-code · Depends on: T49a.
- Change: an optional `comments` capability on the Meta adapters: list our recent posts (bounded),
  list new comments on one post since a watermark, and reply to one comment — Instagram
  (`/{ig-user}/media`, `/{media}/comments`, `/{comment}/replies`) and Facebook (`/{page}/feed`,
  `/{post}/comments`, `/{comment}/comments`) over the shared `MetaGraphClient` (per-call 429 retry,
  the once-per-run 190 refresh, never-log-tokens). The capability is stateless: watermarks and
  dedupe live in the caller (T49c). Comment text/handles never appear in errors or logs.
- Acceptance: the three operations work per network against the mocked Graph API; paging is
  bounded; a 429/190 behaves exactly like the publishing path.
- Tests: mocked Graph API only — list posts, list comments with a watermark, reply, malformed
  results, rate-limit and token-error mapping.

#### T49c — Bot comment inbox (`bot`, `ai`) · third PR, split again before coding if it exceeds the budget
- Split 2026-11-09 into T49c1-T49c3 (one PR each, ADR 009): the full inbox is
  ~800 non-test lines (store + collect cron + reply handling + drafter + legal).
- Owner: kimi-code · Reviewer: claude-code · Depends on: T49b. Sensitive: reader data.
- Change: D1 `comments` table + store (tenant, network, comment id, post id, handle, text, status,
  Ukrainian translation, German draft, timestamps; every query keyed by tenant_id). The existing
  15-minute tick collects new comments through the T49b capability (INSERT OR IGNORE; a per
  tenant+network watermark bounds Meta API calls), then one AI call per new comment drafts the
  Ukrainian translation and the German reply — prompt in `packages/ai`, reply rules ported from
  `/ig-reply`, MIT notice kept — with the cost booked through `recordCost` (ref `comment:<id>`). The
  author gets one message per comment with the translation, the draft and Send / Edit / Skip
  buttons. Send claims the row atomically and replies through the capability (a comment is answered
  at most once; a failed send re-opens the row); Edit waits for her text and then Send; Skip closes
  the row. The daily cleanup cron deletes comment rows older than 30 days. Nothing reaches Git or
  logs; only allow-listed users see the inbox (the existing gate).
- Acceptance: a comment is answered at most once; skipped and sent comments disappear after 30 days;
  only allow-listed users see the inbox; a draft Datenschutzerklärung paragraph for reader comments
  is added, marked for Volodymyr's and the author's review.
- Tests: mocked Meta APIs + Miniflare D1 — idempotent collect, reply at most once, retention, cost
  booking, button races, edited drafts.
- Review notes from PR #98: port doc on `listComments` must say `since` is inclusive (dedupe by id);
  `facebookComment` keeps comments without `from` (empty handle), skipping only `from.id === pageId`;
  also filter Instagram comments by `createdAt` client-side (the edge may ignore `since`); switch the
  Facebook posts edge from `/{page}/feed` to `/{page}/posts`.

#### T49c1 — Channels review notes + comment drafter (`channels`, `ai`, `core`) · first PR of the split
- Done 2026-11-09: PR #99 merged (`715dd4e`); bot deployed by Volodymyr (Worker `3a5db8aa`).
- Owner: kimi-code · Reviewer: claude-code · Depends on: T49b.
- Change: PR #98 review notes 4-6 — the shared capability applies the `since`
  watermark client-side by `createdAt` (entries without a parseable timestamp
  pass through; the caller still dedupes by id), `facebookComment` keeps
  from-less comments with an empty handle (skips only `from.id === pageId`),
  the Facebook posts edge moves from `/{page}/feed` to `/{page}/posts` (the
  `from` filter goes away). Plus the AI drafter: a `CommentDrafter` port in
  core and `ClaudeCommentDrafter` in `packages/ai` — one call producing the
  Ukrainian translation, the German reply draft and a Ukrainian note, reply
  rules ported from instagram-agent-skill `ig-reply` (MIT notice kept), strict
  JSON input/output, paid usage reported through `onUsage`.
- Acceptance: notes 4-6 hold per network against the mocked Graph API; the
  drafter returns both drafts per one call and books usage exactly once.
- Tests: updated channels comments tests (posts edge, from-less comments,
  client-side since filter) and ai drafter tests with a fake client (usage
  booking, malformed output, refusal, injection-safe input handling).

#### T49c2 — Comment collect pipeline (`bot`) · second PR of the split
- Subdivision (approved by Volodymyr 2026-11-09): WIP `624436d`
  already changes 742 non-test lines, exceeding ADR 009 before fixes. Preserve it
  as the recovery source; extract the following sequential PRs without rewriting
  the pushed branch's history. T49c2a done 2026-11-09: PR #100 merged (`533fff7`); no deploy needed (store not wired yet).
  - **T49c2a — Persistence + PR #99 fixes.** Owner: codex; Reviewer: claude-code;
    depends on T49c1. Migration 0009, comment store and D1 tests; inclusive
    watermark, generic malformed-JSON error, shared client type and typecheck fix.
    Acceptance: tenant isolation, insert dedupe, atomic drafting/notification
    claims, retryable pending work, monotonic watermark and 30-day deletion.
    Tests: real local D1 races/retention plus channels/AI regressions. Target:
    <=400 changed non-test lines. No cron wiring or remote migration.
  - **T49c2b — Collection + Worker wiring.** Done 2026-11-09: PR #101 merged (`3d33793`);
    not deployed until Volodymyr applies migration 0009 to remote D1. Owner: codex; Reviewer: claude-code;
    depends on merged T49c2a. Reuse the WIP collector, cost integration, optional
    secrets, cards and cleanup wiring. Acceptance: all original T49c2 criteria,
    including retry recovery without watermark loss, bounded pagination without
    skipped comments, atomic notification claims and no reader data in errors.
    Tests: fake capabilities/drafter and mocked Telegram for idempotency,
    watermark bounds, concurrent ticks, failed drafting/delivery, cost booking
    and network isolation; workspace checks and bot suite with --maxWorkers 1.
    Target: <=400 changed non-test lines; defer reply transitions to T49c3.
    Review notes from PR #100: (1) after the 30-day delete a comment the API still returns
    (at the inclusive watermark or with unparseable `createdAt`) comes back as `new` and gets a
    second paid draft and card — skip comments older than the retention cutoff; (2) stuck
    `drafting` rows and ambiguous notifications have no reconciliation path — reclaim stale
    `drafting` after a timeout or at least report a count without reader data; (3) use or drop
    the unused `latestHandledCreatedAt`; (4) `reopenNotification` should set `updated_at`.
  Both PRs remain sensitive: explicit Volodymyr approval before merge; no deploy
  or remote D1 migration during implementation. T49c3 depends on T49c2b.
- Owner: codex · Reviewer: claude-code · Depends on: T49c1. Sensitive: reader data.
- Change: D1 migration `comments` + `comment_watermarks` tables (every query
  keyed by tenant_id) and the store (INSERT OR IGNORE collect, atomic
  draft/send/skip claims, watermark get/set, 30-day `deleteOlderThan`). The
  15-minute tick collects new comments through the T49b capability per enabled
  Meta channel (bounded recent posts, per-network watermark, per-tenant
  isolation), then one drafter call per new comment books the cost (ref
  `comment:<id>`) and sends the author the card with Send / Edit / Skip
  buttons. The daily cleanup cron also deletes old comment rows. Worker
  secrets: the six Meta secret names become optional `Env` fields resolved by
  name (absence disables that network; added to the log-scrubbing list).
- Acceptance: idempotent collect; a comment is drafted and notified at most
  once; cost booked per drafted comment; one failing network never blocks the
  other; rows vanish after 30 days.
- Tests: Miniflare D1 store tests + collect tests with fake capability,
  fake drafter and mocked Telegram (idempotency, watermark bound, races, cost).
- Review notes from PR #99: `isNewerThanWatermark` in `meta/comments.ts` keeps entries with
  `createdAt == since` (drop only strictly older; the id dedupe covers repeats — Graph timestamps
  have second resolution) and the core port doc says so; `ClaudeCommentDrafter` wraps
  `JSON.parse` and throws a generic message (V8's SyntaxError quotes the model output, which
  carries the translated reader comment), with the no-echo test extended to malformed JSON;
  import `TextGenerationClient` from `claude-text-generator` instead of redeclaring it.

#### T49c3 — Author reply handling + legal draft (`bot`, docs/legal) · third PR of the split
- Done 2026-11-10: PR #102 merged (`1c25683`) with Volodymyr's OK; review notes moved out of the
  public Datenschutz text. Migration 0010 and bot deploy pending.
- Owner: codex · Reviewer: claude-code · Depends on: T49c2. Sensitive: reader data, legal text.
- Ownership transferred by Volodymyr on 2026-11-10. Ambiguous sends are quarantined
  as skipped after one hour, with an author warning; they are never resent automatically.
- Change: the Send / Edit / Skip buttons and the text interception (Edit arms
  one chat-scoped reply, the next author text replaces the German draft and
  re-renders the card; a 30-minute arm window; Send claims the row atomically
  and replies through the capability, a failed send re-opens the row; stale
  `sending` rows are reclaimed with an uncertainty note). Only allow-listed
  users reach the inbox through the existing gate. A draft Datenschutzerklärung
  paragraph for reader comments is added to `docs/legal/services.de.html`,
  marked for Volodymyr's and the author's review.
- Acceptance: a comment is answered at most once (button races); a failed send
  re-opens the row; skipped comments disappear at 30 days; the legal paragraph
  is present and marked as a draft.
- Tests: button races, failed send, edited drafts, skip, stale-send reclaim,
  allow-list gate; legal HTML change covered by the existing site build test.
- Review notes from PR #101: (1) `countUncertain().notifications` counts every delivered card
  older than 1 h still `drafted`, so `comment reconciliation required` fires every tick — count
  only truly ambiguous reservations (e.g. a delivery confirmation set after `sendMessage`
  resolves) or drop that count; (2) one post whose comments exceed the page bound makes
  `listComments` throw every tick, so that network's watermark never advances — log the
  post-level failure distinctly (no reader data) or advance per post; (3) guard `callback_data`
  (`comment:<network>:<id>:<action>`) against Telegram's 64-byte limit or use a short row key;
  (4) drop the redundant `!Number.isNaN(created)` after the `Number.isFinite` guard.

#### T49d — Threads comments in the inbox (`channels`, `bot`, `workflows`, docs/legal) · Sensitive: reader data, secrets, workflows, legal text
- Done 2026-11-10: PR #105 merged (`d0c930f`) with Volodymyr's OK; no blocking findings, review
  notes moved to T49e. Remote migration 0011, bot deploy and live acceptance are pending.
- Added 2026-11-10 by claude-code on Volodymyr's request. Owner: codex · Reviewer: claude-code ·
  Depends on: T49c3, T26d; H18 for go-live only (code and tests run against mocks).
- Change:
  1. `packages/channels`: a `comments` capability on `ThreadsAdapter` over the shared
     `createMetaComments`: posts `GET /{user}/threads?fields=id,timestamp,permalink`, comments
     `GET /{post}/replies?fields=id,text,username,timestamp` (no network `since`; the shared
     client-side watermark filter applies), own replies skipped. Replying is two calls
     (`POST /{user}/threads` with `media_type=TEXT`, `text`, `reply_to_id`, then
     `POST /{user}/threads_publish`), so extend `MetaCommentsConfig` with an optional `reply`
     function used instead of `replyPath`, keeping the at-most-once rule (an ambiguous publish is
     reported as such, never retried). A reply over the 500-byte Threads budget is rejected before
     any call with `CommentReplyRejectedError`. A 190 never refreshes inside the Worker: rotation
     belongs to `threads-token.yml`, so it fails with a token error naming only the secret.
  2. Review note from PR #104: container polling allows only ~25 s (6 × 5 s), below Meta's ~30 s
     average; raise `statusPollMaxAttempts` to about 12 or poll carousel children in parallel.
  3. `apps/bot`: `CommentNetwork` gains `threads`; a new D1 migration rebuilds `comments` and
     `comment_watermarks` with `threads` in the `network` CHECK (copy rows, keep indexes); `env.ts`
     and `composition.ts` enable Threads only when both `THREADS_USER_ID` and `THREADS_ACCESS_TOKEN`
     are set; the author card names Threads; `callback_data` stays within 64 bytes.
  4. `threads-token.yml`: after the GitHub Secret is written, the same job sets the Worker secret
     `THREADS_ACCESS_TOKEN` with `wrangler secret put` (value via stdin, output discarded) using
     `CLOUDFLARE_WORKERS_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, only in that step. If the Worker update
     fails after the GitHub write, the job fails with a line saying the two copies differ.
  5. Docs: `docs/legal/services.de.html` says "Instagram-, Facebook- und Threads-Beiträgen";
     docs/threads-runbook.md lists the four scopes, the Worker secrets and the H18 steps;
     `.env.example` gets `CLOUDFLARE_WORKERS_TOKEN`.
- Acceptance: with mocked APIs a Threads comment is collected once, reaches the author card and
  is answered at most once (two-call reply, ambiguous publish not resent); Instagram and Facebook
  behaviour is unchanged; the migration keeps existing rows; the refresh job writes both copies and
  logs no token. Live check after H18 and Volodymyr's OK: one real Threads comment answered once.
- Tests: mocked Threads Graph (list posts, list replies with watermark, own-reply skip, two-call
  reply, ambiguous publish, over-budget reply, 190 without refresh), migration on a D1 copy with
  existing rows, bot collect/send for `threads`, refresh script with the Worker step (success,
  Worker failure after GitHub write, no secret in output), actionlint.

#### T49e — PR #105 review notes (`channels`, `bot`)
- Done 2026-11-10: PR #106 merged (`d679fe3`); bot deployed (Worker `c5010485`). Review note from
  PR #106 (non-blocking, for the next implementer task): bump `COMMENT_REPLY_PROMPT_VERSION` or
  record a Threads variant id for the appended 500-byte instruction. Replies poll at most four
  times before publish; pre-publish failures reopen, ambiguous publish remains blocked.
  Threads drafting accepts the network and requests 500 UTF-8 bytes; cards and Send enforce
  the limit. Meta comment config requires exactly one reply strategy.
- Added 2026-11-10 by claude-code. Owner: codex · Reviewer: claude-code · Depends on: T49d.
- Review notes from PR #105 (non-blocking):
  1. Threads `reply` publishes the container without a status check; a "not ready" 4xx reopens the
     reply and the author must press Send again. Add a short bounded container status check
     before `threads_publish` (keep the ambiguous-publish rule).
  2. A reply over 500 UTF-8 bytes is rejected with the generic reopen message while the drafter
     targets `commentReplyLimit` (2200). Add a per-network reply limit to the drafter/session so
     the author sees why (Threads 500 bytes).
  3. `MetaCommentsConfig` makes both `replyPath` and `reply` optional and uses `replyPath!`; make
     it a union type requiring exactly one.
- Acceptance: Instagram and Facebook behaviour unchanged; Threads reply waits for a ready container
  within a bound; over-limit Threads drafts are flagged to the author before Send.
- Tests: mocked container not-ready then ready, not-ready past the bound (reopens), per-network
  limit in drafter/session, typecheck for the config union.

### T50 — Participants' group: rules, links, privacy text (F35, `site`, docs) · Sensitive: legal text
- Done 2026-11-06: PR #90 merged (`2a619f7`), site deployed (run 42200943247, link live on
  `/kreis/` and `/uk/kreis/`); Q17 agreed. Bot deployed by Volodymyr; group privacy paragraph reviewed and accepted.
- Owner: kimi-code · Reviewer: claude-code · Depends on: H16 (spec v8 approved and Q17 working answer recorded 2026-11-06)
- Change: draft group rules (DE and UK) in `docs/community-rules.md` for the author to approve
  (never her final text without her OK); the group link on `/kreis/` from an optional tenant
  setting `site.groupUrl` (no change to channel posts); a Datenschutzerklärung paragraph for the group, marked for Volodymyr's and the author's review.
- Acceptance: the site links to the group in both languages; the legal paragraph is reviewed by
  Volodymyr; no bot, D1 or publisher change.
- Tests: site build with and without `site.groupUrl`.

### T51 — Fix Instagram carousel container (`channels`) · hotfix before T33
- Owner: kimi-code · Reviewer: claude-code · Found in the live `/new` run 2026-11-13
- Failure: publish run 43386329746, post `01M79WSSK61F11FA1C5J61BVCS` (3 photos). Telegram
  delivered; Instagram failed with `(#100) The parameter image_url is required` on the carousel
  parent container, so Facebook, Threads and the site build never ran (site page 404).
- Cause: `packages/channels/src/instagram/adapter.ts` creates the parent container with
  `children` and `caption` but without `media_type: 'CAROUSEL'`, so Graph treats it as a single
  image. `children` is also sent as a JSON array; Meta documents a comma-separated string. This was
  the first live carousel (docs/instagram-runbook.md, "Carousel `children` format").
- Change: send `media_type: 'CAROUSEL'` and `children: children.join(',')` on the parent
  container; keep single-photo and child-item calls unchanged. Update the runbook note (verified
  live once the retry succeeds). Check the Facebook and Threads multi-photo paths for the same
  gap; fix only if they have it, otherwise note "checked" in the PR.
- Acceptance: unit test asserts the exact parent-container params; resume of the failed post
  after merge skips Telegram (ledger) and delivers Instagram, Facebook, Threads, then the site.
- Recovery after merge (operator): do not use "Re-run jobs" on run 43386329746 (it runs the old
  dispatch commit); start a new publish from `main` for the same draft (bot "Publish" again, or
  workflow_dispatch with the same payload and `live`).
- Tests: Instagram adapter carousel test; existing channel suites.

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

### T52 — Authenticity label instead of AI note (F36, `site`, `channels`, `bot`)
- Status: done 2026-11-13 (PR #127).
- Owner: codex · Reviewer: claude-code · Depends on: spec v9 (approved 2026-11-13) · Before T33
- Found 2026-11-13: post `01m79ykb8cdgrx6k29htysnzja` (photos of a participant's work) shows
  "Створено за допомогою ШІ" on the site, because a German version sets `provenance: ai-assisted`
  (`apps/bot/src/bot.ts` publishJobOf) and the site renders it.
- Change:
  - Site: `components/Provenance.astro`, `posts/[id].astro` and `[section]/[id].astro` stop
    rendering the `ai-assisted` note; posts with photos and works render "Оригінальна робота" /
    "Originalarbeit" (reuse `ui.linkedWork` wording, own key). `ai-generated` keeps its note.
  - Shows: site page and captions keep "KI-generiertes Model" and add "Originalarbeit".
  - Channels: Telegram, Instagram, Facebook, Threads renderers add the label line to captions of
    posts with photos and of works, before the site link; one shared constant like
    `show-disclosures.ts`. Posts without photos unchanged.
  - Bot preview shows the label exactly as published.
  - Keep `provenance` values in payloads and content files unchanged (F6).
- Acceptance: unit tests per renderer (photo post, text-only post, work, show) and a site build test
  for a post with `ai-assisted` DE version: no AI text, label present in DE and UK. Already published
  site pages change on the next site build; existing channel posts are not edited.

### T53 — Author's own photos and video in shows (F37, spec v10)
- Spec v10 approved 2026-11-13 (Volodymyr): only the author and Volodymyr may appear; authentic
  media first; 0-3 photos + 0-1 video. Architecture: docs/02-architecture.md "Authentic show media".
- Split into T53a-T53f, each one PR under ~400 changed non-test lines.
  All: **Owner: codex · Reviewer: claude-code**. T53b, T53c and T53d process personal data:
  Volodymyr's OK in chat before merge.

#### T53a — Authentic media contracts (`core`)
- Change: optional `authentic` list on `showSchema` (fileName, kind, provenance `human`, people
  `none | author | operator | both`);
  bounds 0-3 photos, 0-1 video, total ≤10; names disjoint from generated and originals;
  `showPublicationSchema` media = generated + authentic (4-10). Serialize/parse round trip.
- Acceptance: existing show fixtures parse unchanged; invalid bounds, overlaps and a generated file
  marked `human` are rejected.
- Tests: schema cases above, publication media match.

#### T53b — `/show` step "Додати свої фото/відео" (`bot`) · Depends on: T53a
- Change: optional step after a ready preview: add photos/video, remove an item, people answer
  (ніхто / авторка / Володимир / обоє) and the confirmation «У кадрі лише авторка і/або Володимир»;
  stored in `extras.showAuthentic`; size/duration/type checks (≤60 s, ≤20 MB) with UA messages;
  version bump and readiness invalidation; preview shows the block «Оригінальна робота». No AI call.
- Acceptance: approval is impossible with unconfirmed people or over-limit media; skipping keeps the
  current flow byte-for-byte.
- Tests: session flow, limits, CAS races on album intake, stale callbacks, skip path.
- Implementation note: MP4/MOV documents lack duration in Telegram message metadata; the bot
  asks the author to resend as video so the 60-second limit can be checked before download.
  Authentic publication stays blocked until T53c supplies its transport; generated-only approval
  remains available.

#### T53c — Approval transport for authentic media (`bot`) · Depends on: T53b
- Change: on approval download each file once via `getFile`, store in `SHOW_MEDIA` R2 under the
  show prefix, add refs to the `kind: show` job; retries reuse stored objects (idempotent).
- Acceptance: job validates against T53a; no Telegram file id or bytes in Git or job payload.
- Tests: mocked Telegram/R2, retry without second download, failure message to the author.
- Implementation: private R2 refs are `show-authentic:v1:<tenant>:<show>:<sha256>`;
  mixed jobs carry generated `show-marked:v1:...` refs too. T53d must resolve both; the
  generated-only transport is unchanged. Upload acknowledgements do not resend media/keyboards;
  `/show` then "Додати свої фото/відео" opens the current confirmation controls.
- Review notes from PR #129 (non-blocking): intake resends every stored item on each upload
  (a 3-photo album gives 6 photos and 3 keyboards); with authentic items the approval screen
  shows only "Додати свої фото/відео" (no regen/cancel) and no «Оригінальна робота» block;
  the add button stays on approved shows and answers with the stale-step error.

#### T53d — Publisher metadata stripping and commit (`publisher`) · Depends on: T53c
- Implementation: resolves scoped R2 refs, strips authentic metadata before any content write,
  persists authentic files through the Git store, reuses committed bytes on retry and supports
  temporary-store dry-run. PR #130 approval/cancellation correctness notes addressed; bounded
  upload buffering retained as a documented optional memory optimization.
- Change: resolve authentic refs, lossless JPEG APP1/APP13 removal, ffmpeg metadata-free remux to
  MP4, duration probe, post-strip check, commit beside generated media; dry-run support.
- Acceptance: fixtures with GPS EXIF and a QuickTime location tag come out clean, pixels/streams
  unchanged; a bad video fails with an author-visible reason and no partial commit.
- Tests: fixtures above, idempotent retry, dry-run.
- Review notes from PR #128: until this task, `prepareShowPublication` hits a non-null assertion
  (TypeError) on an authentic ref; replace it with an explicit authentic branch. Photo names allow
  only lowercase `.jpg/.jpeg`, so T53b must normalise Telegram file names.
- Review notes from PR #130 (non-blocking): the publisher passes every show ref to
  `TelegramMediaSource`, so resolve `show-authentic:v1:` and `show-marked:v1:` refs from R2;
  `owncancel` does not clear the chat session like `/discard` and omits the evidence/costs note;
  in `present` a stale `current()` inside the authentic `try` reports a storage failure instead of
  the stale-step message; `approve` checks `confirmed` but not `people`; whole files (≤20 MB) are
  buffered before R2 `put` (consider `FixedLengthStream`). Retention decided by Volodymyr
  (architecture, approval section): 30-day R2 lifecycle rule on `show-authentic/` only. Rollout:
  the reviewer adds it before the bot deploy with
  `wrangler r2 bucket lifecycle add handmake-show <name> show-authentic/ --expire-days 30`.

- Review notes from PR #131 (non-blocking): stripping all APP1 also drops EXIF Orientation
  (phone JPEGs sent as documents may appear rotated); COM segments are kept; JPEGs with bytes
  after EOI (Motion Photo) are rejected with a generic error; video codec is not checked (HEVC
  MOV may be rejected by Instagram/Threads); `dry-run.ts` uses `'posts'` canonical links for shows.

#### T53e — Site show page (`site`) · Depends on: T53a
- Change: block «Оригінальна робота» / «Originalarbeit» with authentic photos/video before the
  generated block; served as-is; alt texts; no AI note on authentic items.
- Acceptance: build test for a show with and without authentic media, DE and UK.

#### T53f — Channel show rendering (`channels`) · Depends on: T53a
- Status: done 2026-11-13 (PR #134 merged `ce48870`; bot Worker `e1fa1dcb-2b0e-4ce3-80fa-910a55f5966f`).
- Review notes from PR #134: moved to T53g.
- Change: Telegram/Instagram/Facebook/Threads albums put authentic photos first; caption line
  "KI-generierte Bilder ab Bild N" / «Згенеровані ШІ кадри з кадру N» only when authentic photos
  exist; Telegram replies with authentic video before the generated one; limits rechecked.
- Acceptance: unit tests per renderer for shows with 0, 1 and 3 authentic photos and with a video;
  shows without authentic media render exactly as before.
- Review notes from PR #133 (site, fix in this PR): in `apps/site/src/pages/[...lang]/shows/[id].astro`
  use `ui.authenticityLabel` instead of the three hardcoded `lang === 'uk' ? ...` labels; add a DE
  build assertion that a show without authentic media has no `authentic-heading`.

#### T53g — PR #134 review notes (`publisher`, `core`) · Depends on: T53f
- Status: done (PR #135, merged 2026-11-13).
- Owner: codex · Reviewer: claude-code
- Review notes from PR #134:
  1. `instagramFramedFileName` (`apps/publisher/src/instagram-delivery.ts`) maps `x.jpg` and
     `x.png` to the same `x.ig.jpg`. The show schema only keeps full file names disjoint, so an
     authentic `foo.jpg` beside a generated `foo.png` would overwrite one framed copy. Bot naming
     (`authentic-photo-N.jpg`) prevents it today. Add a guard: reject duplicate framed names
     before writing (in `prepareInstagramDelivery`) or require disjoint name stems for show
     photos in `showSchema`.
  2. A `showCopyPlan` persisted before PR #134 for a show that already had authentic media now
     fails with `copy media changed`, because the hash list gained the authentic files. Keep the
     fail-safe (no silent re-plan, no double posting), but make the error say that the plan
     predates authentic media, and document the operator recovery in `docs/show-copies.md`.
- Acceptance: colliding framed names fail before any file write or network call; existing shows
  and plans without authentic media behave unchanged; the legacy-plan error is distinct.
- Tests: framed-name collision case; legacy plan with generated-only hashes for a show with
  authentic media; existing publisher and core suites (targeted, per limit rules).

#### T31e — Drop Facebook as a contest vote source (`bot`, docs) · Depends on: T31d3
- Status: implemented; awaiting claude-code review; approved by Volodymyr 2026-11-13 (option 1 of two; App Review deferred).
- Owner: codex · Reviewer: claude-code
- Why: verified 2026-11-13 (docs/contest-vote-collection.md) that Facebook returns reader
  comments without `from`, even with `pages_read_user_content`. Every Facebook digit comment
  makes the Facebook tally, and with it the combined contest result, unreadable. `wotwPoll` is
  enabled for faden-und-stimmung; the next closing is Wednesday 2026-11-18 20:00 Berlin, so
  this should merge and deploy before then.
- Change: (1) closing collection reads votes only from Telegram, Instagram and Threads; the
  Facebook adapter is no longer a contest source (`sources` in `apps/bot/src/composition.ts`),
  and the totals/author wording no longer lists Facebook. (2) The ballot copy published to
  Facebook must not invite digit comments: give Facebook a variant (UA/DE) that points readers
  to vote in Telegram or Instagram instead; other channels keep the current text. (3) The
  comment inbox (`comment-collect.ts`) for Facebook is unrelated and stays unchanged.
  (4) Update docs/contest-vote-collection.md: Facebook is not a vote source and why.
- Acceptance: a closing with Facebook digit comments present makes no Facebook read and yields a
  readable result from the other sources; Telegram/Instagram/Threads behaviour unchanged;
  Facebook ballot text has no comment-vote instruction in either language. No migration, no
  secret or wrangler change.
- Tests: closing sources exclude Facebook for a tenant with Facebook configured; combined totals
  without Facebook; Facebook ballot wording UA/DE; affected bot suites only (limit rules).

### T54 — Profile links in the site footer (F38, `site`)
- Status: done (PR #137, merged 2026-11-13).
- Owner: codex · Reviewer: claude-code · Depends on: none
- Why: the site links only the Telegram channel. Visitors should find the brand's active profiles,
  and search engines should connect the site with them, without pulling visitors away from the
  newsletter (F38).
- Change:
  1. Tenant config: optional `site.profiles`, an ordered list of `{ network, url, lead }`, where
     `network` is a free string label (no enum in core, any tenant may list any network), `url` an
     https URL and `lead` an optional list of language codes for which this entry moves to the
     front. Validate in the site-data loader; reject non-https URLs. For faden-und-stimmung:
     `instagram` → `https://www.instagram.com/fadenundstimmung/` (lead: `de`), `telegram` →
     `https://t.me/Faden_und_Stimmung` (lead: `uk`).
  2. Footer (`apps/site/src/layouts/Base.astro`): a profile list replaces the footer's
     `JoinChannel` when `site.profiles` is set; without it the footer stays as today.
     `JoinChannel` on post and show pages is unchanged. Visible label is the network name
     (capitalised: "Instagram", "Telegram"), with a localized group label (`aria-label`) from
     `lib/i18n.ts`. Text only: no logos, icons of third parties, `target="_blank"`, widgets or
     external resources. Each link has `rel="me"`.
  3. Home page (both languages): a JSON-LD `Organization` block with `name`, `url` (`site.baseUrl`)
     and `sameAs` (profile URLs), only when `site.profiles` is set. Serialize with `<`, `>` and `&`
     escaped as `\u003c`, `\u003e`, `\u0026`.
  4. Build policy (`apps/site/src/lib/build-policy.ts`): allow an inline `<script>` only when its
     `type` is exactly `application/ld+json` and its text parses as JSON; every other inline script
     still fails the build.
- Acceptance: DE pages list Instagram then Telegram, UK pages Telegram then Instagram; links have
  `rel="me"` and no other attributes that open new windows; a tenant without `site.profiles`
  builds the same footer as before and has no JSON-LD; the home page JSON-LD `sameAs` equals the
  configured URLs; no third-party resource or logo in the generated site; no Datenschutz change
  (plain links, profiles are already covered there).
- Tests: site build with and without `site.profiles`; per-language order; loader rejects a
  non-https URL; build policy accepts valid JSON-LD and rejects non-JSON `application/ld+json`,
  other inline script types and a script without `type`; site suites only (limit rules).
