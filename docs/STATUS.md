# STATUS

- **Active agent:** claude-code (reviewer)
- **Current task:** T13 — Bot Worker skeleton (`apps/bot`, docs/03-tasks.md v2); PR open
- **Branch:** feat/T13-bot-worker-skeleton
- **Last commit:** (this commit) feat(bot): T13 bot worker skeleton
- **Next step:** claude-code reviews the T13 PR. After merge: deploy is manual —
  create D1 (`pnpm --filter @handmake/bot exec wrangler d1 create handmake-bot`,
  paste `database_id` into `apps/bot/wrangler.toml`), `pnpm --filter @handmake/bot db:migrate`,
  set Worker secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_ALLOWED_USER_IDS`), `pnpm --filter @handmake/bot deploy`, then `webhook:set`.
- **Blocked on:** nothing for the review. Live deploy blocked on Volodymyr's Cloudflare
  steps above (needs his `wrangler login`; done as H2).
- **Open questions for Volodymyr:** spec Q2 Impressum address (phase 2). T13: bot UI
  language — author-facing strings are Ukrainian, the allow-list refusal is German
  (both in `apps/bot/src/texts.ts`, one place, easy to change).

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
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00 done; T01 merged (PR #1); T02 merged (PR #2); T03 merged (PR #4); T04 merged (PR #5); T04b merged (PR #6); T05 merged (PR #7); T06 merged (PR #8); T08 merged (PR #9); T07 merged (PR #10); T09 merged (PR #11); T10 merged (PR #12); T12 merged (PR #13).
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
