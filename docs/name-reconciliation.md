# Name reconciliation

T32c2 uses receipts in D1, never drafts or current rendering configuration. Each
publication has one durable owner token. A withdrawal increments its generation,
resets operation progress, and preserves the owner. That owner checks the generation
before each edit and commits progress conditionally; a concurrent withdrawal causes
another pass with current D1 names. Captions target the first recorded album message;
media are never uploaded again. Name-bearing polls remain explicitly blocked.

Every scheduled tick, including cleanup, processes up to ten pending/failed Telegram
publications when `PUBLISH_LIVE=true`, independently of `wotwPoll` and tenant config
availability. Successful operations persist their index. Explicit API rejections
retry on later ticks; raw errors, names and credentials are never persisted.

## Unknown outcomes and interrupted workers

Telegram has no fencing-token or conditional-edit API. Expiring a local lease cannot
stop a delayed old request from restoring a name after a newer edit. Therefore locks
never expire automatically. Before a remote call, `remote_inflight` is persisted;
a transport/ambiguous response becomes `blocked / remote_unknown` with the token
retained. A terminated invocation may instead leave `running / remote_inflight`.
Neither is public-removal success, and neither is stolen by cron. Subsequent
withdrawals still delete D1 names immediately while preserving this uncertainty.

Operator recovery is the internal `recoverQuiescent(target, token,
'remote-writer-stopped')` boundary. Establish that the old invocation and its remote
request can no longer write before invoking it. Elapsed local lease time or a fetch
abort alone is insufficient evidence. If this cannot be established, leave the job
unresolved and inspect/clean the public messages manually. The boundary checks the
exact tenant/publication/channel/token, resets progress to zero, and queues a full
reconciliation before any generation can complete. No public endpoint or author
button supplies this assertion. T32c3 must surface these unresolved states.

## Site hook and rollout

The injectable, idempotent rebuild hook runs after supported edits and before
completion. Its failure leaves progress intact and retries independently on cron;
a concurrent withdrawal invalidates completion. The default is a no-op: inspection
of `site-data.ts`, `portfolio.ts`, and `shows.ts` confirms that blog posts are `free`
only, and works/collections/shows read Git content without contest-entry D1 names.
Authored portfolio descriptions are independent content and are not rewritten by
withdrawals. Revisit this hook before exposing contest-name projections on the site.
No workflow, dispatch or production rebuild is added.

Apply migration `0020_name_reconciliation_locks.sql` before deploying. Remote
migration and deployment require Volodymyr's approval under the project handoff
rules. This task adds no author command; T32c3 wires the existing withdrawal boundary.
