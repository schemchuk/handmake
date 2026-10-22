# STATUS

- **Active agent:** claude-code
- **Current task:** T02 — CI workflow — review fix applied, awaiting re-review
- **Branch:** feat/T02-ci
- **Last commit:** b6a8c40 chore: ignore only .claude/settings.local.json, keep shared settings
- **Next step:** Claude Code re-reviews PR #2 (fix applied, CI green). Merge needs Volodymyr's OK (touches `.github/workflows/`).
- **Blocked on:** —
- **Open questions for Volodymyr:** spec Q2 Impressum address (phase 2)

## Reminders
- At T11 review: if `main` gets branch protection, allow `github-actions[bot]` to push (content/ only). Currently not protected.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
- T03+: packages export `./dist/index.js`; with the first cross-package import, make `pnpm typecheck` work without a prior build (project references or source export).
- gitleaks-action on `pull_request` needs `fetch-depth: 0` on checkout (fixed in PR #2).

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00 done; T01 merged (PR #1); T02 done, pending review (PR #2); T04b added (ports).
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
