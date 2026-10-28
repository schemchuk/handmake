# 013 — Funnel: anonymous audience metrics now, email via a ready service later

Status: accepted for metrics; email part proposed (needs Volodymyr's approval, spec F27) · Date: 2026-10-28

## Context
Spec v5 F25-F27: the lead base starts as channel followers (no personal data on our side), with weekly
metrics to decide when to switch on monetization; email capture comes later. Double opt-in is required
practice in Germany. Personal data must not land in the repo.

## Options
Metrics:
1. **Worker cron reads counts from the network APIs** (Telegram `getChatMemberCount`, Instagram
   `followers_count` and media insights), stores aggregate numbers per tenant per week in D1, and sends
   a weekly summary to the author and operator. No personal data.
2. A third-party analytics tool: another account and vendor, and less of a portfolio story.

Email (later):
1. **Ready service with double opt-in (MailerLite or Brevo) behind an `EmailList` port.** The site form
   posts to the service; addresses never touch our storage.
2. Own list in D1 with own double opt-in mails: full control, but we become the data store for
   personal data and must handle deliverability.

## Decision
Metrics: option 1, behind a `metrics` capability on channel adapters (`followerCount`,
`postStats`), results in D1 table `audience_metrics` (tenantId, channel, week, followers, reach).
Built in phase 3, not earlier; the Instagram insights permissions for the Creator account are verified
in that task.
Email: option 1, built only after Volodymyr's explicit approval and the updated Datenschutzerklärung;
provider chosen at that time (EU hosting and a DPA required).

## Consequences
- Cross-promotion (F26) is template work: channel and site links come from tenant config.
- The funnel threshold for monetization is a number in tenant config, read against these metrics;
  the switch itself stays a manual operator decision (F28).
