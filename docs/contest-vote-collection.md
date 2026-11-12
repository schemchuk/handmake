# Contest vote collection (T31c)

The closing service remains unwired until T31d. The caller supplies the enabled
comment-capable channels and their tenant-specific contexts. It reads only successful
deliveries of the same published ballot post, never the comment inbox or recent posts.
Missing, failed or skipped deliveries are recorded as `skipped`, without API calls.

Only trimmed ASCII decimal strings `1` through `N` are votes (including `10` when
there are ten candidates). For each network, the earliest valid comment per account
wins; ties use the comment ID in ascending code-unit order. Invalid comments do not
consume a vote. Missing timestamps sort after known timestamps, then by comment ID.
Repeated identical comment IDs count once; conflicting versions make collection
unreadable. Accounts are scoped to their network, with no cross-network matching.
Instagram and Threads use the network username; Facebook uses `from.id`, never its
non-unique display name. A valid vote without an account identity makes the source
unreadable. Usernames are case-normalized. This is a collection-time snapshot;
renames, deleted comments and subsequent edits cannot be reconstructed.

The existing reader follows all bounded pages or throws. API errors, incomplete
pagination and missing capabilities on a published source are unreadable. No partial
source counts become a final reader result. Anonymous per-source completeness and
counts are stored in the closing tally JSON, along with the combined tally. Any
unreadable source makes the combined result unreadable, even if other sources have
valid counts. The existing immutable tenant/week claim protects the published order
and prevents collecting again after completion. Interruption uses T31b recovery.
Only aggregate counts leave memory: no comment IDs, account IDs, handles, text or
API diagnostics enter closing persistence, logs, drafts or Git. This service performs
no comment writes. Telegram stop requests have a 30-second transport deadline,
well below the five-minute claim lease. The closing service bounds the entire stop and
collection sequence to two minutes. Timeout persists only an unreadable tally; late
completion cannot overwrite it or start another source. In-flight reads may finish in
memory. An unreadable Telegram tally skips all Meta reads. Contest reads omit Instagram
owner comments by account ID; ordinary comment inbox reads retain them. Generated UA/DE
ballots request plain numeric comments without emoji.

## Result persistence (T31d2)

`createPollResultStore` reads the immutable closing tally and candidate order. A positive,
unique Telegram-only leader is automatic and uses reader wording. A positive tie restricts
choices to tied leaders. Zero/unreadable results allow every original candidate. If any
non-Telegram source was counted (even zero votes), the author must choose from all candidates;
`decision()` exposes the anonymous combined and per-source totals to the future UI.
Skipped sources do not turn a Telegram result into a combined result.

`create()` requires the closing claim and an allowed entry ID, or uses the automatic leader.
Author authentication belongs to the T31d3 caller; this persistence service has no live caller.
Withdrawn entries remain in the original ballot. Only the chosen photo reference and
`{entry:ULID}` placeholders enter the ready bilingual draft; display names are never read.
The draft ID derives from tenant/week, independently of callback time or chosen candidate.

Local/test migration `0017_poll_results.sql` adds the winner flag and durable tenant/week
result receipt. A single D1 batch inserts the draft with the existing insertion helper, marks
the winner, and records the receipt. Every write is guarded by receipt absence. Concurrent
choices return the first result; failures roll back all three writes. Draft cleanup cannot
remove the receipt or recreate a result. The receipt references the chosen entry, so future
T32 retention must preserve that entry or explicitly handle the receipt before deletion.
Production migration and deployment require Volodymyr's approval under AGENTS.md.

Before T31d goes live, the PR #117 Instagram owner-identity check remains required: compare a
real owner comment's `from.id` with the IG User ID; if different, match `from.username` against
the account username fetched once per contest read. T31d2 performs no external comment reads
and does not resolve that rollout check.
