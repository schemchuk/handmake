# AGENTS.md — Faden und Stimmung

## Language rules
- Talk to Volodymyr in Ukrainian.
- Write all repository docs, code, comments and commit messages in English.
- Channel/site content is written by his wife in Ukrainian and/or German. Never rewrite her texts unless asked.

## Project
"Faden und Stimmung" is a Telegram channel (already created, with our bot as channel admin) and an Instagram account for a weekly handmade circle in Landshut, Germany, led by Volodymyr's wife as a volunteer. Volodymyr is the technical side; she is the face of the project and decides tone and what gets published. Both participate voluntarily. Purposes:
1. Real use: informing and attracting participants.
2. Volodymyr's IT portfolio: must show real engineering (automation, CI/CD, documentation, clean repo), not a demo.
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
- Secrets only in `.env` (gitignored) and GitHub Secrets. Never print, log or commit tokens. Keep `.env.example` with placeholders.
- Germany/GDPR applies. A public site needs Impressum and Datenschutzerklärung. You are not a lawyer: flag legal questions to me, never present generated legal text as final.
- Everything must be automated: content -> Telegram / Instagram -> website, triggered by CI. My wife writes; the pipeline does the rest.
- Publishing must be idempotent: re-running CI never posts the same item twice.
- Channels are pluggable: only Telegram and Instagram are built now, but nothing in the core may depend on a specific network.
- Do NOT assume the tech stack. It is decided in the interview, from my goals and trade-offs you present.

## Environment
- Both agents run in the repo root inside VS Code's terminal. `origin` is GitHub over SSH, already authenticated by me. If push fails on auth, stop and tell me.
- Only ONE agent is active at a time in the working tree. Never run both in parallel on the same checkout.

## Roles and ownership
| Area | Owner | Reviewer |
|---|---|---|
| Repo setup, docs, interview, spec, architecture, task planning | Claude Code | Volodymyr |
| Implementing tasks from docs/03-tasks.md | Kimi Code (unless the task says otherwise) | Claude Code |
| Code review | the agent that did NOT write the code | Volodymyr approves merge |
| Commit and push of a session's work | the Active agent in docs/STATUS.md | n/a |
| Merge to main, secrets, legal/personal-data decisions | Volodymyr only | n/a |
Each task in docs/03-tasks.md has `Owner:` and `Reviewer:` fields. Never touch a task you do not own. If Kimi Code does not read AGENTS.md automatically, I will paste it in.

## Handoff protocol
`docs/STATUS.md` is the single source of truth. Fields: Active agent, Current task, Branch, Last commit (hash + message), Next step, Blocked on, Open questions for Volodymyr.
- START of every session: `git pull --rebase`, read AGENTS.md and docs/STATUS.md, confirm you are the Active agent. If not, stop and tell me.
- END of every session: working tree clean, STATUS.md updated, everything pushed, Active agent set to the next owner or "none".

## Git rules
- The Active agent is responsible for committing and pushing. After EVERY logical block (one coherent unit of work): update STATUS.md, stage only relevant files, commit, `git push`, then tell me the hash and a one-line summary. Never batch several blocks into one commit.
- Commit format: Conventional Commits (docs:, feat:, fix:, chore:, test:), imperative, under 72 chars, plus a trailer line `Agent: claude-code` or `Agent: kimi-code`.
- Docs and setup commits may go to `main`. Code goes on `feat/<task-id>-<slug>` branches and is merged only by me.
- Exception (approved 2026-10-21, ADR 003): the publish workflow in GitHub Actions may commit published posts and ledger entries directly to `main`, under `content/` only, as the bot identity. It never touches any other path. Agents never use this exception.
- Never force-push, never rewrite history, never commit `.env` or any secret. Run `git status` and `git diff --staged` before each commit and check for secrets.
- If a push is rejected: `git pull --rebase`, resolve, push again; on non-trivial conflicts stop and ask me.

## Workflow (spec-driven, with gates)
No code before steps 1-4 are approved by me.
1. INTERVIEW -> docs/00-interview.md
2. SPEC -> docs/01-spec.md (what and why, acceptance criteria, explicit non-goals). Stop for review.
3. ARCHITECTURE -> docs/02-architecture.md plus docs/decisions/NNN-title.md per major choice (options, decision, reason). Stop for review.
4. TASKS -> docs/03-tasks.md: small tasks (reviewable in 10-15 minutes), each with Owner, Reviewer, acceptance criteria and tests. Stop for review.
5. EXECUTE one task at a time on its own branch; writer and reviewer are different agents. If reality diverges from the spec, update the docs. Docs are the source of truth.
6. Each finished task: tests pass, docs updated, small clear commit.

## Interview rules
- Max 5-6 questions per round, then wait. Be direct and concise.
- If my answer is vague, contradictory, or misses the question, push back and ask again.
- After each round append my answers to docs/00-interview.md.
- When questions are closed, summarize my answers in 10 lines and ask me to confirm before writing the spec.
- Cover at least: target audience and languages (UA/DE) and how both are handled; my wife's workflow (where she writes, who approves posts, how photos reach the repo); Instagram account type and publishing mode; posting frequency and post types; whether a presentation is still needed and in what form (no third-party branding); my target job market and which skills the portfolio must prove; stack preferences (present options with trade-offs, do not pick for me); hosting and budget (assume near zero); what is public vs private in the repo and when it becomes public; how success is measured; time per week I can spend; the gap between "ideal" and "MVP in one week".
- Flag anything touching legal or personal-data risk and ask me.
