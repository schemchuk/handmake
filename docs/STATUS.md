# STATUS

- **Active agent:** kimi-code
- **Current task:** T16 — Publish button, consent and dispatch (`apps/bot`, docs/03-tasks.md v2)
- **Branch:** feat/T16-publish (to be created by kimi-code)
- **Last commit:** `b8ac230 feat: T15 preview, edit and regenerate (bot) (#23)`
- **Next step:** kimi-code implements T16. T15 merged 2026-10-27 after one review round (B1 fixed:
  translation runs in `waitUntil` via the `background` option, stale `translating` claims are
  reclaimable after 2 min, Anthropic timeout 60 s). Publish button is a stub in `bot.ts`
  (`draft:publish`); T16 replaces it. Use one guarded UPDATE `ready -> publishing` (same pattern as
  `claimTranslation`), dispatch inside `background` if it can exceed a few seconds, revert to `ready` on failure.
  Migration 0004 is applied to remote D1. Before T16 works live, Volodymyr: `wrangler secret put
  ANTHROPIC_API_KEY` and `GITHUB_DISPATCH_TOKEN` in `apps/bot`, then `pnpm run deploy`.
- **Blocked on:** nothing.
- **Open questions for Volodymyr:** spec Q2 Impressum address (phase 2). Bot UI language: author-facing
  strings Ukrainian, refusal German (`apps/bot/src/texts.ts`).

## Reminders
- If `main` ever gets branch protection or a ruleset, allow `github-actions[bot]` to push (content/ only), otherwise publish cannot commit. Checked at the T11 merge (2026-10-24): `main` is not protected.
- pnpm is not in /usr/bin on this machine; Kimi Code uses `~/.local/bin/pnpm` (12.14.0). Node is v22.23.2 (`.nvmrc` = 22).

## Review notes carried forward
Moved to docs/review-notes.md (ADR 009). Read it only when your task touches an area it names.

## Decisions so far
- Interview: docs/00-interview.md (rounds 0-4, confirmed).
- Spec: docs/01-spec.md v4 (approved 2026-10-21): product readiness N1-N9, poll-based work of the week.
- Architecture: docs/02-architecture.md v2 + ADR 001-008 (approved 2026-10-21).
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00-T15 done (each task merged by its PR; last: T15, PR #23). History: `git log --merges` / GitHub PRs.
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
- Agent context budget, no code graph: ADR 009 (2026-10-27).
