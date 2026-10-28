# 010 — Contest entries are uploaded by the author; names stay out of Git

Status: accepted (with architecture v3, amended by the v5 review) · Date: 2026-10-28 · Amends: ADR 008 (candidates)

## Context
Spec v5 (F19) changes the work-of-the-week candidates from the author's own posts to works of circle
participants. Participants never use the system (spec v5 section 9). A post may show the participant's
first name or nickname with her consent (Q13). This repo and its history are public; names written
into Git cannot be removed without rewriting history, which AGENTS.md forbids.

## Options
1. **Participants send entries to the bot themselves.** Stores Telegram IDs of participants (personal
   data), needs a participant-facing bot, rules and consent flow. Rejected in interview round 5.
2. **The author uploads entries via her bot (`entry` draft type), names kept in D1 only.** No new user
   group; the name is personal data but stored in one deletable place.
3. Same as 2, names written into the content files. Simple, but a withdrawn consent leaves the name in
   public Git history.

## Decision
Option 2, as amended by the v5 review (B2, N1, N2).
- Entries are rows in their own D1 table `contest_entries` (not a draft type): one photo (more are
  rejected), an optional display name (first name or nickname, max 30 chars, no validation beyond
  length), and a mandatory consent button "the participant agreed that her work is shown". Entries
  carry `tenantId`, the contest week and a status (submitted | withdrawn). The author reaches the flow
  through an explicit `/entry` session, so it never mixes with a post draft.
- `SubmissionSource` (ADR 007 port) gets its first implementation: `AuthorEntrySource` reading the
  week's entries from D1, numbered in submission order. ADR 008's candidate rule (author's posts) is
  replaced.
- Display names live only in D1 (`contest_entries.display_name`). Content files, committed post texts
  and `repository_dispatch` payloads carry only the placeholder `{entry:<entryId>}`. The publisher and
  the site build fetch names from the authenticated Worker endpoint `GET /internal/contest-names` and
  resolve them with one shared `core` function, per channel policy (tenant config): Telegram may show
  names, Instagram always shows "Work No N". Fetched names are masked in Actions logs.
- Withdrawal: the operator deletes the name in D1 (a bot command for the author later); the published
  Telegram messages are edited via the optional `editMessage` capability (caption or text, the adapter
  decides), using the message IDs stored from callback v2; the next site build shows "Work No N". Git
  history and GitHub event payloads never contained the name.
- Retention (Volodymyr, 2026-10-28, review N3): a winner's name is kept until she withdraws, so the
  winners showcase on the site stays named; names of the other entries are deleted 90 days after the
  result post, keeping only the anonymous record. The consent button says so: the work and the name
  may be shown, and the participant can withdraw at any time.
- Entry photos are processed like post photos (EXIF stripped, F4) when the poll post is published.

## Consequences
- The poll and result posts are built from entries, not from the published-posts index (T18 index
  stays for analytics and the site).
- A new optional `ChannelAdapter` capability `editMessage` (Telegram: `editMessageCaption` or
  `editMessageText`).
- The publish callback carries per-channel message IDs (callback v2, architecture 4.3).
- Instagram result posts never carry names: we do not rely on editing a published Instagram caption.
- The D1 table holds personal data: Cloudflare is listed as a processor in the Datenschutzerklärung
  (phase 2).
