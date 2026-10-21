# 004 — AI translation and humanizer

Status: proposed (model choice open) · Date: 2026-10-21

## Context
UA posts are adapted to German and must not read as machine output (interview round 1). Volume is
about 10 posts per month. Budget below 10 EUR/month.

## Options
1. **Claude API, one call**: translate and apply humanizer rules from a versioned prompt
   (`packages/ai/prompts/humanize-de@N.md`), structured output (JSON with the German text and notes).
2. DeepL API Free for translation plus an LLM call for humanizing: two providers, two keys, two DPAs,
   and DeepL alone does not cover the "humanizer" requirement.
3. Self-hosted open model: no API cost, but needs a GPU host; out of budget and scope.

## Decision
Option 1, using the official Anthropic TypeScript SDK. The prompt version and model ID are written to
the post's frontmatter (`versions.de.model`, `versions.de.prompt`) for provenance.

Model (to confirm by Volodymyr): default `claude-opus-5-5` (best quality for natural German).
Cheaper alternatives are `claude-sonnet-5-5` or `claude-haiku-4-5`. At this volume all of them cost
well under 1 EUR/month, so quality decides. The model ID is configuration, not code.

## Consequences
- An eval set of 10-20 real UA posts with reviewed German versions guards prompt changes.
- Texts go to Anthropic: list in the Datenschutzerklärung; Volodymyr checks the DPA.
- On AI failure the author can write the German text herself (F7).
