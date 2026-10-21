# 007 — Hexagonal core with a channel registry

Status: accepted · Date: 2026-10-21

## Context
Today only Telegram and Instagram are built, but bloggers will need other networks. lumara showed what
happens without seams: copy-pasted bots per account and network-specific code everywhere.

## Options
1. Direct calls to each network from the publisher: fastest to write, hardest to extend.
2. **Ports & adapters with a registry**: the core defines `ChannelAdapter` (capabilities, render,
   deliver, optional polls); each network is a package folder registered by key.
3. Plugin system loaded at runtime (separate npm packages): flexible, but overkill and harder to
   deploy on Workers.

## Decision
Option 2. Ports live in `packages/core/ports`; network adapters in `packages/channels/<key>`; each
runtime has one composition root that wires adapters by constructor injection. Rendering is driven by
the adapter's declared capabilities, not by network checks in the core. Adapters use `fetch` only, so
they run both in Node (publisher) and in Workers (bot, for `closePoll`).

## Consequences
- Adding a network = one folder implementing the interface, its fixtures and tests, one registry line.
- The fake adapters used in tests double as the dry-run implementation.
