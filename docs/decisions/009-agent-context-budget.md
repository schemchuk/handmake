# 009 — Agent context budget without a code graph

Status: accepted · Date: 2026-10-27

## Context
Two coding agents (Claude Code, Kimi Code) work on the repo in turns. Volodymyr asked whether the
project should be indexed as a code graph (an MCP server with a symbol/call graph, or GraphRAG over
the docs) to cut token usage. At the time of the decision the repo is about 410 KB of tracked text
(~100k tokens), about 8k lines of TypeScript in six packages; a session start reads AGENTS.md and
docs/STATUS.md (~3k tokens). Most tokens go to PR review diffs (T15: ~40 KB) and to long sessions
that hit context compaction, not to finding code.

## Options
1. **Code graph via MCP** (symbol index, call graph). Saves search tokens on large codebases. Here it
   saves little, must be rebuilt after every merge (a stale graph misleads the agent), must be set up
   identically in two agent clients, and does not replace reading code in review: the T15 blocker
   (grammY's 10 s webhook timeout) was found only by reading the code and the library.
2. **GraphRAG over docs.** The docs are already structured (spec, architecture, ADRs, tasks, ports in
   `packages/core`); a generated graph would duplicate them less accurately.
3. **Context budget rules** (chosen): keep the per-session reading small and the review diffs small.

## Decision
Option 3. No code graph now. Rules (also in AGENTS.md, "Context budget"):
- docs/STATUS.md holds only the handoff state; carried-forward review notes live in
  docs/review-notes.md and are read only when a task touches the area they name.
- One session per task for each agent; start a fresh session instead of continuing a long one.
- A task PR should stay under ~400 changed non-test lines; larger tasks are split in docs/03-tasks.md
  before work starts.
- Read only the packages a task touches; architecture and ADRs on demand, not at every start.

## Consequences
- Revisit this ADR when any of these holds: more than ~30-50k lines of code, a second repository
  (e.g. the website split out), or agents repeatedly search in the wrong place or duplicate code.
- Volodymyr gives Kimi a short handoff line; the reading list is defined by STATUS.md, not by "read
  everything".
