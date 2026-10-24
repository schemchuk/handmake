# STATUS

- **Active agent:** kimi-code
- **Current task:** T11 — Publish workflow and alerts (owner kimi-code, reviewer claude-code)
- **Branch:** main (feat/T11-publish-workflow to be created)
- **Last commit:** 9f4814a T12: AI translation and humanizer prompt (#13)
- **Next step:** Kimi implements T11. Blocked on Volodymyr for secrets (H5: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, OPERATOR_CHAT_ID and what the operator/author alerts need) — workflow work can start before secrets exist. PR will be sensitive (`.github/workflows/`), so Volodymyr's explicit OK is needed before merge.
- **Blocked on:** Volodymyr — H5 secrets for the live workflow run (implementation itself can proceed)
- **Open questions for Volodymyr:** spec Q2 Impressum address (phase 2)

## Reminders
- At T11 review: if `main` gets branch protection, allow `github-actions[bot]` to push (content/ only). Currently not protected.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
- T10: run `processPhoto` on every MediaSource result before `savePost` (the store writes bytes as given; PR #11 note 1). `MediaSource` returns raw bytes; the publish pipeline calls `processPhoto` once for every source (PR #9 review note 1).
- T13: accept Telegram photos; reply clearly for unsupported files such as HEIC documents (PR #9 review note 3).
- Ledger: guard `markOpDelivered` on a `done` channel; restore an immutability assertion (PR #8 re-review).
- T11: the publish workflow must commit and push `content/` also on failure (`if: always()`) so a failed run's ledger reaches `main` (PR #12 review).
- T17 runbook: 5xx and network errors are not retried in-process, the ledger re-run covers them (PR #10 review note 4). Document the small at-least-once window between a send and the ledger write (PR #8 review note 3).
- Ledger path `content/ledger/<postId>.json` has no tenant; revisit with a second tenant (PR #11 note 2). Folder date is UTC; align with scheduled publishing (note 3).
- F19 (work of the week): add "list published" to `ContentStore` when candidates are built (PR #6 review note 3).
- Before T11: pin GitHub Actions to commit SHAs (+ Dependabot for actions). gitleaks-action needs `GITLEAKS_LICENSE` if the repo moves to an organization.
- gitleaks-action on `pull_request` needs `fetch-depth: 0` on checkout (fixed in PR #2).

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00 done; T01 merged (PR #1); T02 merged (PR #2); T03 merged (PR #4); T04 merged (PR #5); T04b merged (PR #6); T05 merged (PR #7); T06 merged (PR #8); T08 merged (PR #9); T07 merged (PR #10); T09 merged (PR #11); T10 merged (PR #12); T12 merged (PR #13).
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
