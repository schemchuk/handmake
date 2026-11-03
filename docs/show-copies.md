# Published show copies (T46b)

The publisher has a separate command for an already published show:

```sh
pnpm --filter @handmake/publisher exec tsx src/cli.ts copy-show <tenantId> <showId> --root <checkout>
```

This command sends real channel messages. Run it only in the authorized publishing environment;
T46c will add CI invocation after a successful site deployment. No live smoke run was performed
for T46b. Existing deployment gates in `show-deployment.md` still apply.

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
has no native idempotency key. CI serialization and pushing failed progress are wired in T46c.
