# 02 — Architecture

How the system is built; major choices are recorded in docs/decisions/.

Status: **draft v3 (2026-10-28), awaiting review.** v3 implements docs/01-spec.md v5: contest entries via
the author, website, video, funnel metrics, shop seams (sections 4.4, 4.6-4.9, ADR 010-014). v2 (approved
2026-10-21) added ports, tenancy and the poll.

## 1. Overview

```
 Author's phone                Cloudflare (free tier)                   GitHub (public repo)
 ┌───────────┐  webhook   ┌──────────────────────────────┐ dispatch ┌───────────────────────────────┐
 │ Telegram  │ ─────────▶ │ bot Worker                   │ ───────▶ │ Actions                       │
 │ private   │ ◀───────── │  - allow-list, draft FSM     │          │  publish: content -> channels │
 │ chat      │  preview,  │  - drafts: post/entry/work   │ ◀─────── │  site:    Astro build -> Pages│
 └───────────┘  buttons   │  - AI translate / describe   │ callback │  render-video (2b): MP4 -> R2 │
                          │  - crons: F18, F19, metrics  │          └──────────────┬────────────────┘
                          │ D1: drafts, entries, index,  │                         │
                          │     metrics                  │       ┌─────────────────┼───────────────┐
                          └──────────────────────────────┘       ▼                 ▼               ▼
                                     │  ▲               Telegram channel     Instagram (1b)   Website on
                                     ▼  │                                                     CF Pages (2)
                              Claude API (text, vision)         R2 media store (videos, phase 2b)
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
  site/          Astro site on Cloudflare Pages (phase 2, ADR 011)
packages/
  core/          schema (zod), limits, ledger, state machines, tenant config, ports/ — no I/O
  channels/      one folder per network (telegram, instagram, …), each a ChannelAdapter + registry
  stores/        ContentStore implementations (git-repo now)
  ai/            Translator, WinnerPicker, TextGenerator on Claude, versioned prompts
  video/         HyperFrames templates + VideoRenderer (phase 2b, ADR 012, proposed)
config/
  tenants/faden-und-stimmung.yaml  tenant config (no secrets)
content/
  posts/<yyyy-mm-dd>-<slug>/index.md + photos/*.jpg
  works/<id>/index.md + photos/*.jpg      author's works (phase 2)
  collections/<slug>.md                   groups of works (phase 2)
  ledger/<post-id>.json
docs/
.github/workflows/  ci.yml, publish.yml (+ site job), render-video.yml (2b)
```

pnpm workspaces, TypeScript strict, Vitest, ESLint + Prettier, secret scanning in CI (see ADR 001).
Internal packages are consumed as TypeScript source (`exports` → `src/*.ts`), so tests and
typecheck need no build; apps bundle (wrangler/esbuild for the bot, decided in their tasks).
`pnpm build` stays as an emit check.

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

v3 additions:
- `type` gains no new post types; contest entries are D1 drafts, not content files. Poll and result
  posts reference entries by placeholder `{entry:<entryId>}` in their texts; the name behind it lives
  only in D1 (ADR 010).
- `content/works/<id>/index.md`: frontmatter `id, tenant, date, collection, photos, video?` (R2 key,
  2b), `versions` (UA/DE description with provenance), `sale?` (phase 4 only, ADR 014).
- `content/collections/<slug>.md`: `title` and `description` per language, `order`, cover photo.

Tenant config `config/tenants/faden-und-stimmung.yaml` holds tenant ID and name, languages and their
order, enabled channels with per-channel settings (e.g. Instagram language `de`), content store type,
meeting schedule (Thursday 14:00 Europe/Berlin), announcement/reminder schedule with Ukrainian
templates (F18), work-of-week poll settings, feature flags (`wotwPoll`, `site`, `video`, `metrics`,
`email`, `monetization`), a `site:` theme section (ADR 011), an empty `offerings` stub, and *names* of
secrets, never values.

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

### 4.4 Work of the week (F19, ADR 008 + 010)

1. **Entries.** The author starts an `entry` draft (`/entry`), sends one photo, optionally a first name
   or nickname, and confirms the participant's consent. The entry is stored in D1
   (`contest_entries`: tenantId, week, file_id, display_name?, consent_at, status).
2. **Open.** Worker cron at the opening time (Monday 10:00, config) reads the week's approved entries
   through `SubmissionSource` (`AuthorEntrySource`). Fewer than 2 → the author is told, no poll.
   Otherwise it creates a `wotw-poll` draft: album numbered 1..N, poll "No 1".."No N", captions with
   `{entry:<id>}` placeholders. The author gets the usual preview and Publish.
3. **Deliver.** The dispatch payload carries the entries' file_ids and display names; the publisher
   renders names into the Telegram ops but commits texts with placeholders only. The ledger stores the
   poll message ID; it is found by op kind `poll`, not by index (review note, PR #31).
4. **Close.** Worker cron at the closing time calls `closePoll` (`stopPoll`) and gets the counts.
5. **Winner.** Most votes; zero votes, unreadable result or tie → `WinnerPicker` (Claude, sees the
   candidate photos) chooses with a one-line reason.
6. **Result.** A `wotw-result` draft goes to the author for Publish. Telegram may show the display name;
   Instagram always shows "Work No N" (ADR 010).
7. **Withdrawal.** Deleting a display name in D1 triggers a caption edit on Telegram (`editCaption`
   capability) and a site rebuild. Entries are deleted 90 days after the result post.

Channel polls are anonymous: no voter data reaches us.

### 4.6 Works and collections (F24, phase 2)

1. The author starts a `work` draft (`/work`), sends photos and a short note, picks or creates a
   collection (inline buttons).
2. `TextGenerator` drafts a UA description and the DE version; she edits and approves as with posts.
3. Publish dispatches to the publish workflow with kind `work`: it writes `content/works/<id>/`,
   optionally also publishes a channel post about the new work (her choice in the preview).
4. A work is also the source for a video (4.8), which answers spec Q9 by default: "a new work = a
   `work` draft; `/video` on a published work starts the render".

### 4.7 Website build (F22-F23, ADR 011)

1. The `site` job runs after every publish job and on manual dispatch.
2. It reads content from the `ContentStore`, fetches contest display names from
   `GET /internal/contest-names` (HMAC), reads Impressum fields from secrets, builds Astro per tenant
   theme, and deploys to Cloudflare Pages.
3. A failed build alerts the operator; the published channel posts are unaffected.

### 4.8 Video (F20-F21, phase 2b, ADR 012 proposed)

1. `/video` on a published work → the Worker asks `TextGenerator` for a short UA/DE caption script and
   dispatches `render-video` with work ID, template version and script.
2. The job renders the HyperFrames template to MP4 deterministically, uploads it to R2
   (`MediaStore`), and calls back the Worker, which sends the video to the author as a preview.
3. Publish → the publish workflow delivers a `video` op to every channel with the `video` capability
   (Telegram `sendVideo`; Instagram Reels container with the R2 public URL). Ledger as usual; a retry
   reuses the stored file, never re-renders.

### 4.9 Audience metrics and email (F25-F27, ADR 013)

1. Weekly Worker cron asks each channel adapter with the `metrics` capability for follower count and
   recent post stats; stores aggregates in D1 `audience_metrics`; sends a short summary to the author
   and operator. No personal data.
2. Email (later, needs approval): the site form posts to the email service (double opt-in); nothing is
   stored by us.
3. Monetization (phase 4, ADR 014): a tenant flag; the operator turns it on when the metrics reach the
   configured threshold.

### 4.5 Failure handling (all flows)

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
- Contest display names (first name or nickname, with consent) are the only personal data we store:
  D1 only, never in Git or logs, deleted 90 days after the result post (ADR 010).
- New secrets (v3): `CLOUDFLARE_API_TOKEN` (Pages deploy), `CLOUDFLARE_ACCOUNT_ID`, Impressum fields,
  `SITE_EXPORT_SECRET` (contest-names endpoint), later R2 keys and the email service key.
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
| Cloudflare Pages (phase 2) | 0 € | free tier |
| Domain (phase 2) | ~1 €/month | optional |
| R2 + render job (phase 2b) | 0 € | 10 GB free; Actions free for a public repo |
| Claude API with descriptions, scripts | 1-3 € | still within the 10 € budget |

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
| [009](decisions/009-agent-context-budget.md) | Agent context budget |
| [010](decisions/010-contest-entries-via-author.md) | Contest entries uploaded by the author; names in D1 only |
| [011](decisions/011-website.md) | Astro site on Cloudflare Pages, built by a job after each publish |
| [012](decisions/012-video-rendering.md) | Video: HyperFrames → MP4 in Actions, R2 storage (proposed) |
| [013](decisions/013-funnel-metrics-email.md) | Anonymous audience metrics; email via ready service later |
| [014](decisions/014-shop.md) | Shop behind a ShopProvider port and monetization flag (proposed) |

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
| `SubmissionSource` | contest entries | `AuthorEntrySource` (D1, ADR 010) | Instagram contest (idea) |
| `TextGenerator` | descriptions, captions, video scripts | Claude | other providers |
| `MediaStore` | large media (videos) with public URLs | — (R2 in 2b) | per-tenant bucket |
| `VideoRenderer` | template + assets → MP4 | — (HyperFrames in 2b) | other renderers |
| `EmailList` | double opt-in subscriptions | — (phase 3, needs approval) | per-tenant provider |
| `ShopProvider` | products, checkout links | — (phase 4) | per-tenant provider |

Channel capabilities (v3): `photos`, `polls`, `editCaption`, `video`, `metrics`; rendering and flows
check capabilities, never network names.

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
