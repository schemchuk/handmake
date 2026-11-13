# Contest vote collection (T31c)

The Worker scheduler wires closing through T31d3. The caller supplies the configured
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
`decision()` exposes the anonymous combined and per-source totals to the author UI.
Skipped sources do not turn a Telegram result into a combined result.

`create()` requires the closing claim and an allowed entry ID, or uses the automatic leader.
Author authentication belongs to the T31d3 callback middleware, after the bot allow-list gate.
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

Verified 2026-11-13: an owner comment on a real post returned `from.id` equal to the IG User ID
(and `from.username` equal to the account username), so the `from.id` comparison is sufficient
for Instagram.

Facebook, verified 2026-11-13 with a non-expiring Page token holding `pages_read_user_content`:
a reader comment on a Page post comes back without `from` (also when `from{id,name}` is
requested explicitly). Meta only exposes the commenter for apps with Advanced Access (App Review)
or for users with a role on the app. As designed, every Facebook tally is therefore unreadable,
and an unreadable source makes the combined contest result unreadable. T31d must not go live with
Facebook as a vote source until Volodymyr decides how to handle this.


## Scheduler and author decisions (T31d3)

Every regular scheduler tick evaluates the configured closing moment in the same
45-minute window as poll opening. The latest opening preceding that closing determines
the previous calendar entry week, including Berlin DST and year boundaries. The daily
cleanup-only cron remains separate. Disabled tenants perform no closing or result work.
Failed tenants and failed closing weeks cannot stop later cron steps or other tenants.

The scheduler supplies the Telegram adapter with the tenant's channel settings and the
configured Meta adapters with the existing comment secret resolver. Only the ballot's
successful deliveries are read; a configured delivered network with missing credentials
fails unreadable rather than silently disappearing from the tally. Before enabling the
flag, provision the publisher's existing `TELEGRAM_CHANNEL_ID` value as a Worker secret
and complete the Instagram owner-identity check above. The current Worker resolver supports
that secret name only; another channel secret name requires an explicit resolver mapping.
This task does not provision secrets, deploy, enable flags, or publish automatically.
Changes to secret handling require Volodymyr's explicit merge approval under AGENTS.md.

A unique Telegram leader creates the result immediately. Otherwise authors receive anonymous
aggregate candidate counts, per-source totals/status, and buttons restricted to the stored
decision's candidates. An unreadable aggregate never displays fabricated totals. Callback
data contains only week, immutable closing claim and original candidate index (under 64
bytes). The allow-list resolves tenant; the callback additionally requires the author's
own private chat, matching tenant config, enabled flag, matching closing claim and an
allowed candidate. No display name or commenter identity enters callback data.

Incomplete closings and tallied closings without result receipts retry outside the window.
Expired interrupted claims become unreadable without another remote stop. After a tally
is immutable, its lease is no longer used: `expires_at` then stores the negative timestamp
of the last prompt attempt. An atomic conditional update claims the prompt before sending,
so concurrent ticks send at most one prompt per tenant/closing every 24 hours. Failed sends
also consume that daily attempt. Reminders stop 21 days after the entry week's Monday
00:00 UTC; old decision buttons remain usable. No schema migration is needed, and lease
recovery only touches rows with no tally, so it never interprets a prompt marker as a lease.

Cron sends a result preview only when it creates the result, never on a later tick. A failed
preview leaves the durable receipt, draft and winner intact. Old decision buttons can resend
the existing winner's ready preview without changing it. Automatic preview failures require
explicit author recovery through the existing draft flow. Published/discarded/cleaned results
are not recreated. The lowest numeric author ID owns cron-created drafts, independent of
allow-list order; all configured authors receive the initial notification. Previews use the
existing name projection and tenant channel rendering/Publish controls. Only the author's
existing Publish confirmation dispatches delivery. Closing errors use the composition's
existing secret-redacting logger, with tenant and operation context.
