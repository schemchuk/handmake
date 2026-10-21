# 008 — Work of the week via a channel poll

Status: proposed · Date: 2026-10-21

## Context
Volodymyr decided that readers choose the work of the week by voting in the Telegram channel; if there
is no result, AI decides (spec F19).

## Options
1. **Native Telegram poll in the channel**, replying to an album of numbered candidates. Anonymous by
   design (no voter data); results read via `stopPoll`.
2. Reactions counted per photo: needs reading reactions, which bots get only partially in channels.
3. Voting on the website: needs the site (phase 2) and stores voter data.

## Decision
Option 1. Telegram polls cannot carry images, so candidates are posted as a numbered album and the poll
replies to it. Opening and closing are Worker cron jobs; closing calls `closePoll` on the channel adapter.
`WinnerPicker` (Claude with the candidate photos) decides on zero votes, an unreadable result or a tie.

## Consequences
- The poll is a channel capability (`capabilities.polls`); channels without it (Instagram) only get
  the result post.
- The Worker performs one channel action itself (`closePoll`); all posting still goes through the
  publisher. Documented in architecture 4.4.
- Candidates in phase 1 come from the author's posts (Q7 resolved). Participant submissions arrive later
  through the `SubmissionSource` port: Telegram bot with author moderation and rules/licence consent
  (phase 3); option A (linked discussion group) was rejected as harder to moderate.
- Open defaults until confirmed: timing (Q8), ties (Q5), approval (Q6).
