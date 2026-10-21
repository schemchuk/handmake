# 002 — Instagram contest: feasibility notes

Date: 2026-10-21. Author: claude-code. Status: idea, not scheduled. Based on general knowledge of the
Instagram Platform; **every API claim must be re-checked against Meta's current docs before design.**

## Idea

An open "work of the week" style contest on Instagram: people outside the circle, who do not know each
other, submit their handmade work; the audience votes; the winner is announced. For bloggers this is a
strong engagement feature.

## How entries could reach us

| Mechanism | What the API gives (to verify) | Notes |
|---|---|---|
| Participant tags or @mentions the account in their own post | mentioned/tagged media for the professional account, including the media URL and the author's username | best fit; the entry stays on the participant's profile |
| Comment with a photo link or a hashtag under our contest post | comments on our own media (text, username) | comments cannot carry photos |
| Contest hashtag | hashtag search returns public media, limited number of hashtags per week, author identity may be limited | weak for attribution |
| DM to the account | messaging API, separate permissions and review | heavy to build |

## Voting

- The Instagram API has no polls (story poll stickers cannot be created through the API).
- Options: a carousel of finalists in our post plus voting by comment ("1", "2", …) counted via the
  comments API; or likes on each finalist's repost. Both expose voter usernames to us (personal data).
- Fallback as on Telegram: AI decides on no votes or a tie.

## Legal and platform flags (not legal advice)

- **Personal data of strangers:** usernames, photos, comments of entrants and voters. Needs a privacy
  notice, retention rules, and Volodymyr's explicit approval (same gate as phase 3).
- **Photo rights:** reposting someone's photo needs their permission. Common practice is an explicit
  rights grant (e.g. the entrant replies with an agreed phrase); this must be stored as evidence.
- **Instagram's promotion rules:** contests are allowed, but the organizer must publish official rules,
  state that Instagram does not sponsor or endorse the contest, and not ask for inaccurate tagging.
- **German contest law (Gewinnspiel):** rules, eligibility, prize and winner notification; stricter if
  there is a prize. Minors need extra care.
- **Meta App Review:** reading mentions and comments for accounts other than our own (bloggers) needs
  advanced access and business verification.
- Starting material for legal texts: `../coachHelp/docs/legal/`.

## Fit with the architecture

- A second `SubmissionSource` implementation (`instagram-mentions`), moderated by the tenant in the bot
  preview, like phase 3 Telegram submissions.
- Voting as an optional `ChannelAdapter` capability (`commentVoting`), separate from native `polls`.
- Feature flag per tenant (`instagramContest`).

## Next step when prioritized

Verify the API surface (mentions, comments, rate limits, required permissions) in Meta's docs and
write a short spec section with rules template, data flow and retention.
