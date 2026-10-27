# STATUS

- **Active agent:** claude-code
- **Current task:** T17 — End-to-end check and runbook (owner claude-code, reviewer Volodymyr)
- **Branch:** none yet (docs work goes to `main`, README via `docs/T17-runbook` if large)
- **Last commit:** `0ad40dc feat: T16 publish button, consent and dispatch (bot) (#24)`
- **Next step:** T16 merged 2026-10-27 after one review round (B1 fixed: `PUBLISH_LIVE` var, bot
  dispatches go to the TEST channel while it is "false"). Volodymyr deploys (`pnpm run deploy` in
  `apps/bot`; secrets `ANTHROPIC_API_KEY` and `GITHUB_DISPATCH_TOKEN` are set in the Worker), then
  claude-code runs the A1-A9 checklist with him on the test channel and writes README + runbook.
  Switch to live: set `PUBLISH_LIVE = "true"` in `apps/bot/wrangler.toml` and redeploy, only on
  Volodymyr's go. Runbook items: docs/review-notes.md "Runbook (T17)".
- **Blocked on:** nothing. Live E2E 2026-10-27: bot publish to test channel worked (run 40525514688)
  after fixes #25 (Worker load), #26 (GitHub User-Agent), #27 (language order). Bot switched to the
  LIVE channel (`PUBLISH_LIVE = "true"`) on Volodymyr's go; he redeploys.
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
- Tasks: docs/03-tasks.md v2 (approved 2026-10-21). T00-T16 done (each task merged by its PR; last: T16, PR #24). History: `git log --merges` / GitHub PRs.
- Merge rule (2026-10-22): the reviewer agent merges task PRs; sensitive PRs need Volodymyr's OK (AGENTS.md).
- Toolchain note (T01): TypeScript pinned to ^5.9 because typescript-eslint does not support TS 7 yet.
- Research: docs/research/001-market-scan.md, 002-contests.md
- Agent context budget, no code graph: ADR 009 (2026-10-27).
