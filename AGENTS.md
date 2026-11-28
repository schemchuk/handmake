# AGENTS.md — Faden und Stimmung

Uses Volodymyr's brain: his rules for coding agents (language, gates, interview, git, merge,
safety, secrets, several agents, machine) come into every Claude Code session from the brain
plugin. Agents without the plugin (Codex) read `~/.local/share/brain/rules/*.md` at session
start. This file holds project facts and project rules only; where it says more than the
brain, this file wins here.

## His wife's texts
Channel/site content is written by his wife in Ukrainian and/or German. Never rewrite her texts unless asked.

## Project
"Faden und Stimmung" is a Telegram channel (already created, with our bot as channel admin) and an Instagram account for a weekly handmade circle in Landshut, Germany, led by Volodymyr's wife as a volunteer. Volodymyr is the technical side; she is the face of the project and decides tone and what gets published. Both participate voluntarily. Purposes:
1. Real use (changed 2026-11-04, spec v7): grow a social following for the author's brand across Instagram, Facebook, Threads and Telegram, turn it into email leads, monetize later (shop). The circle already has enough participants.
2. Volodymyr's IT portfolio, as a by-product: must show real engineering (automation, CI/CD, documentation, clean repo), not a demo.
3. Future product: the same platform offered to other volunteer groups and bloggers (multi-tenant, any social network). Not developed now, but the architecture must be ready for it: ports and adapters, tenant-aware data, pluggable channels and content stores. Commercialization of the circle itself stays a stub. Market research lives in docs/research/.

Phases:
1. Single content source with automated publishing to Telegram and Instagram (current).
2. Website with blog, fed from the same content source.
3. Possibly an interactive bot (sign-up, reminders). Needs explicit approval first because it processes personal data.
Later, content may become partly AI-generated; for now texts are written by his wife and photos are authentic.

His wife needs a simple place to write texts and upload photos without touching Git or Markdown directly. How that works is decided in the interview and architecture.

Prior art: Volodymyr's earlier project `../lumara` (Telegram + Instagram + Facebook publishing via GitHub Actions). Learn from it; do not copy it blindly.
Legal prior art: `../coachHelp/docs/legal/` (Impressum, privacy policy, terms of service, data processing agreement). Reuse as a starting point when the product or website phase needs them; still flag to Volodymyr, never treat as final.

## Hard constraints
- Use ONLY our own names and branding. Do NOT put any third-party organization's name, logo or branding anywhere (repo, content, bot, site, examples). The host organization is not named until I confirm we have written permission. This keeps us free to reuse everything without permissions.
- Phase 1 stores NO personal data of participants.
- Photos: authentic photos of handmade items and hands. No identifiable faces without written consent.
- Content files carry a `provenance` field (human | ai-assisted | ai-generated).
- Germany/GDPR applies. A public site needs Impressum and Datenschutzerklärung. Legal questions: see the brain's safety rules.
- Everything must be automated: content -> Telegram / Instagram -> website, triggered by CI. My wife writes; the pipeline does the rest.
- Channels are pluggable: Telegram now, Instagram, Facebook and Threads next (built together), but nothing in the core may depend on a specific network.
- Do NOT assume the tech stack. It is decided in the interview, from my goals and trade-offs you present.

## Environment
- Agents run in the repo root inside VS Code's terminal. `origin` is GitHub over SSH, already authenticated by me. If push fails on auth, stop and tell me.

## Handoff
`docs/STATUS.md` fields: Active agent, Current task, Branch, Last commit (hash + message), Next step, Blocked on, Open questions for Volodymyr. Tasks in docs/03-tasks.md carry `Owner:` and `Reviewer:`; Claude Code writes and merges unless Volodymyr names Codex for a task (brain rule).
- Context budget (ADR 009): read docs/review-notes.md, the spec, architecture and ADRs only for the parts your task touches. Keep STATUS.md to the handoff fields plus short reminders.

## Project git rules
- Commit trailer `Agent: claude-code` or `Agent: codex`.
- Bot deploy after merge (added 2026-11-05): when a merged PR changes `apps/bot` or `packages/`,
  the agent who merged deploys the bot from a clean `main` with `pnpm -C apps/bot run deploy` and
  records the Worker version in STATUS.md. If the PR adds D1 migrations or changes
  `apps/bot/wrangler.toml` or secrets, it stops and asks Volodymyr first. The publisher needs no
  deploy: Actions run it from `main`.
- Review notes (added 2026-11-03): non-blocking findings go into the next task in docs/03-tasks.md (a
  `Review notes from PR #N` line) and to STATUS.md Next step.
- Exception (approved 2026-10-21, ADR 003): the publish workflow in GitHub Actions may commit published posts and ledger entries directly to `main`, under `content/` only, as the bot identity. It never touches any other path. Agents never use this exception.

## Interview topics
Cover at least: target audience and languages (UA/DE) and how both are handled; my wife's workflow (where she writes, who approves posts, how photos reach the repo); Instagram account type and publishing mode; posting frequency and post types; whether a presentation is still needed and in what form (no third-party branding); my target job market and which skills the portfolio must prove; stack preferences (present options with trade-offs, do not pick for me); hosting and budget (assume near zero); what is public vs private in the repo and when it becomes public; how success is measured; time per week I can spend; the gap between "ideal" and "MVP in one week". Flag anything touching legal or personal-data risk and ask me.
