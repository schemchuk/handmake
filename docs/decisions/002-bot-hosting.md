# 002 — Bot hosting: Cloudflare Workers + D1

Status: accepted · Date: 2026-10-21

## Context
The bot must react within seconds (preview, buttons, edits), so it needs an always-on webhook.
Budget 0-10 EUR/month. Commercial use may come later.

## Options
| Option | Cost | Pros | Cons |
|---|---|---|---|
| **Cloudflare Workers + D1** | free tier | TS-native, global, strong-consistency SQL (D1), secrets store, cron triggers for later scheduling | 10 ms CPU per request on free tier (I/O wait does not count); Workers runtime, not full Node |
| Vercel Functions (Hobby) | free | familiar, good DX | Hobby plan is for non-commercial use only; needs an external DB |
| Deno Deploy + Deno KV | free tier | TS-native, simple | smaller ecosystem, less common in German job ads |
| Small VPS | ~4-5 EUR | full control, any runtime | ops work (updates, TLS, uptime), single point of failure |
| GitHub Actions polling | free | no extra platform | minutes of latency, unusable for interactive editing |

## Decision
Cloudflare Workers with D1 for drafts and publish requests. grammY as the Telegram framework
(supports Workers). Long work (AI call) runs after acknowledging the webhook (`ctx.waitUntil`) so
Telegram does not retry.

## Consequences
- Heavy CPU work (image re-encoding) stays out of the Worker; see ADR 003 and 005.
- Free-tier limits are verified at implementation time and documented in the README.
- Moving to a paid plan or another host later affects only `apps/bot`.
