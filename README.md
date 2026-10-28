# Faden und Stimmung

Content pipeline for a weekly volunteer handmade circle in Landshut, Germany. The author writes a post
once in a private Telegram bot; it is translated, previewed, approved and published automatically.

**Status:** MVP live on Telegram since 2026-10-27 (Ukrainian + German). Instagram, website and the
work-of-the-week poll come next. Design docs: [docs/](docs/) (spec, architecture, ADRs, tasks).

## How it works

```
author ──► Telegram bot (Cloudflare Worker + D1) ──repository_dispatch──► GitHub Actions publish.yml
           collect text + photos                                          download + re-encode photos
           /done → Claude translates UA→DE                                commit content/ to main
           preview, edit, regenerate                                      post to the channel, ledger
           🚀 + consent → claim draft once                                notify author / operator
```

1. The author opens [@Faden_und_StimmungBot](https://t.me/Faden_und_StimmungBot) and sends Ukrainian
   text and up to 10 photos (as photos, or JPEG/PNG files). Only allow-listed Telegram users get in.
2. `/done` translates the text to German (Claude, prompt `packages/ai/prompts/humanize-de@1.md`) and
   sends a preview rendered exactly as it will be posted. Buttons: edit UA, edit DE, regenerate DE,
   publish, discard.
3. 🚀 asks for the face-consent confirmation, then moves the draft `ready → publishing` in one D1
   statement (a double press dispatches once) and fires `repository_dispatch`.
4. `publish.yml` builds the post folder under `content/posts/`, strips photo metadata, commits it,
   publishes to Telegram (Ukrainian album caption, German as a reply) and records every sent message
   in `content/ledger/`. A re-run never posts twice.

Code layout: `packages/core` (domain, ports, state machine), `packages/channels` (Telegram renderer and
adapter), `packages/stores` (Git content store), `packages/ai` (translator), `apps/bot` (Worker),
`apps/publisher` (CLI run by the workflow).

## Setup

Requirements: Node 22 (`.nvmrc`), pnpm, a Cloudflare account, a GitHub repo, an Anthropic API key.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Secrets (names in `.env.example`; values only in `.env`, GitHub Secrets and Worker secrets):

| Secret | GitHub Secrets | Worker secret |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | yes |
| `TELEGRAM_CHANNEL_ID`, `TELEGRAM_TEST_CHANNEL_ID` | yes | |
| `OPERATOR_CHAT_ID`, `AUTHOR_CHAT_ID` | yes | |
| `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_IDS` (JSON `{"<user id>":"<tenant>"}`) | | yes |
| `ANTHROPIC_API_KEY` | | yes |
| `GITHUB_DISPATCH_TOKEN` (fine-grained, this repo, Contents read/write) | | yes |

Bot Worker (`apps/bot`):

```sh
cd apps/bot
pnpm exec wrangler d1 create handmake-bot            # once; put database_id into wrangler.toml
pnpm exec wrangler d1 migrations apply handmake-bot --remote
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN     # and the other Worker secrets above
pnpm run deploy                                      # not "pnpm deploy" (a pnpm built-in)
pnpm run webhook:set                                 # registers the webhook with its secret
```

`apps/bot/wrangler.toml` `[vars]`: `PUBLISH_LIVE = "true"` sends bot posts to the live channel,
`"false"` to the private test channel. Change it and redeploy.

## Runbook

**A publish failed.** The operator gets a Telegram alert. Open the failed run in GitHub Actions and
press "Re-run jobs": the ledger skips every message already sent and sends only the rest. Telegram 5xx
and network errors are not retried inside a run; the re-run covers them.

**Publish a post by hand.** Actions → Publish → Run workflow, paste the payload JSON
`{"tenantId","draftId","texts","fileIds","provenance"}`. Without the "live" tick it goes to the test
channel.

**The bot says "Зараз працюю з цією чернеткою" on an old preview.** The draft is stuck `publishing`:
its "published" callback never reached the Worker (the run log shows an operator alert). Re-run the
last successful publish workflow: the ledger skips every delivery and only the callback re-fires
(the bot's endpoint is idempotent). Sending new text or `/new` starts the next post; pressing 🚀 on
the old draft is harmless either way — the ledger skips it.

**The bot does not answer.** Check the webhook:
`curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"` (look at `last_error_message`
and `pending_update_count`), then `pnpm exec wrangler tail` in `apps/bot` while sending a message.

**Rotate a token.**
- Bot token: BotFather → revoke, then update `.env`, GitHub Secret and Worker secret
  `TELEGRAM_BOT_TOKEN`, then `pnpm run webhook:set`.
- `GITHUB_DISPATCH_TOKEN`: create a new fine-grained token, `wrangler secret put`, delete the old one.
- `ANTHROPIC_API_KEY`: new key in the console, `wrangler secret put`, revoke the old one.
- `TELEGRAM_WEBHOOK_SECRET`: `wrangler secret put` a new random value, then `pnpm run webhook:set`.

Known edges: a Telegram retry after a saved-but-unanswered text can append it twice (at-least-once);
drafts untouched for 30 days are deleted by the daily cron. More in
[docs/review-notes.md](docs/review-notes.md).

## Acceptance

MVP checklist A1-A9 with results: [docs/e2e-mvp.md](docs/e2e-mvp.md).
