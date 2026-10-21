# 003 — Publishing runs in GitHub Actions; Git is the source of truth

Status: accepted · Date: 2026-10-21

## Context
Publishing must be idempotent, auditable and retryable (F11, F15). Published posts must land in the
public repo to feed the website. Instagram needs a public image URL.

## Options
1. **Worker publishes directly** and commits via the GitHub API: fastest, but heavy work (photo
   download and re-encode, multi-file commit) in a CPU-limited Worker; retries and logs are ad hoc.
2. **Worker sends `repository_dispatch`; a GitHub Actions workflow builds the content folder, commits it,
   delivers to channels and writes a ledger.** Slower (about 30-60 s), but every publish has a visible
   log, a re-run button, and full Node for image processing.
3. Separate queue service: overkill at ~10 posts per month.

## Decision
Option 2. `publish.yml` with `concurrency: publish`. Order: content commit → adapters → ledger commit.
Adapters skip channels already `done` in the ledger, so a re-run never duplicates.
Instagram (phase 1b) uses the committed photo's public URL in the repo.

## Consequences
- The author waits about a minute for "published"; the bot shows "publishing…" meanwhile.
- The workflow commits to `main` under `content/` only, as allowed by the exception in AGENTS.md
  (Git rules, approved 2026-10-21). If branch protection is enabled on `main`, Volodymyr allows the
  workflow's bot identity to push, and CI checks that the workflow's commits touch only `content/`.
- Publishing works without the Worker too (manual `workflow_dispatch` with a draft payload), useful for tests.
