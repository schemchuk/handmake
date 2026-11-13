# Usage metrics

`/stats` is available in private chats to the existing tenant allow-list (the
operator list, as for `/cost`). It reports that tenant only. Apply migration
`0022_usage_metrics.sql` before deploying the bot; reviewer deployment requires
Volodymyr's migration approval under AGENTS.md.

The rolling window is `[now - 28 elapsed UTC days, now)`. Each draft ID counts
once across all content kinds. Publication requires every channel reported by
the authenticated callback to be done; its time is the latest first successful
callback observation among those channels. The callback cannot describe channels
it omits, and a run without an accepted callback is unobserved. A site-only
callback with no channels counts as a publication without a channel delivery. Production and test-channel
runs are both included: the callback does not identify the publishing mode.

Delivery success is successful unique draft/channel pairs divided by all pairs
whose latest outcome transition was observed in the window. Retries update a
failed pair to done; duplicate callbacks do not count again and late failures
cannot undo success. This is an eventual delivery rate, not an attempt rate.

The median uses elapsed minutes from draft creation to publication. Edits per
published draft include applied UA/DE replacements that change text, plus
ready-to-translating regeneration claims (including failed regeneration calls).
Initial translation, stale lease recovery and preview clicks do not count.
`first_ready_at` is captured once, in the same transaction as the draft change.

The separate usage tables retain only tenant/draft IDs, timestamps, counters,
channel keys and outcomes, surviving draft deletion. No text, photos, names,
chat IDs or user IDs are copied. Existing history is not backfilled: old edits
and ready times cannot be reconstructed reliably. Workflow averages include only
drafts created and observed ready after migration; the report gives their sample size.
No audience tracking, external analytics or participant records are added.
