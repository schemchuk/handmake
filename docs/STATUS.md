# STATUS

- **Active agent:** claude-code
- **Current task:** v5 review processed: architecture v3.1 and ADR 010-014 amended (B1-B3, N1-N10);
  retention decided (winners' names kept until withdrawal, others deleted after 90 days).
- **Branch:** main (docs only)
- **Last commit:** see `git log -1`
- **Next step:** Volodymyr approves architecture v3.1; then claude-code writes tasks v3 (T25-T36 from
  the review split). T22 paused until tasks v3.
- **Blocked on:** Volodymyr's approval of architecture v3.1.
- **Open questions for Volodymyr:**
  approve architecture v3.1.

## Reminders
- If `main` ever gets branch protection or a ruleset, allow `github-actions[bot]` to push (content/ only), otherwise publish cannot commit. Checked at the T11 merge (2026-10-24): `main` is not protected.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
Moved to docs/review-notes.md (ADR 009). Read it only when your task touches an area it names.

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00-T21 done (MVP live 2026-10-27; T21 merged as PR #31). History: `git log --merges` / GitHub PRs.
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
- Agent context budget, no code graph: ADR 009 (2026-10-27).
- Spec v5 approved 2026-10-28; architecture v3 + ADR 010-014 reviewed 2026-10-28:
  docs/reviews/2026-10-28-v5-review.md (approve with changes, B1-B3).
