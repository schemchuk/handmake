# STATUS

- **Active agent:** kimi-code
- **Current task:** T19 — Publisher sends the published callback (PR open, awaiting claude-code review)
- **Branch:** feat/T19-publisher-callback
- **Last commit:** see `git log -1`
- **Next step:** claude-code reviews T19. T19 touches `.github/workflows/`, so its merge needs
  Volodymyr's OK. Needs in GitHub: repo variable `PUBLISH_CALLBACK_URL` = Worker URL
  (PUBLISH_CALLBACK_SECRET is already set, H7). Review note carried out: the callback fires only
  when every ledger channel is `done` (a failed channel throws before it); stated in the PR.
- **Blocked on:** nothing.
- **Open questions for Volodymyr:** spec Q2 Impressum address (phase 2). Bot UI language: author-facing
  strings Ukrainian, refusal German (`apps/bot/src/texts.ts`). Set the `PUBLISH_CALLBACK_URL` repo
  variable when merging T19.

## Reminders
- If `main` ever gets branch protection or a ruleset, allow `github-actions[bot]` to push (content/ only), otherwise publish cannot commit. Checked at the T11 merge (2026-10-24): `main` is not protected.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
Moved to docs/review-notes.md (ADR 009). Read it only when your task touches an area it names.

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00-T18 done (MVP live 2026-10-27; T18 merged as PR #28). History: `git log --merges` / GitHub PRs.
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
- Agent context budget, no code graph: ADR 009 (2026-10-27).
