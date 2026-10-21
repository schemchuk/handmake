# 002 — Contests on Telegram and Instagram: design notes

Date: 2026-10-21. Author: claude-code. Status: decisions taken (interview round 4), not scheduled.
Telegram contest = phase 3. Instagram contest = deferred idea (product feature for bloggers).
API claims must be re-checked against Meta's and Telegram's current docs before implementation.

## Decisions (Volodymyr, 2026-10-21)

| Topic | Telegram (phase 3) | Instagram (deferred) |
|---|---|---|
| Audience | circle members, weekly "work of the week" | open contest for strangers, anyone 18+, any country |
| Relation | separate contest | separate contest, monthly with a theme (2 weeks entries, 1 week voting) |
| Entry | participant sends photo + title to the bot in private chat, accepts rules and photo licence with a button | participant posts on their own profile, tags or @mentions our account, adds the contest hashtag |
| Photo rights | licence accepted by button in the bot | bot comments under the entry with a link to the rules; participant replies with an agreed phrase (e.g. `#takfaden`); the reply is stored as evidence |
| Moderation | the author approves or rejects each entry manually | AI pre-check flags issues (faces, not handmade, likely stock photo, off-theme); the author decides |
| Voting | anonymous channel poll, up to 10 candidates; the author picks 10 if there are more | carousel of finalists, vote by commenting the number; one account = one vote, the latest comment counts |
| No votes / tie | AI picks (same as phase 1 rules) | AI picks |
| Prize and name | no prize; winner's name only with consent | no prize (assumed, same as Telegram) |
| Data retention | minimum: voter identities never stored; non-winning entries deleted after 30 days; licence evidence kept while the photo is published | same; commenter usernames deleted right after counting, only totals kept |

## API facts checked (2026-10-21)

- Instagram: media where the account is tagged (`/{ig-user-id}/tags`) and caption mentions
  (`mentioned_media`) are readable; Stories mentions are not supported, and media from private accounts
  is not delivered ([tags](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/tags),
  [mentioned_media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/mentioned_media),
  [mentions guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/mentions)).
  Permissions: `instagram_business_basic`, `instagram_business_manage_comments`.
- Instagram has no poll API; voting by comment uses the comments endpoints of our own media.
- Telegram: channel polls are anonymous; `stopPoll` returns final counts (ADR 008).

## Flow sketches

**Telegram (phase 3):** `/contest` in the bot → rules + licence button → photo + title → entry draft →
author moderation → Monday: candidates (approved entries, the author trims to 10) → poll as in ADR 008 →
Wednesday: result → winner post (name only with consent).

**Instagram (deferred):** the author starts a contest in the bot (theme, dates) → announcement post →
webhook/polling of tags and mentions with the hashtag → bot comment asking for the rights phrase →
AI pre-check → author moderation → finalists carousel → comment voting → count, delete usernames →
result post tagging the winner (with consent given via the rights phrase).

## Architecture fit

- `SubmissionSource` implementations: `telegram-bot` (phase 3), `instagram-mentions` (deferred).
- `ModerationCheck` port for the AI pre-check (Claude vision), used by Instagram, optional for Telegram.
- Voting as adapter capabilities: `polls` (Telegram), `commentVoting` (Instagram).
- `RightsLedger`: stores licence evidence (entry ID, method, timestamp, link) per tenant.
- Feature flags per tenant: `contestTelegram`, `contestInstagram`; retention periods in tenant config.

## Legal and platform flags (not legal advice)

- Personal data of participants and voters: requires Volodymyr's explicit approval (phase-3 gate),
  privacy notice, retention as above. Starting material: `../coachHelp/docs/legal/`.
- Contest rules page (DE/UA, plus EN for the open Instagram contest): eligibility 18+, how to enter,
  licence scope, voting, winner selection incl. AI fallback, data processing, "not sponsored or endorsed
  by Instagram" (Instagram promotion rules).
- No prize keeps German Gewinnspiel requirements light; adding a prize re-opens this question.
- Third-party Instagram accounts (bloggers) need Meta App Review and business verification.
