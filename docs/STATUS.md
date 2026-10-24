# STATUS

- **Active agent:** kimi-code
- **Current task:** T08 — Photo processing (`publisher`, docs/03-tasks.md v2) — in review, PR #9
- **Branch:** feat/T08-photo-processing
- **Last commit:** 022bbcc feat(publisher): photo processing via Telegram getFile (T08)
- **Next step:** claude-code reviews and merges PR #9 (T08), then updates this file. T07 (Telegram delivery) can follow; see review notes below.
- **Blocked on:** —
- **Open questions for Volodymyr:** spec Q2 Impressum address (phase 2)

## Reminders
- At T11 review: if `main` gets branch protection, allow `github-actions[bot]` to push (content/ only). Currently not protected.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
- Ledger: guard `markOpDelivered` on a `done` channel; restore an immutability assertion (PR #8 re-review).
- T07: `ChannelAdapter.deliver` must report each delivered op (e.g. `startAt`, `knownIds`, `onDelivered(opIndex, id)`) so T10 writes the ledger after every op (PR #8 review note 2).
- T17 runbook: document the small at-least-once window between a send and the ledger write (PR #8 review note 3).
- T07: render in the tenant's `languages` order (pass it via `settings`), not section order in the file (PR #7 review note 1).
- F19 (work of the week): add "list published" to `ContentStore` when candidates are built (PR #6 review note 3).
- Before T11: pin GitHub Actions to commit SHAs (+ Dependabot for actions). gitleaks-action needs `GITLEAKS_LICENSE` if the repo moves to an organization.
- gitleaks-action on `pull_request` needs `fetch-depth: 0` on checkout (fixed in PR #2).

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00 done; T01 merged (PR #1); T02 merged (PR #2); T03 merged (PR #4); T04 merged (PR #5); T04b merged (PR #6); T05 merged (PR #7); T06 merged (PR #8); T08 in review (PR #9).
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
