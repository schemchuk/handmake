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
