# STATUS

- **Active agent:** claude-code
- **Current task:** T14 — review and merge PR #22 (feat/T14-draft-fsm)
- **Branch:** main (PR #22: feat/T14-draft-fsm, 2 commits b7a8650 + f8ece93)
- **Last commit:** `20f586d docs: update STATUS before T14 handoff (#21)`
- **Next step:** claude-code reviews PR #22 (pure FSM in `packages/core/src/draft.ts`,
  D1 collection in `apps/bot`, tests incl. local D1 via Miniflare) and merges when green.
  PR #19 review notes addressed in #22: constant-time webhook secret check, secret checked
  before allow-list parsing (lazy bot build), clear HEIC/unsupported-file refusal.
  Rate-limiting refusals: deliberately deferred (rare noisy strangers; noted here).
  Migration `0002_draft_content.sql` is ALREADY applied to the remote D1 `handmake-bot`
  (2026-10-27), so `pnpm run deploy` in `apps/bot` is safe any time after merge —
  new code reads the new columns. After merge: T15 (Preview, edit and regenerate).
  Bot is deployed (2026-10-27): D1 `handmake-bot`, Worker `handmake-bot.shemchukaga.workers.dev`, webhook set,
  `database_id` in `wrangler.toml` (PR #20). Worker secrets set: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_ALLOWED_USER_IDS`. Redeploy with `pnpm run deploy` (not `pnpm deploy`, which is a pnpm built-in).
  Not yet in the Worker: `ANTHROPIC_API_KEY` (T15), `GITHUB_DISPATCH_TOKEN` (T16); Volodymyr adds them with `wrangler secret put`.
  T11 acceptance run done 2026-10-27 (runs 40476184863, 40476250639; test channel, `live` off): first run posted UA album + DE reply (Telegram ids 10, 11) and committed post + ledger; second run skipped ("channel telegram: already done"), no duplicate. Record in T17.
- **Blocked on:** nothing (all GitHub secrets incl. `AUTHOR_CHAT_ID` are set).
- **Open questions for Volodymyr:** spec Q2 Impressum address (phase 2). Bot UI language: author-facing
  strings Ukrainian, refusal German (`apps/bot/src/texts.ts`).

## Reminders
- If `main` ever gets branch protection or a ruleset, allow `github-actions[bot]` to push (content/ only), otherwise publish cannot commit. Checked at the T11 merge (2026-10-24): `main` is not protected.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
- T10: run `processPhoto` on every MediaSource result before `savePost` (the store writes bytes as given; PR #11 note 1). `MediaSource` returns raw bytes; the publish pipeline calls `processPhoto` once for every source (PR #9 review note 1).
- T13: accept Telegram photos; reply clearly for unsupported files such as HEIC documents (PR #9 review note 3).
- Ledger: guard `markOpDelivered` on a `done` channel; restore an immutability assertion (PR #8 re-review).
- T17 runbook: 5xx and network errors are not retried in-process, the ledger re-run covers them (PR #10 review note 4). Document the small at-least-once window between a send and the ledger write (PR #8 review note 3).
- Ledger path `content/ledger/<postId>.json` has no tenant; revisit with a second tenant (PR #11 note 2). Folder date is UTC; align with scheduled publishing (note 3).
- F19 (work of the week): add "list published" to `ContentStore` when candidates are built (PR #6 review note 3).
- gitleaks-action needs `GITLEAKS_LICENSE` if the repo moves to an organization.
- gitleaks-action on `pull_request` needs `fetch-depth: 0` on checkout (fixed in PR #2).

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00 done; T01 merged (PR #1); T02 merged (PR #2); T03 merged (PR #4); T04 merged (PR #5); T04b merged (PR #6); T05 merged (PR #7); T06 merged (PR #8); T08 merged (PR #9); T07 merged (PR #10); T09 merged (PR #11); T10 merged (PR #12); T12 merged (PR #13); T11 merged (PR #14); T13 merged (PR #19).
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
