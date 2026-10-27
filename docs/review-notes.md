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
- Bot: after a successful dispatch the draft stays `publishing` until the publish callback (architecture 4.3) exists, which is post-MVP (PR #24). Consequences: `/discard` answers "busy" for that draft forever, and after the 5-minute stale window 🚀 can re-dispatch it. The ledger dedupes the re-dispatch, so it is harmless; T17 should note it in the runbook. Until the callback exists, a delivered post is only visible via the publisher's author notification and `content/posts/`.

## Content store
- F19 (work of the week): add "list published" to `ContentStore` when candidates are built (PR #6 review note 3).

## CI
- gitleaks-action needs `GITLEAKS_LICENSE` if the repo moves to an organization.
