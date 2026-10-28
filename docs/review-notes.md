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
- F19 (work of the week): add "list published" to `ContentStore` when candidates are built (PR #6 review note 3).

## CI
- gitleaks-action needs `GITLEAKS_LICENSE` if the repo moves to an organization.

## Bot drafts (T20)
- A cron announcement draft becomes the chat's latest draft (`latestForChat` orders by `created_at`). If the author is collecting a post at that moment, her collecting draft is hidden until she publishes or discards the announcement; after a publish, new text starts a fresh draft and the old collecting one is orphaned (deleted by the 30-day cleanup). Fix when it bites: skip or delay the cron draft while a `collecting` draft exists, or look up the collecting draft explicitly (PR #30 review).

## Polls (T21)
- The poll message id sits at op index 1 or 2 (depends on caption overflow). T22 and the closing cron must find it by op kind (`kind === 'poll'`), not by a fixed index (PR #31 N1).
- Bot API now allows 1-12 options and media on a poll option (`InputPollOption.media`), which weakens ADR 008's "polls cannot carry images". MVP keeps album + poll; revisit in a later ADR (PR #31 N2).
