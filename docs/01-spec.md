# 01 — Spec

What we build and why: acceptance criteria and explicit non-goals.

Status: **approved v6 (2026-10-30).** Previous: approved v5 (2026-10-28).
Source: docs/00-interview.md, rounds 0-5, and the POSSE discussion (docs/STATUS.md, rounds 1-9, 2026-10-30).
Changes from v5 are listed in section 14.

## 1. Problem, vision and goals

A volunteer (the **author**) leads a weekly, international (Ukrainian/German) handmade circle in
Landshut. She needs to reach people on Telegram, Instagram and a website without technical work and
without writing everything twice in two languages.

**Product vision (v5).** One source of truth from which the author runs all her channels: Telegram and
Instagram now, other networks connected step by step. A weekly contest in the Telegram channel lets
readers pick the best work submitted by circle participants. New works of the author are turned into
short videos. A website presents the author and her collections like a small agency would. AI prepares
most of the content; the author approves everything before it goes out. A designed funnel grows an
audience first; once it is large enough, monetization (a shop with the author's works) can be switched
on. The whole case is built so that the same platform can be resold to bloggers.

**Product vision (v6, POSSE).** The author's own website is the primary source; Telegram and Instagram
carry copies that link back to it (publish on your own site, syndicate elsewhere). The brand is
**Faden und Stimmung** (domain fadenundstimmung.de, registered at INWX, DNS on Cloudflare) and it is the
author's future business and a portfolio piece. The site works like a small model agency: every one to
two weeks a **show** presents one real work of the author (clothing with her embroidery, embroidered
pillows and embroideries, small appliqués and accessories) on AI-generated, fictional models. Only real
works are shown; every generated image is labelled. The audience is the whole German-speaking area
(DE/AT/CH); the circle in Landshut is one small page on the site.

Goals, in priority order (unchanged from v4, confirmed 2026-10-28, Q10):
1. **Portfolio.** Show businesses in Germany/EU that Volodymyr can automate a real process end to end
   as a full-stack developer: bot, AI steps, publishing pipeline, media generation, CI/CD, tests, docs.
2. **Real use and audience.** Inform and attract participants, entertain and grow a lead base.
   Targets after about 3 months: 20 participants in the studio, 160 Telegram subscribers, 1000+
   Instagram followers.
3. **Resellable product.** The circle is the reference case of a platform for bloggers and groups. Not
   sold now, but the design must be ready for it (section 12) and the case must be convincing.
4. **Monetization** of the author's work: designed now (section 8), switched on later.

## 2. Users and roles

| Role | Who | Can do |
|---|---|---|
| Author | the circle lead (Volodymyr's wife) | send posts, contest entries and new works to the bot, edit, approve, publish |
| Operator | Volodymyr | configure tenants and channels, manage secrets, receive failure alerts, approve sensitive merges |
| Participant | circle members | hand their works to the author for the contest (offline or privately); never use the system directly |
| Reader | public | read Telegram, Instagram and the website, vote in channel polls |

Only allow-listed Telegram user IDs may use the bot. Everyone else gets a polite refusal and nothing is
stored. The system stores **no personal data of readers**. Of participants it stores only an optional
first name or nickname given with consent (F19, Q13), never in Git. F27 (email) needs explicit approval.

## 3. Core flow (phase 1, live since 2026-10-27)

1. The author sends the bot a post: Ukrainian text and 0-10 photos, in any order, from her phone.
2. The bot stores a **draft** (outside Git) and generates a German version: AI translation plus a
   "humanizer" pass so the text reads as natural German, not machine output.
3. The bot shows a **preview**: UA post, DE post, photos, and which channels it will go to.
4. The author can **edit** either language as often as she wants, and regenerate the German version.
5. Before publishing, she confirms that the photos contain no identifiable faces without written consent.
6. She presses **Publish**. The pipeline publishes to every channel configured for the tenant
   (Telegram now; Instagram after phase 1b).
7. The published post is saved to the public repo (text, photos, metadata, publish ledger), which
   feeds the website.
8. The bot reports the result to the author. On any failure, the operator gets an alert.

## 4. Functional requirements

IDs are referenced by tasks and tests. F1-F18 are implemented; F19 is redefined in v5.

### Intake and drafts
- **F1** The bot accepts text and photos from allow-listed users only.
- **F2** One draft holds one UA text and 0-10 photos. The author can start a new draft, view the current
  one, and discard it.
- **F3** Drafts are stored outside the Git repository and are never public before publishing.
- **F4** Photos are normalized before storage: EXIF metadata (including GPS) is removed, size and format
  fit all enabled channels' limits.

### Translation
- **F5** The German version is produced by an AI model from the UA text, followed by a humanizer step
  driven by a versioned prompt kept in the repo.
- **F6** Each language version carries `provenance`: `human`, `ai-assisted` or `ai-generated`.
- **F7** If the AI call fails, the author is told and can retry or write the German text herself.

### Preview, edit, publish
- **F8** The preview shows exactly what will be published on each channel, including length limits.
- **F9** The author can edit either language before publishing. Texts over a limit block publishing.
- **F10** Publishing requires an explicit button press and a face-consent confirmation.
- **F11** Publishing is **idempotent**: each post has a stable ID and the ledger records per-channel,
  per-operation status. Retrying never creates duplicates; it only completes what failed.
- **F12** Each channel is optional per tenant; an unconfigured channel is skipped without errors.

### Storage and history
- **F13** Every published post is stored in the content store as one content folder: a Markdown file
  with frontmatter (id, date, type, languages, provenance, channels, per-channel post IDs) and photos.
- **F14** The repo never contains secrets, drafts, or personal data of participants or readers
  (including contest display names, see F19).

### Operations
- **F15** On any failed publish, render or AI call, the operator receives an alert (private Telegram chat).
- **F16** A dry-run mode renders and validates posts without sending anything, used in tests and CI.
- **F17** All tenant-specific values come from configuration, not code.

### Recurring posts
- **F18** Meeting announcement and reminder are drafted automatically from a configured schedule and
  templates; the author publishes them from the preview. (Implemented, T20.)

### Contest: work of the week (redefined in v5)
- **F19** Readers of the Telegram channel pick the best participant work of the week.
  - **Entries.** A participant hands a photo of her work to the author (at a meeting or privately).
    The author sends it to the bot as a **contest entry** (stored separately from post drafts), and confirms with a
    button that the participant agreed to the work being shown. Optionally she adds the participant's
    first name or nickname (no surname, handle or contact), also by consent (Q13).
  - **Names outside Git.** The display name is stored only in the bot database, never in the content
    repo; posts and the site get it at render/build time. If a participant withdraws consent, the name
    is deleted there and the published posts are edited, without rewriting Git history.
  - **Candidates.** The week's approved entries, max 10, numbered 1..N in submission order.
  - **Poll.** At the configured opening time the bot drafts the poll post (album of candidates plus a
    Telegram poll "No 1".."No N" replying to it). The author publishes it. Channel polls are anonymous;
    no voter data is collected. (Poll capability: T21, done.)
  - **Close.** At the configured closing time the system stops the poll and reads the final counts.
  - **Winner.** Most votes. No votes, an unreadable result or a tie: the author picks among the (tied)
    candidates with buttons in the bot, and the post says so (changed 2026-10-28, replaces "AI picks").
  - **Result.** A result post announcing the winner is drafted for the author's Publish, for all
    channels (Instagram has no poll API, so it gets the result post only).
  - With fewer than 2 entries in a week, no poll is drafted and the author is told.

### Shows and AI budget (phase 2a, after the site)
- **F30** A **show** presents one real work: 3-5 images and one short video, every 1-2 weeks. The
  author sends 2-3 photos of the work to the bot and approves the result like any post. Three
  templates: *worn* (clothing with embroidery, on a model), *close-up* (appliqués, small accessories,
  held or sewn on), *interior* (pillows, embroideries; a model is optional). The bot picks the template
  from the work type and the author can change it. Models are 2-3 fixed, named, fictional adult
  personas with a stable look, defined in tenant config; the models and their number can be changed
  without code changes. The show is published to the site first, then copied to Telegram and Instagram
  with a canonical link (F31).
  - **Real works only.** The work in every image comes from the author's photo (try-on or compositing);
    nothing is generated from a description. Before approval the preview shows the original photo next
    to the result, because the author checks that the embroidery pattern is unchanged.
  - **Labelling.** Every generated image carries a visible and machine-readable AI marker (EU AI Act
    art. 50); captions say "KI-generiertes Model".
- **F32** AI cost budget per tenant: a monthly target of 20 EUR with a 5 EUR tolerance. At 20 EUR the
  operator is warned; at 25 EUR new shows wait until next month. Every AI call (text, image, video) is
  booked in the ledger with its cost. The operator has a cost command (spent this month, per show, per
  service, left) and gets a summary on the 1st. Prices are verified in the pipeline task (Q15).

### Video (phase 2b)
- **F20** The author marks a new work of hers as **video source** (photos and/or a short clip sent to
  the bot; the exact hand-over is Q9). The system produces a short vertical video (about 15-30 s) with
  AI-written captions in UA/DE, shows it as a preview, and publishes it after approval to the channels
  that support video (Telegram video, Instagram Reels, later YouTube Shorts / TikTok).
- **F21** Video generation is deterministic and reproducible from the source files and a versioned
  template, so a re-render gives the same result and a failed publish can be retried without a
  re-render. Rendering runs outside the bot Worker.

### Website (phase 2, now first: POSSE)
- **F22** A bilingual static website, built from the content store, presents the author. German is the
  default language (`/`), Ukrainian lives under `/uk/` (same translation step as the channels, no
  English for now). Sections:
  - **Shows** (F30): the agency core, newest first.
  - **Works and collections**: the author's real works grouped into collections, each with AI-drafted,
    author-approved descriptions.
  - **About**: the author and the brand.
  - **Circle** (`/kreis/`): one page (what, when, where in Landshut, link to the Telegram channel). No
    participants' works and no contest results on the site (changed v6; consent and brand focus).
  - **Blog**: published posts.
  - **Legal**: Impressum and Datenschutzerklärung (drafts for Volodymyr to verify, see Q2).
- **F23** The site is rebuilt and deployed automatically after each publish, on the custom domain
  fadenundstimmung.de. Site look and texts come from tenant configuration (theme, logo, languages), so
  another tenant gets its own site without code changes.
- **F31** Canonical links (POSSE): every channel post of a site-worthy item links to its page on the
  site. The post id is stable, so the URL is known before the site rebuild.
- **F24** Collections and works are content types in the content store, created through the bot like
  posts (the author sends photos and a short note; AI drafts the description; she approves).

### Funnel and audience (phase 3)
- **F25** Weekly audience metrics per channel (follower and subscriber counts, per-post reach where the
  API provides it) are collected without any personal data and shown to the operator and author.
- **F26** Each channel and the site link to each other (cross-promotion), configured per tenant.
- **F27** Email capture (phase 3, later): a sign-up form on the site via a ready email service with
  double opt-in. Addresses live only in that service, never in the repo. Requires Volodymyr's explicit
  approval (personal data) and an updated Datenschutzerklärung before it goes live.

### Monetization (phase 4, switched off)
- **F28** A monetization switch per tenant (feature flag), off by default. Turning it on enables the
  shop section of the site and shop links in posts. The threshold for turning it on is the operator's
  decision, supported by the F25 metrics.
- **F29** Shop: the author's own works only (never participants' works). Built on a ready platform or
  payment provider (decided in architecture). Requires a registered business and legal texts first
  (section 8, Q12).

## 5. MVP (done)

The MVP (F1-F11, F13-F16, Telegram only) went live on 2026-10-27; acceptance criteria A1-A9 of v4 were
met (docs/e2e-mvp.md). Acceptance criteria for later phases are defined in the tasks.

## 6. Phases

| Phase | Content | Status |
|---|---|---|
| 1 | MVP: bot, translation, Telegram publishing, content repo | done |
| 1b | F18 recurring posts (done), Instagram adapter, F19 contest (both after phase 2a) | in progress |
| 2 | F22-F24, F31 website on fadenundstimmung.de: site, canonical links, legal pages | next (first) |
| 2a | F30, F32 AI shows on virtual models, cost budget | after 2 |
| 2b | F20-F21 video from the author's new works (the show video of F30 is the first use) | after 2a |
| 3 | F25-F26 audience metrics and cross-promotion; F27 email capture (needs approval) | later |
| 4 | F28-F29 monetization switch and shop | when the audience is large enough |
| P | Offering for bloggers (business model decided after the circle case works, Q11) | later |

Presentation: a slide deck built from the author's photos and a guided Q&A, no third-party branding.

## 7. Non-functional requirements

- **Cost:** 0-10 EUR per month for hosting and AI API in phases 1-2. Video (phase 2b) may add rendering
  and AI cost; the budget is revisited in its architecture decision.
- **Hosting:** serverless webhook for the bot; static hosting for the site; video rendering in a
  separate job (it needs a headless browser and FFmpeg).
- **Stack:** TypeScript across bot, pipeline, site and video templates.
- **Security:** secrets only in `.env` and GitHub Secrets / platform secret store; least-privilege tokens.
- **Privacy:** GDPR applies. No participant or reader data in phases 1-2b. Texts and photos go to an
  external AI API, which must be listed in the Datenschutzerklärung. F27 is the first feature that
  stores personal data and needs explicit approval.
- **AI transparency (flag, not legal advice):** AI-generated text, images and video are marked by
  `provenance`; whether public labelling is required (EU AI Act transparency duties) is checked before
  phase 2b.
- **Branding:** only our own names. The host organization is not named anywhere until written permission.
- **Public repo hygiene:** no personal facts about the author's family, participants or readers in the
  repo, its history, or generated content.
- **Quality:** small reviewed PRs, tests for all logic, docs updated with every change.

## 8. Monetization and legal prerequisites

- Nothing paid is built before phase 4. The `offerings` config section stays empty until then.
- Before F27 (email) and F29 (shop) go live, Volodymyr decides, with professional advice: the country
  and form of business registration, tax status, consumer-law texts (terms, right of withdrawal),
  product-safety and packaging duties for shipped goods, and the updated privacy policy.
- The volunteer status of the circle stays separate from the author's own shop.

## 9. Non-goals and deferred features

Not built now, but supported by design (a new channel = a new adapter, no core changes):
- Facebook, Threads, TikTok, YouTube, X, Mastodon/Bluesky, nebenan.de, Meetup and others.

Non-goals in v6 (in addition to v5):
- No fully AI-generated works or product images; only real works are shown (F30).
- AI models are fictional; never a likeness of a real person.
- Participants' works and contest results are not shown on the site.
- No English site version for now.

Non-goals in v5:
- Participants never use the bot and are never contacted by the system.
- Participants' works are never sold, licensed or used outside the contest and its posts.
- No participant-facing bot (the v4 phase 3 "sign-up and submissions bot" is dropped).

Deferred (the architecture must not block them):
- **Web admin panel** as a second authoring interface next to the bot.
- **Scheduled publishing** (`publishAt` exists; always "now" today).
- **Fully AI-generated posts** (`provenance: ai-generated`, same preview and Publish step).
- **Instagram contest** for people outside the circle (docs/research/002-contests.md).
- **Tenant onboarding** for bloggers (sign-up, connecting channels, billing). Until then a tenant is
  added by configuration and secrets, by the operator.

## 10. Open questions

Resolved questions Q1, Q4-Q6, Q8 keep their v4 decisions (git history); Q7 is replaced by F19 in v5.
- **Q2** Resolved (2026-10-28): Impressum uses the author's home address. It is never committed to the
  repo; it is injected at site build time from secrets. The author confirms before the site goes live.
- **Q3** Resolved in architecture (ADR 006): AI provider for translation.
- **Q14** Resolved (2026-10-30): site purpose = the author's future business and portfolio; brand
  «Faden und Stimmung»; domain fadenundstimmung.de; DACH audience. *Flag, not legal advice: AI labels
  (AI Act art. 50), UWG (product image must match the product) and, for Switzerland, customs/VAT at
  shop time.*
- **Q15** Open (before the show pipeline): which try-on and video providers give acceptable quality
  for knitted/embroidered items, and what a show really costs. Decided in a spike with real photos.
- **Q9** Open (phase 2b): how the author hands a new work to the system for a video (photos, a clip,
  or both; one message or a guided flow).
- **Q10** Resolved (2026-10-28): goal priority unchanged (portfolio first).
- **Q11** Open (phase P): business model for bloggers (done-for-you setup vs self-service). Decides
  whether the MIT license stays for all modules or commercial modules move to another license or a
  private repo.
- **Q12** Open (before phase 4): country and form of business registration.
- **Q13** Resolved (2026-10-28): a contest post may show the participant's first name or nickname
  (no surname), only with her consent; without it the entry is anonymous ("Work No 3"). Names stay out
  of Git (F19). *Flag: a first name with a photo is still personal data; consent and withdrawal must be
  possible — not legal advice.*

## 11. Decisions from spec reviews

v4 (2026-10-21):
- The face-consent confirmation before Publish (F10) stays.
- Instagram is the author's personal account, switched to a professional (Creator) type for API
  publishing. The pipeline publishes only circle posts; nothing reads, edits or deletes posts it did
  not create. Handle and account IDs live in configuration secrets, not in the repo.
- Meetings every Thursday 14:00 Europe/Berlin (config); place wording "Landshut" without naming the
  host organization. Contest poll Monday 10:00 to Wednesday 20:00 (config).

v5 (2026-10-28): see section 14.

## 12. Product readiness: scalability and extensibility

The platform will be offered to bloggers and groups. These requirements make sure the current build
does not have to be rewritten for it.

- **N1 Tenant-aware.** Every entity (draft, post, entry, work, video, ledger, poll, config, secret
  reference) carries a `tenantId`. No global state shared between tenants.
- **N2 Pluggable channels.** Each network is an adapter behind one interface, registered by key, with
  declared capabilities (photos, polls, video). Core logic never imports a specific network.
- **N3 Pluggable content store.** "Git repository" is one implementation. Other tenants' content must
  never land in this public repo.
- **N4 Pluggable services.** Translation, text generation, video rendering, secret storage,
  scheduling, metrics, email and shop providers sit behind interfaces.
- **N5 Isolation and fairness.** Work is queued per tenant; a failing tenant does not block others.
  Idempotency keys include `tenantId`.
- **N6 Per-tenant settings and feature flags.** Languages, channels, schedule, contest, video, site
  theme, email, shop and monetization are configuration per tenant, not code.
- **N7 Observability.** Every publish, poll, render and AI call logs a structured event with `tenantId`
  and an entity ID (no message bodies, no tokens).
- **N8 Legal readiness (flag, not legal advice).** Serving other people makes Volodymyr a data
  processor: terms, data processing agreements, privacy policy and Meta App Review for third-party
  Instagram accounts are needed before the first external tenant (starting material:
  `../coachHelp/docs/legal/`).
- **N9 Submissions port.** A `SubmissionSource` port provides contest entries; the v5 implementation is
  "entries uploaded by the author via the bot".
- **N10 Reference case.** The circle tenant doubles as a demo: its site, channels and repo show the
  whole flow to prospective customers without exposing private data.

Not in scope now: sign-up, billing, tenant admin UI, per-tenant usage limits.

## 13. Glossary

- **Lead:** a person who agreed to hear from the author. Phases 1-2: channel followers and subscribers
  (held by the networks, no data on our side). Phase 3: email subscribers via a ready service.
- **Double opt-in:** an email sign-up is only valid after the person confirms it via a link sent to
  that address (required practice in Germany).
- **Funnel:** attract (content, contest, videos) -> engage (channel, weekly contest) -> capture (email,
  phase 3) -> convert (shop, phase 4).

## 14. Changes from v5 (v6)

- Vision v6 (POSSE): own site first, channels as linked copies; brand «Faden und Stimmung»; AI shows.
- F22 rewritten (German default, `/uk/`, shows, `/kreis/` page; contest winners removed from the site).
- F23 domain; new F31 canonical links, F30 shows, F32 AI cost budget (20 EUR, +5 tolerance).
- Phases re-cut: site (2) before shows (2a) before Instagram and contest (1b remainder).
- Q14 resolved, Q15 opened. Non-goals extended.

## 14b. Changes from v4 (v5)

- Vision rewritten (section 1): contest of participants' works, videos, author showcase site, funnel,
  monetization switch, resale to bloggers.
- New role Participant; participants never use the system; only an optional consented first name or
  nickname is stored, outside Git.
- F19 redefined: candidates are participant entries uploaded by the author, not the author's own posts.
- New F20-F29: video, website, audience metrics, email capture, monetization switch, shop.
- Phases re-cut (section 6). The v4 phase 3 participant bot is dropped.
- N1, N2, N4, N6, N9 extended; N10 added.
- New open questions Q9, Q11, Q12; Q10 and Q13 resolved in review.
