# Published show copies (T46b–T46c)

The publisher has a separate command for an already published show:

```sh
pnpm --filter @handmake/publisher exec tsx src/cli.ts copy-show <tenantId> <showId> --root <checkout>
```

This command sends real channel messages. Run it only in the authorized publishing environment;
CI invokes it after a successful site deployment. No live smoke run was performed
for T46b or T46c. Existing deployment gates in `show-deployment.md` still apply.

The command reads the tenant-scoped show and marked PNG/MP4 bytes through the content store. It
checks markers and media availability before sending. It never downloads draft references,
regenerates media, changes the show or sends a draft publication callback.

Before sending, it commits `showCopyPlan` in `content/ledger/<showId>.json`: version 1, ordered
media SHA-256 hashes, per-channel operations and channel settings containing secret names only.
Retries reuse this snapshot, including language order, canonical URLs and target secret names.
Changing configuration does not change existing operations; changing the value of a target secret
can still redirect delivery, so keep that binding stable until the copy completes.

Each acknowledged operation is written atomically and committed before the next operation. A
failed copy preserves its delivered prefix, alerts the operator and leaves site publication
complete. A retry skips completed channels and resolves video/message replies using saved IDs.
The site-only publication callback always reports an empty channel map, even after copies exist.

Recovery: retain and push the ledger even when copying fails, then rerun the same identity from
the latest checkout. Do not delete or edit the plan/progress to retry. A local interrupted commit
is completed before any further sends. As with ordinary delivery, a process loss between remote
acceptance and the first durable progress write can require manual reconciliation; the channel
has no native idempotency key. CI serializes delivery and pushes failed progress (T46c).

## CI ordering and recovery (T46c)

`publish.yml` runs show publication and pushes content first, then calls `site.yml` to build and
successfully deploy `main`, then runs `copy-show`. The copy job has both preceding jobs as
success dependencies. A failed build, deploy or content push blocks copies. A failed copy job
leaves the site deployed and the publication callback complete. Ordinary posts and works keep
using their existing publication/channel delivery followed by site deployment; they skip the
show copy job. Manual show dispatches must use `main`, matching the site checkout.

Only the validated tenant ID and show ID pass between jobs, alongside a show-routing flag. The
copy job checks out current `main`, verifies stored marked media and uses the same live/test
selection expression as publication. The workflow-wide `publish` concurrency group serializes
publication and copies, including reruns; do not run an independent copy process concurrently.
A configured channel lacking show rendering fails the complete initial copy plan before any
send. It is never silently omitted. A retry with an existing plan reuses its rendered operations.

The copy progress push runs even after a copy failure and retries rebase/push three times. When
that push succeeded, use GitHub Actions **Re-run failed jobs** on the original run, preserving its
original live/test routing and target secret values. The copy job reads the newest persisted
ledger, skips acknowledged operations and does not need draft media. Use the failed-copy-job
retry rather than **Re-run all jobs**: the publication job retains its existing event checkout
behavior and may start from a commit preceding the saved show.
Never change a test run to live for a retry of the same show: the ledger records operations,
not independent live/test deliveries.

If the progress push itself failed, or cancellation/process loss left uncertain remote
acceptance, stop automatic retries. Compare the channel messages, persisted ledger and available
runner evidence; reconcile missing acknowledgements with the operator before retrying. Do not
blindly rerun from a stale ledger. Existing remote acceptance/durable-write limitations still
apply. Operator alerts link to the failed run; inspect whether copying or pushing failed.

## Separately authorized test-channel smoke run

No production/test-channel dispatch, site deployment or paid generation was performed for T46c.
After independent review, explicit sensitive-merge approval and the applicable deployment gates,
a separately authorized smoke run can use an approved fixture show on `main`, with `live=false`
and the private test channel binding. Confirm the site deploy completes before any album/video
copy, compare canonical links and marked media, inspect committed operation IDs, and rerun the
failed copy job after a controlled test-only delivery failure. Confirm the delivered album is
skipped and only pending operations are sent. Record the run URL, show ID, site deployment and
ledger commits as evidence. Keep production target bindings and paid generation disabled.
Local tests cover workflow routing/guards and a real local Git remote with publication,
copy failure, the workflow progress-push shell, a fresh checkout and resumed copies; HTTP is
mocked and this is not evidence of Telegram playback or a deployed GitHub Actions run.
