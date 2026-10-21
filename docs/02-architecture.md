# 02 — Architecture

How the system is built; major choices are recorded in docs/decisions/.

Status: draft v1 (2026-10-21), awaiting Volodymyr's review. Implements docs/01-spec.md v3.

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
- **Core package**: pure TypeScript with no I/O: post schema, rendering per channel, limit checks,
  ledger logic. Both runtimes import it, and most tests target it.

Git is the source of truth for published content. The website (phase 2) is built from the same
content folders.

## 2. Repository layout

```
apps/
  bot/           Cloudflare Worker: webhook, draft state machine, AI step, preview
  publisher/     Node CLI run by GitHub Actions: build content folder, deliver, ledger
  site/          Astro site (phase 2)
packages/
  core/          schema (zod), renderers, limits, ledger, config loader — no I/O
  adapters/      telegram, instagram (phase 1b); each implements ChannelAdapter
  ai/            translation + humanizer client and versioned prompts
config/
  groups/faden-und-stimmung.yaml   group config (no secrets)
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
group: faden-und-stimmung
date: 2026-10-23T14:12:00+02:00
publishAt: now            # reserved for scheduled publishing (deferred feature)
type: free                # free | announcement | reminder | work-of-week
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

Group config `config/groups/faden-und-stimmung.yaml` holds name, languages and their order, channel
list, Instagram default language (`de`), meeting schedule (Thursday 14:00 Europe/Berlin), an empty
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
characters, otherwise album then a separate text message (up to 4096). DE post follows the same rule.
See open question O1 about sending the album twice.

### 4.3 Failure handling

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
- Other groups: another file in `config/groups/` plus its secrets.

## 9. Decisions

| ADR | Decision |
|---|---|
| [001](decisions/001-typescript-monorepo.md) | TypeScript monorepo (pnpm, Vitest), shared core |
| [002](decisions/002-bot-hosting.md) | Bot on Cloudflare Workers + D1 |
| [003](decisions/003-publish-in-github-actions.md) | Publishing runs in GitHub Actions via repository_dispatch; Git is the source of truth |
| [004](decisions/004-ai-translation.md) | Claude API for translation + humanizer, one call, versioned prompt |
| [005](decisions/005-editing-and-photos.md) | MVP editing by reply in chat; photos via Telegram file_id; Mini App later |

## 10. Open questions

- **O1** Telegram layout: should the DE post repeat the photo album, or be a text-only post replying to
  the UA album? Repeating doubles the photos in the channel; a reply keeps the feed cleaner.
- **O2** Content commits go directly to `main` from the workflow (path `content/` only). This is an
  exception to "code via PR, merged by Volodymyr" in AGENTS.md. Needs approval and an AGENTS.md update.
- **O3** AI model choice, see ADR 004.
