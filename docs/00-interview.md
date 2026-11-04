# 00 — Interview

Questions and Volodymyr's answers that define goals, constraints and scope.

## Round 0 — pre-interview decisions (2026-10-21)

- Remote over SSH; repository is public.
- Lumara critique accepted (see docs/research/001-market-scan.md and STATUS.md): idempotent publishing, one pipeline with platform adapters, content reviewed before publishing, tests and dry-run, failure alerts, clean repo.
- Instagram is in scope for phase 1.
- Wife's intake channel: a private Telegram bot.
- Before the interview: market scan of similar projects, with commercialization in mind (docs/research/001-market-scan.md).

## Round 1 (2026-10-21)

**Q1. Audience and languages.**
The wife writes every post in Ukrainian. AI adapts it into German; the German text must be passed through a "humanizer" step so it does not read as machine-written.
*Open: the target audience itself (who the participants are) was not answered — re-asked in round 2.*

**Q2. Approval.**
She sends text and photos to the bot. The bot shows a preview with a "Publish" button; she alone decides. Manual editing must be possible before pressing "Publish".

**Q3. Instagram.**
The account does not exist yet; Volodymyr creates it later. Pipeline must work without Instagram until then.

**Q4. Frequency and post types.**
Two posts per week as the norm, more possible. Post types vary each time. Later, recurring types get automated: meeting reminder, meeting announcement, "work of the week".

**Q5. Commercialization.**
Main goal is the portfolio. Volodymyr wants to be among the first to build this intake-bot -> multi-channel chain and later offer it to other volunteer groups. Commercialization of the circle itself stays a stub (placeholder) for now.
*Implication: design for multiple groups via configuration (no hard-coded group name, channels, languages).*

**Q6. Portfolio.**
Show businesses that he can automate processes in any domain. Positioning: full-stack developer.
*Open: target job market / region — re-asked in round 2.*

## Round 2 (2026-10-21)

**Q1. Audience and language layout.**
International group, two languages: Ukrainian and German. Telegram: two separate posts (UA and DE). Instagram: if bilingual content hurts the Instagram algorithm, use Ukrainian only. Website: bilingual.
*Open: one or two Telegram channels; Instagram language choice — re-asked in round 3.*

**Q2. German text review.**
The wife reviews the German text herself in the bot preview.

**Q3. "Work of the week".**
If she marks one herself, use it; otherwise AI picks.

**Q4. Drafts.**
Agreed: drafts live outside Git (bot storage). Only published posts (text, photos, ledger entry) land in the public repo.

**Q5. Stack.**
Background: mostly TypeScript and Python, plus HTML/CSS, some Bash. Bot hosting: serverless with webhook.
*Open: option A (TypeScript everywhere) vs B (Python bot + TS site) not explicitly chosen — re-asked in round 3.*

**Q6. Budget, time, market, MVP.**
- Budget: 0-10 EUR/month for AI API and hosting is acceptable.
- Time: "5 hours a day, up to 40 a month" — contradictory, re-asked in round 3.
- Job market: Germany, possibly other EU countries.
- One-week MVP: bot accepts text and photos, translates, shows an editable preview, publishes to Telegram.

## Round 3 (2026-10-21)

**Q1. Time.** Up to 120 hours per month.

**Q2. Stack.** Option A: TypeScript everywhere (bot on a serverless webhook, Astro site, shared post schema). Python only for side scripts if needed.

**Q3. Telegram layout.** One channel; UA and DE posts published one after another.

**Q4. Instagram language.** German by default (configurable).

**Q5. Success metrics (about 3 months).**
- For the circle: 20 participants in the studio, 160 Telegram subscribers, 1000+ Instagram followers.
- For Volodymyr: demand for the product from other volunteer organizations and individual bloggers.

**Q6. Legal and presentation.**
- (a) Impressum will use the wife's address. *Flag: this publishes a private home address; alternatives (c/o or Impressum service address) to be checked by Volodymyr — not legal advice.*
- (b) A presentation is needed as slides. The wife uploads photos and answers questions in a dialogue that Volodymyr starts with Claude; slides are built from that. No third-party branding.

## Summary confirmed (2026-10-21)

Volodymyr confirmed the 10-line summary. Addition: Impressum and Datenschutzerklärung are required deliverables (drafts only; final legal text is Volodymyr's responsibility, not generated as final).

## Round 4 — contests (2026-10-21)

Answered via multiple-choice questions; all recommended options chosen.
- Telegram (phase 3): entry via the bot in private chat; the author moderates manually; anonymous poll
  with up to 10 candidates; no prize, winner's name only with consent.
- Instagram (deferred): entry by tag/@mention + hashtag; rights via reply phrase; voting by numbered
  comment under a finalists carousel; open to everyone 18+ worldwide.
- Both: two separate contests; Instagram monthly with a theme; AI pre-checks Instagram entries, the
  author decides; minimal data retention.
Details: docs/research/002-contests.md.

## Round 5 — product vision v2 (2026-10-28, open)

Volodymyr's vision, in his words (translated from Ukrainian):
- One source of truth from which the author runs the Telegram and Instagram accounts; other networks
  can be connected step by step.
- A poll in the Telegram channel picks the best work among those submitted by members of the Telegram
  channel. A video is created from the winning work.
- The website represents the author's interests and works like a kind of model agency, also presenting
  collections of works. AI does all of this.
- A shop can be opened next to or on the website.
- A designed funnel; once the lead base is large enough, monetization can be switched on.
- The whole case must be strong as a product to resell to bloggers.

Process: re-run interview -> spec v5 -> architecture v3 -> review brief for kimi-code -> tasks v3,
each with Volodymyr's gate. T22 is paused until spec v5 is approved, because the vision changes where
poll candidates come from (participants instead of the author's own posts).

Answers, part 1 (2026-10-28):
- Q1 Participants' works are only shown in media; the contest runs in Telegram. Nothing else is done
  with them, and they are never sold. (How participants hand in works: still open.)
- Q2 Video: decided later. Preferred source is a new work of the author, which she hands to the
  system somehow.
- Q4 Shop: later, the author's own works only. First build a lead base and entertain it.
- Business registration: later, country not fixed (may be outside Germany). *Flag: a site run from
  Germany still needs an Impressum; the country of registration has tax and legal consequences —
  not legal advice.*

Answers, part 2 (2026-10-28, multiple choice, all recommended options chosen):
- Participants hand their works to the author (at a meeting or privately); she obtains consent and
  uploads them through her bot. The system stores no participant data.
- Leads at the start: Telegram and Instagram followers only, no personal data on our side. An email
  list (ready service with double opt-in) comes later, before the shop.
- The website presents the author and her collections, plus a blog; participants' works appear only
  in the contest section.
- Reselling to bloggers: business model decided later; the architecture stays multi-tenant.

## Round 6 — viability check (grill, 2026-11-04)

State at the check: 14 days of work, about 79 PRs, 6 posts, 4 works, 2 shows published; the
Telegram channel has 14 subscribers including the bot and the two of us; the first show went public
on 2026-11-03.

- Q1 Real user: the author uses the bot with Volodymyr's help and is willing to run everything
  herself later; for now she is busy making works and running the circle. AI models are used because
  neither of us wants to model. If we ever appear in shows ourselves, the product must separate
  generated from real photos (new content type later, not now).
- Q2-Q3 Success check: no site analytics existed, so show reaction could not be measured. Accepted:
  Cloudflare Web Analytics on the site (cookieless) and manual Telegram view counts until F25;
  first check after 4 shows (about mid-December 2026), main check on 2027-01-21.
- Q4 Audience: the circle in Landshut already has enough participants. Everyone else either follows
  the circle's work or forms a community around the brand. The goal shifts to a large social
  following, monetized later (for example an online shop). The "20 participants" target is dropped.
- Q5 Goal priority changed: audience and the author's business first; the portfolio is a by-product.
  Before new features, verify that everything already built works end to end.
- Q6 Contest: never built (T27-T32 are planned only). It should run on all networks: Telegram keeps
  its poll; Instagram, Facebook and Threads get one numbered carousel post and votes are comments with
  the work number; the bot sums the votes, the author decides. No prizes. Built after the Meta
  channels.
- Facebook (Page) and Threads are planned together with Instagram through one Meta app, not one by
  one later.
- Q7 Show generation stays as it is (about 0.70 EUR per show is within budget).
  instagram-agent-skill (MIT) generates text only and posts nothing; we reuse its rules: first ~125
  caption characters carry the message, at most 5 hashtags, 1080x1350 carousels, comment-reply rules.
- Q8 Funnel (Volodymyr follows the recommendation): networks -> site -> email sign-up with double
  opt-in, lead magnet = a free embroidery pattern (PDF) from the author -> Telegram channel as the warm
  step -> shop later, first for the email list. F27 approved in principle.
- Q9 Legal: protection first, avoid anything that invites a lawsuit or Abmahnung. Impressum uses the
  author's home address while there are no sales; texts come from a free generator by lawyers, not
  from AI. At the first sale: switch to an address service and lawyer-maintained legal texts.
  Impressum link in every social profile.
- Q10 Social media replies: the bot drafts replies to comments (rules ported from `/ig-reply`), the
  author approves them in Telegram. Volodymyr runs `/ig-plan` and `/ig-audit` himself once a week.
- Order: T41 (legal pages and go-live) first, then the end-to-end check of what exists.
