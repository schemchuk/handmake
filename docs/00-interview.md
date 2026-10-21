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
