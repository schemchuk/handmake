# Name reconciliation

T32c2 uses receipts in D1, never drafts or current rendering configuration. Each
publication has one durable owner token. A withdrawal increments its generation,
resets operation progress, and preserves the owner. That owner checks the generation
before each edit and commits progress conditionally; a concurrent withdrawal causes
another pass with current D1 names. Captions target the first recorded album message;
media are never uploaded again. Name-bearing polls remain explicitly blocked.

After other scheduled work (including cleanup), each tick processes up to ten pending/failed Telegram
publications when `PUBLISH_LIVE=true`, independently of `wotwPoll` and tenant config
availability. Successful operations persist their index. Explicit API rejections
retry on later ticks and appear as `edit_rejected` to the author. Jobs are ordered by
ascending durable attempt count, then tenant/publication, so ten permanent failures
cannot monopolize every tick. Claims increment attempts atomically. Raw errors, names
and credentials are never persisted. Running recovery after the notification/closing
crons prevents its inline rate-limit waits from delaying those crons; interrupted
recovery still requires the quiescence procedure below.

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
button supplies this assertion. `/entries` exposes these unresolved states separately
from private deletion, pending work, explicit rejection, hook failures and confirmed
completion. Listings show at most ten recent tenant entries in private author chats;
status counts are grouped to bound message length. Withdrawal and status buttons
resolve the tenant through the allow-list and verify its digest in callback data;
no callback can select another tenant. Repeated
withdrawal preserves progress, work, consent, numbering and winner state. Missing
legacy receipts remain an explicit warning even when known receipts are complete.

## Site hook and rollout

The injectable, idempotent rebuild hook runs after supported edits and before
completion. Its failure leaves progress intact and retries independently on cron;
a concurrent withdrawal invalidates completion. The default is a no-op: inspection
of `site-data.ts`, `portfolio.ts`, and `shows.ts` confirms that blog posts are `free`
only, and works/collections/shows read Git content without contest-entry D1 names.
Authored portfolio descriptions are independent content and are not rewritten by
withdrawals. Revisit this hook before exposing contest-name projections on the site.
No workflow, dispatch or production rebuild is added.

Apply migrations through `0021_name_reconciliation_attempts.sql` before deploying. Remote
migration and deployment require Volodymyr's approval under the project handoff
rules. T32c3 wires the author commands to the existing withdrawal boundary.


## Operator runbook: quiescent recovery

Only Volodymyr may authorize production writes. These instructions are preparation,
not authorization to execute a remote migration, SQL update or deployment. Run from
`apps/bot`, with the deployment's existing Wrangler authentication. Do not export
names, receipt bodies, credentials or participant media. The owner token is an
internal concurrency identifier, not an API credential.

1. Inspect only the affected job (replace the example tenant/publication):

   ```sh
   pnpm exec wrangler d1 execute DB --remote --command "SELECT tenant_id, post_id, channel, state, error_code, generation, next_operation, lock_token, attempts FROM name_reconciliations WHERE tenant_id = 'example' AND post_id = 'POST_ID' AND channel = 'telegram'"
   ```

2. Establish and record evidence that the owning Worker invocation **and** its
   remote request can no longer write. Merely waiting, aborting a local request,
   or observing `remote_unknown` is insufficient. If remote quiescence cannot be
   proven, leave the lock untouched and inspect/clean public messages manually.
   Do not stop unrelated author submissions or delete entry/receipt records.

3. After approval and proven quiescence, create `/tmp/name-recovery.sql`, replacing
   all three example identifiers with the exact inspected values. SQL-escape any
   single quotes by doubling them. This is the SQL equivalent of
   `recoverQuiescent(target, token, 'remote-writer-stopped')`:

   ```sql
   UPDATE name_reconciliations
   SET lock_token = NULL, state = 'pending', next_operation = 0, error_code = NULL
   WHERE tenant_id = 'example' AND post_id = 'POST_ID' AND channel = 'telegram'
     AND lock_token = 'EXACT_INSPECTED_TOKEN' AND state IN ('running', 'blocked');
   SELECT changes() AS recovered;
   ```

   ```sh
   pnpm exec wrangler d1 execute DB --remote --file /tmp/name-recovery.sql
   ```

4. Require `recovered = 1`; zero means stale identity/state, so inspect again rather
   than broadening the predicate. Keep generation, completed generation and attempt
   count unchanged. The next live cron replays from operation zero using current
   D1 names. Read the job again and use the author's **Перевірити стан** button;
   require `done` with matching generation/completed generation and no missing
   receipt warning before claiming full public reconciliation. A new unknown
   outcome requires new evidence and approval; never automate lock takeover.
