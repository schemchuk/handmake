# 01 — Spec

What we build and why: acceptance criteria and explicit non-goals.

Status: draft v3 (2026-10-21), awaiting Volodymyr's review. Source: docs/00-interview.md.

## 1. Problem and goals

A volunteer leads a weekly, international (Ukrainian/German) handmade circle in Landshut. She needs to
reach participants on Telegram, Instagram and later a website, without technical work and without
writing everything twice in two languages.

Goals, in priority order:
1. **Portfolio.** Show businesses in Germany/EU that Volodymyr can automate a real process end to end
   as a full-stack developer: bot, AI step, publishing pipeline, CI/CD, tests, docs.
2. **Real use.** Inform and attract participants. Targets after about 3 months: 20 participants in the
   studio, 160 Telegram subscribers, 1000+ Instagram followers.
3. **Reusable product.** The same chain can later be offered to other volunteer groups and individual
   bloggers. Success signal: other groups ask for it.
4. **Commercialization** of the circle itself: a stub only (see section 8).

## 2. Users and roles

| Role | Who | Can do |
|---|---|---|
| Author | the circle lead (Volodymyr's wife) | send drafts to the bot, edit, publish, delete drafts |
| Operator | Volodymyr | configure groups and channels, manage secrets, receive failure alerts, merge code |
| Reader | public | read the Telegram channel, Instagram, later the website |

Only allow-listed Telegram user IDs may use the bot. Everyone else gets a polite refusal and nothing is stored.

## 3. Core flow (phase 1)

1. The author sends the bot a post: Ukrainian text and 0-10 photos, in any order, from her phone.
2. The bot stores a **draft** (outside Git) and generates a German version: AI translation plus a
   "humanizer" pass so the text reads as natural German, not machine output.
3. The bot shows a **preview**: UA post, DE post, photos, and which channels it will go to.
4. The author can **edit** the UA text, the DE text, or both, as many times as she wants, and can
   regenerate the German version after changing the Ukrainian one. The preview updates after each edit.
5. Before publishing, she confirms that the photos contain no identifiable faces without written consent.
6. She presses **Publish**. The pipeline publishes:
   - Telegram: UA post, then DE post, in the one existing channel.
   - Instagram (once the account is connected): one post, German caption by default (configurable).
7. The published post is saved to the public repo (text, photos, metadata, publish ledger), which later
   feeds the website.
8. The bot reports the result to the author. On any failure, the operator gets an alert.

## 4. Functional requirements

IDs are referenced by tasks and tests.

### Intake and drafts
- **F1** The bot accepts text and photos from allow-listed users only.
- **F2** One draft holds one UA text and 0-10 photos. The author can start a new draft, view the current
  one, and discard it.
- **F3** Drafts are stored outside the Git repository and are never public before publishing.
- **F4** Photos are normalized before storage: EXIF metadata (including GPS) is removed, size and format
  fit both Telegram and Instagram limits.

### Translation
- **F5** The German version is produced by an AI model from the UA text, followed by a humanizer step
  driven by a versioned prompt kept in the repo.
- **F6** Each language version carries `provenance`: UA text `human` (or `ai-assisted` if she asked AI to
  change it), DE text `ai-assisted`, or `human` if she rewrote it completely.
- **F7** If the AI call fails, the author is told and can retry or write the German text herself.

### Preview, edit, publish
- **F8** The preview shows exactly what will be published on each channel, including length limits
  (Telegram caption 1024 characters with photos, message 4096; Instagram caption 2200).
- **F9** The author can edit either language before publishing. Texts over a limit block publishing with
  a clear message.
- **F10** Publishing requires an explicit button press and a face-consent confirmation.
- **F11** Publishing is **idempotent**: each post has a stable ID, and the ledger records per-channel
  status. Retrying never creates duplicates; it only completes the channels that failed.
- **F12** Instagram is optional per group: if not configured, posts go to Telegram only, without errors.

### Storage and history
- **F13** Every published post is stored in the repo as one content folder: a Markdown file with
  frontmatter (id, date, languages, provenance per language, channels, per-channel post IDs) and its photos.
- **F14** The repo never contains secrets, drafts, or personal data of participants.

### Operations
- **F15** On any failed publish or AI call, the operator receives an alert (private Telegram chat).
- **F16** A dry-run mode renders and validates posts without sending anything, used in tests and CI.
- **F17** All group-specific values (name, channels, languages, default Instagram language, allow-list)
  come from configuration, not code, so a second group can be added without code changes.

### Later in phase 1 (after the MVP)
- **F18** Automatic recurring posts: meeting announcement and meeting reminder, from a configured schedule.
- **F19** "Work of the week": the author may mark a photo; if she does not, AI picks one from the week's
  published photos. The result goes through the same preview and Publish step.

## 5. MVP (first week)

In scope: F1-F11, F13-F16 for **Telegram only**, one group, configuration-driven (F17 structure in place).

Acceptance criteria:
- **A1** From her phone, the author sends a UA text and 3 photos and gets a preview with a German version
  within 60 seconds.
- **A2** She edits the German text in the bot and sees the updated preview.
- **A3** After Publish, the channel shows the UA post followed by the DE post, both with the photos.
- **A4** Re-triggering the same publish (button pressed twice, webhook retry) produces no duplicate posts.
- **A5** The post appears in the repo as a content folder with correct frontmatter and EXIF-free photos.
- **A6** A non-allow-listed Telegram user gets a refusal and nothing is stored.
- **A7** CI runs lint, type checks and unit tests (rendering, limits, ledger logic, dry-run) on every PR.
- **A8** A forced Telegram API failure produces an operator alert and leaves the ledger in a retryable state.
- **A9** No secret appears in the repo, logs or CI output (secret scanning in CI).

## 6. Later phases (outline, specified separately)

- **Phase 1b:** Instagram adapter (professional account, Instagram Login API, no Facebook Page), F18, F19.
- **Phase 2:** bilingual website and blog built from the content folders in the repo, with Impressum and
  Datenschutzerklärung pages. Legal texts are drafts for Volodymyr to verify, never presented as final.
- **Phase 3:** participant-facing bot (sign-up, reminders). Requires explicit approval because it processes
  personal data.
- **Presentation:** slide deck built from the author's photos and a guided Q&A, no third-party branding.

## 7. Non-functional requirements

- **Cost:** 0-10 EUR per month total for hosting and AI API.
- **Hosting:** serverless webhook for the bot; static hosting for the site.
- **Stack:** TypeScript across bot, pipeline and site (decided in the interview; details in architecture).
- **Security:** secrets only in `.env` and GitHub Secrets / platform secret store; least-privilege tokens.
- **Privacy:** GDPR applies. No participant data in phase 1. Texts are sent to an external AI API, which
  must be listed in the Datenschutzerklärung.
- **Branding:** only our own names. The host organization is not named anywhere until written permission.
- **Quality:** small reviewed PRs, tests for all logic, docs updated with every change.

## 8. Commercialization stub

- Configuration has an optional `offerings` section (for example paid workshops or kits), empty and unused
  in phase 1. Nothing renders from it until a later spec enables it.
- No payments, prices or sales flows in any phase covered by this spec.
- Before enabling anything paid, Volodymyr checks the tax and volunteer status questions listed in
  docs/research/001-market-scan.md, section 6.

## 9. Non-goals and deferred features

Not planned:
- No posting to Facebook, Threads, TikTok, nebenan.de or Meetup.

Deferred: out of the MVP, but planned as possible later features. The architecture must not block them:
- **Web admin panel** as a second authoring interface next to the bot. Design: drafts and publishing
  logic live behind an interface that is independent of Telegram.
- **Scheduled publishing** (publish at a chosen date and time). Design: a post can carry a `publishAt`
  field; in the MVP it is always "now".
- **Analytics** (subscribers, reach, per-post stats). Design: the ledger keeps per-channel post IDs so
  stats can be fetched later.
- **Fully AI-generated posts.** Design: `provenance: ai-generated` is already a valid value; such posts go
  through the same preview and Publish step.
- **Multi-group onboarding UI.** Until then a second group is added by configuration.

## 10. Open questions

- **Q1** Resolved (2026-10-21): Instagram is the author's **personal** account. See section 11.
- **Q2** Impressum address: wife's home address vs c/o or service address (legal check by Volodymyr).
  Decided handling: Impressum data is never committed to the repo; it is injected at site build time
  from secrets (phase 2), so a later address change leaves no trace in Git history.
- **Q3** Which AI provider and model for translation (decided in architecture, within the budget).
- **Q4** Resolved: meetings every Thursday at 14:00 Europe/Berlin. Stored in group configuration so
  changes need no code. Place wording stays "Landshut" without naming the host organization.

## 11. Decisions from spec review (2026-10-21)

- The face-consent confirmation before Publish (F10) stays.
- F18 (announcement, reminder) and F19 (work of the week) come after the MVP, at the end of phase 1.
- Instagram is the author's personal account, not a brand account. Consequences:
  - The pipeline publishes only circle posts; she keeps posting personal content manually. Nothing in
    the pipeline reads, edits or deletes posts it did not create.
  - The account must be switched to a professional (Creator or Business) type for API publishing.
  - Her own face in her own posts is her decision; the consent check (F10) covers other people.
  - The handle and account IDs are not stored in the public repo; they live in configuration secrets.
  - The circle's brand ("Faden und Stimmung") is still used on Telegram and the website.
