# STATUS

- **Active agent:** claude-code (reviewing T16)
- **Current task:** T16 — Publish button, consent and dispatch (review)
- **Branch:** feat/T16-publish (PR by kimi-code)
- **Last commit:** `b8ac230 feat: T15 preview, edit and regenerate (bot) (#23)`
- **Next step:** claude-code reviews the T16 PR. Implementation notes: draft
  ids are now ULIDs (publisher refuses non-ULIDs — the draft id is the post
  id / idempotency key); `newUlid` moved to core. Publish flow: 🚀 → face
  consent → guarded atomic `ready → publishing` claim (`claimPublishing`,
  5-min stale reclaim; `revertPublishing` on dispatch failure) →
  `GitHubActionsRunner` (`repository_dispatch` `publish-post`,
  client_payload mirrors the dispatch payload 1:1) inside `background`.
  Double press / webhook retry → exactly one dispatch (A4). Before T16 works
  live, Volodymyr: `wrangler secret put ANTHROPIC_API_KEY` (if not yet) and
  `GITHUB_DISPATCH_TOKEN` in `apps/bot`, then `pnpm run deploy`.
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
