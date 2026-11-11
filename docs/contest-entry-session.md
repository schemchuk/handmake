# Author contest-entry session

`/entry` starts a fresh, tenant/chat-scoped session. Send one photo, then a first name or
nickname (1–30 Unicode code points), or choose the anonymous button. Photo captions are ignored.
The author must press the consent button before the entry becomes available to `AuthorEntrySource`.
The consent wording is subject to Volodymyr's approval before the sensitive PR is merged.

Input lives only in D1 `contest_sessions`, separate from post/work/show drafts and submitted
`contest_entries`. No participant Telegram identity is collected. The chat ID belongs to the
allow-listed author. Names are not echoed, logged, translated, sent to Git or dispatched.
The network-independent `photoRef` maps to Telegram's `file_id` in this D1 adapter.

Each edit replaces a random callback revision. Consent uses an atomic `INSERT SELECT` guarded
by tenant, author chat, revision, photo, name choice and expiration. Duplicate entry IDs cannot
be inserted twice. Concurrent edits, cancellation and confirmation are ordered by SQLite: if
confirmation wins, it stores the previously confirmed version; if the edit/cancellation wins,
the old confirmation is refused. A new `/entry` also invalidates previous buttons.

`/discard` or `/cancel` deletes unconfirmed input. Other commands and other flow buttons cancel
it and reset entry routing to the default post session before continuing to the selected handler,
even when only a routing marker remains after completion or expiration. This lets post-preview
and comment edit buttons receive the next text. Existing post/work/show drafts are preserved.
After completion or expiration, plain messages remain in entry mode until an explicit command or
foreign flow button; they never implicitly create a post. `/discard` and `/cancel` also reset routing.

Unconfirmed input expires 24 hours after `/entry`, without renewal by edits. Expired input is
ineligible for submission immediately and is physically deleted at the next entry-related update or daily
cleanup cron. Update-triggered cleanup runs only for entry-related updates; other flows do not
issue cleanup writes. Successfully submitted sessions are deleted; the existing entry record remains.
The session routing marker contains no name or photo. Submitted-name retention remains ADR 010;
this task does not implement the future results/withdrawal cleanup workflow.

Migration `0013_contest_sessions.sql` is required before deploying this version. The reviewer
must request Volodymyr's approval before any remote migration or deployment. Participants' works
and names are excluded from website publication (the current scope supersedes ADR 010's older
website showcase wording). No production migration or deployment is part of implementation.
