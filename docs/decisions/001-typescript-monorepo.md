# 001 — TypeScript monorepo with a shared core

Status: accepted (interview round 3) · Date: 2026-10-21

## Context
Volodymyr positions himself as a full-stack developer and knows TypeScript and Python. The bot,
the publisher and the site must render posts identically (preview = what gets published).

## Options
1. **TypeScript everywhere** (pnpm workspaces): one language from bot to site, shared types and renderers.
2. Python bot and publisher, TypeScript site: familiar from lumara, but schema and renderers exist twice.
3. Python everywhere with a Python static site generator: simplest, weakest full-stack story.

## Decision
Option 1. pnpm workspaces, TypeScript `strict`, zod for schemas, Vitest, ESLint + Prettier.
Python is allowed only for one-off scripts outside the runtime path.

## Consequences
- `packages/core` is pure (no I/O) and carries most tests.
- Node version pinned in `.nvmrc` and CI; Worker code must avoid Node-only APIs in `core`.
