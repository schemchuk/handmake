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
well below the five-minute claim lease.
