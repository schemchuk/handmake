# Review notes carried forward

Open findings from past reviews that a later task must handle. Read only the entries for the area your
task touches (ADR 009). Delete an entry in the PR that resolves it.

## Publisher and ledger
- T10: run `processPhoto` on every MediaSource result before `savePost` (the store writes bytes as given; PR #11 note 1). `MediaSource` returns raw bytes; the publish pipeline calls `processPhoto` once for every source (PR #9 review note 1).
- Ledger: guard `markOpDelivered` on a `done` channel; restore an immutability assertion (PR #8 re-review).
- Ledger path `content/ledger/<postId>.json` has no tenant; revisit with a second tenant (PR #11 note 2). Folder date is UTC; align with scheduled publishing (note 3).

## Runbook (T17)
- 5xx and network errors are not retried in-process, the ledger re-run covers them (PR #10 review note 4). Document the small at-least-once window between a send and the ledger write (PR #8 review note 3).
- Bot: a DB write that succeeded with a failed reply lets a Telegram retry re-append text (at-least-once window, PR #22).

## Content store
- F19 (work of the week): `ContentStore.listPosts` now exists (T35, ADR 016); use it when candidates are built (PR #6 review note 3).
- Site: a post with no German text is not shown on `/` (no language fallback); a work without a translation needs the same decision (T35 review).
- Site: photos are published unresized; add an optimization step before the show pipeline (T35 review).

## CI
- gitleaks-action needs `GITLEAKS_LICENSE` if the repo moves to an organization.

## Bot drafts (T25)
- Drafts created before migration 0006 have no `chat_sessions` row: `/done` and legacy buttons on such a draft answer "no draft" until the author sends new text or photos (which re-attaches the collecting draft). Production had no collecting or ready drafts at merge time (2026-10-30), so this only matters for a restored backup (PR #32 review).
- Two drafts from 2026-10-27 (before the T19 published callback) are stuck in `publishing` although their posts and ledgers exist. Harmless; delete them by hand or let a cleanup that covers `publishing` remove them.

## Polls (T21)
- The poll message id sits at op index 1 or 2 (depends on caption overflow). T22 and the closing cron must find it by op kind (`kind === 'poll'`), not by a fixed index (PR #31 N1).
- Bot API now allows 1-12 options and media on a poll option (`InputPollOption.media`), which weakens ADR 008's "polls cannot carry images". MVP keeps album + poll; revisit in a later ADR (PR #31 N2).

## AI cost ledger (T42, PR #34)
- `assertCanStartShow` and `costLimitText` are not invoked by a production flow until T44 adds the show entry point and budget gate.
- All existing allow-listed users are operators (Volodymyr, 2026-10-31); no separate operator role.
- Notices claim before sending: a crash between claim and delivery can lose a notification; consider expiring claims in a later task.
- Translation model and configured prices are not validated against each other.
- When SDK `messages.parse` throws, paid usage is not recorded because no parsed response reaches the usage hook.
- Any tenant-config refresh failure uses the last-known config without notifying the operator; cold failures fall back to the default translator without accounting. Diagnostic warnings are logged.
- `aiRuntime()` is constructed three times along the scheduled path; consolidate in a later task.
- Prompt-cache read/write tokens are not accounted for; EUR prices are entered manually and need verification in T43.
