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
