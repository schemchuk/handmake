# 02 — Architecture

How the system is built; major choices are recorded in docs/decisions/.

Status: draft v2 (2026-10-21), awaiting review. v1 approved; v2 adds ports, tenancy and the work-of-week poll. Implements docs/01-spec.md v4.

## 1. Overview

```
 Author's phone                Cloudflare (free tier)                  GitHub (public repo)
 ┌───────────┐  webhook   ┌──────────────────────────────┐ dispatch ┌──────────────────────────────┐
 │ Telegram  │ ─────────▶ │ bot Worker                   │ ───────▶ │ Actions: publish workflow    │
 │ private   │ ◀───────── │  - allow-list, draft FSM     │          │  - fetch photos from Telegram│
 │ chat      │  preview,  │  - AI translate + humanize   │          │  - write content folder      │
 └───────────┘  buttons   │  - preview / edit / publish  │          │  - commit to main            │
                          │ D1: drafts, publish requests │          │  - publish via adapters      │
                          └──────────────────────────────┘          │  - write ledger, commit      │
                                     │  ▲                           │  - report back via bot API   │
                                     ▼  │                           └──────────────┬───────────────┘
                              Claude API (translation)                             │
                                                              ┌────────────────────┼─────────────┐
                                                              ▼                    ▼             ▼
                                                     Telegram channel   Instagram (phase 1b)  Website (phase 2)
```

Two runtimes, one shared core:

- **Bot Worker** (always on, serverless): fast interactive part. Talks to the author, keeps drafts,
  calls the AI, renders previews. It never publishes itself.
- **Publish workflow** (GitHub Actions): slow, auditable part. Turns an approved draft into a content
  folder in Git and delivers it to every channel, idempotently. Logs are visible in the repo's
  Actions tab, which is part of the portfolio story.
- **Core package**: pure TypeScript with no I/O: post schema, limit checks, ledger logic, state machines,
  and the **ports** (interfaces) every external service is reached through (section 11). Both runtimes
  import it, and most tests target it.

For the circle (first tenant), Git is the source of truth for published content and the website
(phase 2) is built from the same content folders. Other tenants will use other content stores (ADR 006).

## 2. Repository layout

```
apps/
  bot/           Cloudflare Worker: webhook, draft state machine, AI step, preview
  publisher/     Node CLI run by GitHub Actions: build content folder, deliver, ledger
  site/          Astro site (phase 2)
packages/
  core/          schema (zod), limits, ledger, state machines, tenant config, ports/ — no I/O
  channels/      one folder per network (telegram, instagram, …), each a ChannelAdapter + registry
  stores/        ContentStore implementations (git-repo now)
  ai/            Translator and WinnerPicker on Claude, versioned prompts
config/
  tenants/faden-und-stimmung.yaml  tenant config (no secrets)
content/
  posts/<yyyy-mm-dd>-<slug>/index.md + photos/*.jpg
  ledger/<post-id>.json
docs/
.github/workflows/  ci.yml, publish.yml
```

pnpm workspaces, TypeScript strict, Vitest, ESLint + Prettier, secret scanning in CI (see ADR 001).

## 3. Content model

`content/posts/2026-10-23-autumn-scarves/index.md`:

```markdown
---
id: 01JB8Q3...            # ULID, stable across retries
tenant: faden-und-stimmung
date: 2026-10-23T14:12:00+02:00
publishAt: now            # reserved for scheduled publishing (deferred feature)
type: free                # free | announcement | reminder | wotw-poll | wotw-result
photos: [01.jpg, 02.jpg, 03.jpg]
channels: [telegram]      # instagram added when configured
versions:
  uk: { provenance: human }
  de: { provenance: ai-assisted, model: <model-id>, prompt: humanize-de@1 }
---

<!-- lang:uk -->
...Ukrainian text...

<!-- lang:de -->
...German text...
```

`content/ledger/<id>.json` records, per channel: `status` (pending | done | failed), remote message
or media IDs, timestamps, last error. Kept separate from the post so retries do not rewrite the post.

Tenant config `config/tenants/faden-und-stimmung.yaml` holds tenant ID and name, languages and their
order, enabled channels with per-channel settings (e.g. Instagram language `de`), content store type,
meeting schedule (Thursday 14:00 Europe/Berlin), work-of-week poll settings, feature flags, an empty
`offerings` stub, and *names* of secrets, never values.

## 4. Flows

### 4.1 Draft and preview (bot Worker)

1. Telegram calls the webhook. The Worker checks the `X-Telegram-Bot-Api-Secret-Token` header and
   the sender against the allow-list; anything else is dropped.
2. Text and photos are collected into the open draft in D1. Photos are kept as Telegram `file_id`s
   (no binary storage in the Worker, see ADR 005).
3. On "Done" (or after the first text plus photos), the Worker calls the AI package: one request that
   translates UA to DE and applies the humanizer rules (ADR 004).
4. The Worker renders the preview through `core` renderers (the same code the publisher uses), so the
   preview is exactly what will be posted, including limit warnings.
5. Inline buttons: Edit UA, Edit DE, Regenerate DE, Publish, Discard.
   Edit = the bot asks for the replacement text and the next message replaces that version (ADR 005).

### 4.2 Publish

1. Publish → the consent question (faces) → Yes.
2. The Worker moves the draft `ready → publishing` in a single D1 statement (`UPDATE ... WHERE
   status = 'ready'`). A second press or a webhook retry finds no `ready` row and does nothing (A4).
3. The Worker sends `repository_dispatch` (`publish-post`) with the draft ID and payload
   (texts, photo `file_id`s, provenance), using a fine-grained GitHub token limited to this repo.
4. `publish.yml` runs with `concurrency: publish` (one at a time):
   1. Build the content folder: download photos via Telegram `getFile`, re-encode to JPEG and strip
      all metadata, write `index.md`, validate with the `core` schema.
   2. Commit the content folder to `main` (bot identity, path-restricted to `content/`).
   3. For each channel whose ledger status is not `done`: call the adapter, then record the result.
   4. Commit the ledger. Notify the author (success) or the operator (failure) via the Bot API.
5. Re-running the workflow for the same ID skips the steps already done (F11).

Telegram rendering (`core`): UA post = photo album with the UA text as caption if it fits 1024
characters, otherwise album then a separate text message (up to 4096). DE post is a text-only message
replying to the UA album (O1), split into several replies only if it exceeds 4096 characters.

### 4.3 Publish callback

At the end of a run the workflow calls an authenticated Worker endpoint (`POST /callbacks/published`,
HMAC-signed) with the post ID, final ledger and photo list. The Worker marks the draft `published` and
keeps a small index of published posts per tenant in D1 (needed for the work-of-week poll and, later,
analytics). The Git repo stays the source of truth; the D1 index can be rebuilt from it.

### 4.4 Work of the week (F19, after the MVP)

1. Worker cron (Monday 10:00 tenant time, Q8) collects candidates from the D1 index: one photo per
   post published in the last 7 days, newest 10. Later, candidates may also come from a
   `SubmissionSource` (phase 3: moderated bot submissions).
2. It creates a `wotw-poll` draft: album of candidates numbered 1..N plus a poll "No 1".."No N". The
   author gets the usual preview and Publish (Q6).
3. The publisher delivers it through the channel's poll capability (`sendMediaGroup`, then `sendPoll`
   replying to the album). The ledger stores the poll's message ID.
4. Worker cron at the closing time (Wednesday 20:00, Q8) calls `closePoll` on the channel adapter
   (`stopPoll`), which returns the final counts.
5. Winner = most votes. Zero votes or unreadable result → `WinnerPicker` (Claude, sees the candidate
   photos) chooses and gives a one-line reason. Tie → `WinnerPicker` chooses among the tied (Q5).
6. A `wotw-result` draft (winner photo, UA/DE text, "chosen by readers" or "chosen by AI") goes to the
   author for Publish; Instagram gets it as a normal post.

Channel polls are anonymous: no voter data reaches us.

### 4.5 Failure handling

- AI failure → the author gets "translation failed, retry or write DE yourself" (F7).
- Dispatch failure → the draft goes back to `ready` and the author sees an error; nothing was published.
- Adapter failure → ledger `failed` with the error, operator alert (F15), author told "partially
  published, Volodymyr is notified". Re-run the workflow from the Actions tab to finish.

## 5. Security and privacy

- Secrets: Worker secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`,
  `GITHUB_DISPATCH_TOKEN`, allow-list IDs) and GitHub Secrets (`TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHANNEL_ID`, `OPERATOR_CHAT_ID`, later Instagram credentials). `.env.example` lists names only.
- Least privilege: the dispatch token can only trigger workflows on this repo; the workflow's
  `GITHUB_TOKEN` has `contents: write` only.
- No logging of message bodies or tokens in the Worker; the publisher logs IDs and statuses only.
- Drafts are deleted from D1 after 30 days or after publishing (only the published copy in Git remains).
- Photos: metadata stripped on publish (F4). Face consent confirmed by the author (F10).
- The author's Instagram handle and IDs live in secrets, not in the repo (spec section 11).
- Third parties that receive data: Telegram, Cloudflare, GitHub, Anthropic (and Meta in 1b). All must
  appear in the Datenschutzerklärung (phase 2). Flag: Volodymyr checks the DPAs.

## 6. Testing and CI

- `ci.yml` on every PR: install, lint, typecheck, unit tests, secret scan (gitleaks), build of each app.
- Unit tests (`core`): schema validation, renderers and limits (caption 1024 / message 4096 / IG 2200),
  ledger transitions and idempotency, config loading.
- Adapter tests: against recorded HTTP fixtures (no real calls in CI).
- Dry-run (`publisher --dry-run`): runs the whole publish flow with fake adapters and prints what would
  be sent. Used in CI on a sample post.
- Manual end-to-end check on a private test channel before the real channel (separate secrets).

## 7. Cost estimate (monthly)

| Item | Expected | Note |
|---|---|---|
| Cloudflare Workers + D1 | 0 € | free tier, far below limits at ~10 posts/month |
| GitHub Actions | 0 € | public repo |
| Claude API | < 1 € | ~10 posts × ~3k tokens; even the top model stays well under the budget |
| Domain (phase 2) | ~1 €/month | optional |

## 8. How deferred features fit

- Web admin: a second client of the same draft API in the Worker; D1 already holds drafts.
- Scheduled publishing: `publishAt` + a cron trigger in the Worker that dispatches due drafts.
- Analytics: ledger already stores remote IDs; a scheduled job can fetch stats.
- AI-generated posts and F18/F19: create drafts programmatically; they still need the author's Publish.
- Other groups and bloggers: see section 11.
- Other social networks: a new folder in `packages/channels/` implementing `ChannelAdapter`.

## 9. Decisions

| ADR | Decision |
|---|---|
| [001](decisions/001-typescript-monorepo.md) | TypeScript monorepo (pnpm, Vitest), shared core |
| [002](decisions/002-bot-hosting.md) | Bot on Cloudflare Workers + D1 |
| [003](decisions/003-publish-in-github-actions.md) | Publishing runs in GitHub Actions via repository_dispatch; Git is the source of truth |
| [004](decisions/004-ai-translation.md) | Claude API for translation + humanizer, one call, versioned prompt |
| [005](decisions/005-editing-and-photos.md) | MVP editing by reply in chat; photos via Telegram file_id; Mini App later |
| [006](decisions/006-multi-tenancy.md) | Tenant-aware from day one; pluggable content store; per-tenant queues later |
| [007](decisions/007-ports-and-adapters.md) | Hexagonal core: ports, channel registry, composition root per runtime |
| [008](decisions/008-work-of-week-poll.md) | Work of the week via anonymous channel poll, AI fallback |

## 10. Open questions

Resolved 2026-10-21: O1 = DE post is a text-only reply to the UA album; O2 = the publish workflow may
commit to `main` under `content/` only (AGENTS.md amended, task T00); O3 = `claude-opus-5-5`.

- **O1** Telegram layout: should the DE post repeat the photo album, or be a text-only post replying to
  the UA album? Repeating doubles the photos in the channel; a reply keeps the feed cleaner.
- **O2** Content commits go directly to `main` from the workflow (path `content/` only). This is an
  exception to "code via PR, merged by Volodymyr" in AGENTS.md. Needs approval and an AGENTS.md update.
- **O3** AI model choice, see ADR 004.

## 11. Ports, tenancy and scaling (v2)

Goal: the circle runs on the smallest setup, but external tenants (groups, bloggers) and new networks
can be added later without rewriting the core. Rule of thumb: **build the seams now, the extra
implementations only when needed.**

### 11.1 Ports (interfaces in `packages/core/ports`)

| Port | Responsibility | Implementation now | Later |
|---|---|---|---|
| `ChannelAdapter` | `capabilities`, `render(post)`, `deliver(ops)`, optional `openPoll` / `closePoll` | Telegram (MVP), Instagram (1b) | Facebook, Threads, TikTok, YouTube, … |
| `ContentStore` | save post and media, read/write ledger, list published | Git repo (this repo) | tenant's own repo, object storage (R2) |
| `DraftStore` | drafts, state transitions, published index | D1 | same, sharded by tenant |
| `PublishRunner` | run a publish job for a post | GitHub Actions via `repository_dispatch` | Cloudflare Queues consumer |
| `Translator` | UA → DE with humanizer | Claude | other providers |
| `WinnerPicker` | choose a work of the week from photos | Claude (vision) | — |
| `MediaSource` | fetch author's photos | Telegram `getFile` | web upload (admin panel) |
| `Notifier` | messages to author and operator | Telegram bot | e-mail |
| `SecretResolver` | resolve secret names per tenant | environment / GitHub Secrets | Worker secrets store per tenant |
| `Clock` / `Scheduler` | time and recurring triggers | Worker cron | same |
| `SubmissionSource` | contest entries submitted by participants | none (phase 1 uses the author's posts) | Telegram bot submissions (phase 3), Instagram (idea) |

### 11.2 Patterns

- **Hexagonal (ports & adapters):** core logic depends only on ports; adapters live at the edges.
  Testing uses fake adapters, which is also how dry-run works.
- **Strategy + registry:** each network registers a `ChannelAdapter` under its key; the publisher asks
  the registry for the tenant's enabled channels. Capabilities (max photos, caption limit, polls) drive
  rendering, so core code has no `if (telegram)` branches.
- **Composition root:** each runtime (`apps/bot`, `apps/publisher`) wires concrete adapters in one file,
  by plain constructor injection. No DI framework.
- **State machines:** draft, publish job and poll lifecycles are explicit, pure transition functions.
- **Idempotency:** idempotency key `tenantId:postId:channel:opIndex`; the ledger is the record.
- **Domain events:** `DraftApproved`, `PostPublished`, `PublishFailed`, `PollOpened`, `PollClosed` as typed
  objects. Now handled in-process; later the same events go on a queue (event-driven, one queue per
  tenant or tenant key, so one slow tenant cannot block others).
- **Transactional outbox (later):** when publishing moves to queues, the Worker writes the job and the
  draft status in one D1 transaction, and a dispatcher sends it.
- **Feature flags per tenant:** e.g. `wotwPoll`, `instagram`, `translation`, read from tenant config.
- **Observability:** structured log event per job with `tenantId`, `postId`, channel, status, duration.

### 11.3 What changes for an external tenant (not built now)

1. Tenant config + secrets in a per-tenant secret store (not this repo).
2. `ContentStore` other than this public repo.
3. `PublishRunner` on Cloudflare Queues instead of this repo's Actions (this repo's Actions only ever
   publish the circle).
4. Allow-list per tenant; the bot maps Telegram user ID → tenant.
5. Legal prerequisites from spec N8 (terms, DPA, privacy policy, Meta App Review).
