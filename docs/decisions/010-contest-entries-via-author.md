# 010 — Contest entries are uploaded by the author; names stay out of Git

Status: accepted (with architecture v3) · Date: 2026-10-28 · Amends: ADR 008 (candidates)

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
Option 2.
- New draft type `entry` in the bot: one photo (more are rejected), an optional display name
  (first name or nickname, max 30 chars, no validation beyond length), and a mandatory consent button
  "the participant agreed that her work is shown". Entries carry `tenantId` and the contest week.
- `SubmissionSource` (ADR 007 port) gets its first implementation: `AuthorEntrySource` reading the
  week's approved entries from D1. ADR 008's candidate rule (author's posts) is replaced.
- Display names live only in D1 (`contest_entries.display_name`). Content files and committed post
  texts use the placeholder `{entry:<entryId>}`; the publisher resolves it from the dispatch payload
  when rendering for channels, and the site build resolves it from an authenticated Worker endpoint.
- Withdrawal: the operator deletes the name in D1 (a bot command for the author later); the next site
  build shows "Work No N", and the published Telegram caption is edited via the channel adapter
  (`editCaption`, new optional capability). Git history never contained the name.
- Entry photos are processed like post photos (EXIF stripped, F4) when the poll post is published.

## Consequences
- The poll and result posts are built from entries, not from the published-posts index (T18 index
  stays for analytics and the site).
- A new optional `ChannelAdapter` capability `editCaption` (Telegram: `editMessageCaption`).
- Instagram result posts never carry names ("Work No N" only): we do not rely on editing a published
  Instagram caption through the API.
- The D1 table holds personal data: it is listed in the Datenschutzerklärung (phase 2) and entries
  are deleted 90 days after the result post, keeping only the anonymous record.
