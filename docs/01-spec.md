# 01 — Spec

What we build and why: acceptance criteria and explicit non-goals.

Status: **approved v12 (2026-11-14).**
Previous: approved v11 (2026-11-14), v10 (2026-11-13), v9 (2026-11-13), v8 (2026-11-06), v7 (2026-11-04), v6 (2026-10-30).
Source: docs/00-interview.md, rounds 0-6, and the POSSE discussion (docs/STATUS.md, rounds 1-9, 2026-10-30).
Changes from v11 (v12) are listed in section 14-v12, from v10 (v11) in section 14-v11, from v9 (v10) in section 14-v10, from v8 (v9) in section 14-v9, from v7 (v8) in section 14, from v6 in 14a.

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

**Vision v7 (viability check, 2026-11-04).** The circle in Landshut already has enough
participants. The project now grows a social following for the brand across Instagram, Facebook,
Threads and Telegram, turns followers into email leads through the site, and later monetizes them
(for example an online shop). Legal safety comes first: nothing goes live that invites an Abmahnung.

Goals, in priority order (changed 2026-11-04, interview round 6):
1. **Audience and the author's business.** Grow followers across the networks and an email list for
   a later shop. Every new task answers "how does this add followers or save the author's time?".
   Targets after about 3 months: 160 Telegram subscribers, 1000+ Instagram followers (the
   participant target is dropped).
2. **Portfolio**, as a by-product: a live project with a real audience shows businesses in
   Germany/EU that Volodymyr can automate a real process end to end (bot, AI steps, publishing,
   media generation, CI/CD, tests, docs). Verification effort follows the risk of a change, not the
   maximum for every step.
3. **Resellable product.** The circle is the reference case of a platform for bloggers and groups. Not
   sold now, but the design must be ready for it (section 12) and the case must be convincing.
4. **Monetization** of the author's work: designed now (section 8), switched on later.

**Checkpoints.** First after 4 published shows (about mid-December 2026): do shows earn more views
and new followers than ordinary work posts? If not, no further investment in show generation. Main
check on 2027-01-21: follower counts per network. If the targets are far off, new features stop and
the time goes into maintenance and the portfolio case.

## 2. Users and roles

| Role | Who | Can do |
|---|---|---|
| Author | the circle lead (Volodymyr's wife) | send posts, contest entries and new works to the bot, edit, approve, publish |
| Operator | Volodymyr | configure tenants and channels, manage secrets, receive failure alerts, approve sensitive merges |
| Participant | circle members | hand their works to the author for the contest (offline or privately); post photos of their own works in the channel's Telegram discussion group on their own responsibility (F35); never use the bot or the system directly |
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
- **F36** Authenticity label (v9). Every publication whose photos or video show a real work in
  authentic media (taken by the author or a participant, not generated) carries the label
  "Оригінальна робота" / "Originalarbeit" on the site and in every channel caption (Telegram,
  Instagram, Facebook, Threads), and in the bot preview. It applies to posts of any type with at least
  one photo and to every `/work` work; posts without photos carry no label.
  - **No public AI note for authentic works.** `provenance` stays in the content files (F6) as an
    internal record, but `human` and `ai-assisted` are never shown publicly: the AI translation (F5) is
    reviewed and approved by the author, who keeps editorial responsibility. Only `ai-generated`
    content keeps a public AI note.
  - **Shows (F30)** keep "KI-generiertes Model" for the generated images and additionally carry
    "Originalarbeit" for the real work they present.
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
  - **Candidates.** The previous calendar week's approved entries, max 10, numbered 1..N in
    submission order (Monday opening includes the preceding Thursday's meeting entries).
  - **Poll.** At the configured opening time the bot drafts the poll post (album of candidates plus a
    Telegram poll "No 1".."No N" replying to it). The author publishes it. Channel polls are anonymous;
    no voter data is collected. (Poll capability: T21, done.)
  - **Close.** At the configured closing time the system stops the poll and reads the final counts.
  - **Winner.** Most votes. No votes, an unreadable result or a tie: the author picks among the (tied)
    candidates with buttons in the bot, and the post says so (changed 2026-10-28, replaces "AI picks").
  - **Result.** A result post announcing the winner is drafted for the author's Publish, for all
    channels.
  - **Other networks (v7).** Instagram, Facebook and Threads have no poll API. Each gets one numbered
    carousel post of the candidates; a vote is a comment with the work number. The bot reads the
    comments of that post through the network API, counts one vote per account per network, adds the
    Telegram poll counts and shows the author the total; she decides the winner. Commenter accounts
    are used only for counting and are never stored after the result. No prizes, so no contest terms
    are needed; adding a prize later needs terms and the Meta disclaimer first.
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
    art. 50); captions say "KI-generiertes Model"; the real work is labelled "Originalarbeit" (F36).
  - **Real people (Q16, F37).** Real photos and video of the author or Volodymyr in a show are
    authentic media (F37), never mixed up with generated images.
- **F37** Authentic media in a show (v10 draft, Q16/Q18). **Withdrawn for new shows 2026-11-14
  (Volodymyr, T57):** the author's own photos and video belong to the work (F39, `/work`); a show
  carries only generated media. Already published shows with authentic media stay as they are. The author may add her own photos and one
  short video of the work to a show, next to the generated images and video.
  - **What counts.** Media taken by the author (or Volodymyr) of the real work: on a hanger, worn by
    the author, worn by Volodymyr, in a room. Nothing generated or AI-edited. People who may appear:
    only the author and Volodymyr. Participants, children and any other person never appear; the
    author confirms this with a button before approval (like the face-consent step, F10).
  - **How many.** 0-3 photos and 0-1 video per show; the show keeps its 3-5 generated images and one
    generated video. Total per show at most 10 media items (Telegram album and Instagram carousel
    limit). The author's video: MP4/MOV sent to the bot, at most 60 s and 20 MB (the Bot API download
    limit); longer or larger clips are refused with a clear message.
  - **Hand-over (UX).** In the `/show` session, after the generated preview, one optional step:
    «Додати свої фото/відео» or «Пропустити». The author sends the files, sees them in the preview in
    a separate block «Оригінальна робота», can remove any of them, then approves the whole show. The
    step can also be reopened before approval. No AI call is made on authentic media, so it costs
    nothing (F32).
  - **Order and labelling.** Authentic media come first. On the site the show page has two blocks:
    «Оригінальна робота» / «Originalarbeit» with the authentic media, without any AI marker, then the
    generated images and video with "KI-generiertes Model" (F30). In channels the album/carousel lists
    the authentic items first, the generated items after them; when a show has authentic media the
    caption keeps both lines (F36) and adds "KI-generierte Bilder ab Bild N" / «Згенеровані ШІ кадри
    з кадру N», so every image is identifiable.
    Videos follow the existing show video rule: Telegram sends them as replies to the album (authentic
    video first); Instagram, Facebook and Threads do not copy show video yet. Generated items keep their visible
    and machine-readable marker (F30), authentic items never get one.
  - **Storage.** Authentic media are stored in the show's content folder as a separate list with
    `provenance: human`, `kind: photo | video` and `people: none | author | operator | both`; they never go
    into the generated `images`/`video` lists, and the schema rejects a file in both. Location and
    camera metadata (EXIF/GPS, video metadata) are removed before storage. They are not resized or
    re-encoded beyond that, the same rule as for marked bytes.
  - **Retry and removal.** Publishing stays idempotent (F11). Removing an authentic item after
    publishing follows the existing show correction path; channel posts are not edited automatically.
- **F39** Author's own video in a work (v11, approved by Volodymyr 2026-11-14). A `/work` work may carry one short
  video of the real work taken by the author, published on the site and in every channel without
  any AI generation. This is how the author publishes her own video instead of a generated one.
  - **What and how many.** 0-1 video per work, next to its 1-N photos (photos stay required: the
    site cards and collection covers use them). MP4/MOV sent to the bot as a Telegram video, at most
    60 s and 20 MB (Bot API download limit); longer or larger clips and files sent as documents are
    refused with a clear message. Same people rule as F37: only the author and Volodymyr may appear,
    confirmed with a button before approval.
  - **Hand-over (UX).** In the `/work` session, after the photos, one optional step «Додати відео» /
    «Пропустити». The preview shows the video; the author can replace or remove it before approval.
    No AI call is made on the video, so it costs nothing (F32).
  - **Labelling.** The video is authentic media: "Оригінальна робота" / "Originalarbeit" (F36), no AI
    marker.
  - **Where it goes.** Site: the work page shows the video after the photos (`<video controls
    playsinline>`, no autoplay, no third-party player). Telegram: the photo album, then the video as a
    reply to it (same rule as show videos). Instagram: the photo carousel, then the video as a Reel
    with the same caption. Facebook: the photo post, then the video as a Page video post with the same
    caption. Threads: the video is the last item of the photo carousel. Publishing stays idempotent
    (F11): the photo post and the video post are separate ledger entries.
  - **Storage.** The video lives in the work's content folder as `video` (`fileName`, `provenance:
    human`, `people`); location and camera metadata are removed by a lossless remux, never
    re-encoded (same rule as F37).
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
  - **Legal**: Impressum and Datenschutzerklärung, linked from every page footer (see Q2 and
    section 8).
- **F23** The site is rebuilt and deployed automatically after each publish, on the custom domain
  fadenundstimmung.de. Site look and texts come from tenant configuration (theme, logo, languages), so
  another tenant gets its own site without code changes.
- **F31** Canonical links (POSSE): every channel post of a site-worthy item links to its page on the
  site. The post id is stable, so the URL is known before the site rebuild.
- **F38** Profile links (approved by Volodymyr 2026-11-13). The site footer links the brand's social
  profiles as plain text links (network names, no third-party logos, no widgets, embeds or share
  buttons). Only profiles listed in tenant configuration are shown; for faden-und-stimmung that is
  Instagram and Telegram (Facebook and Threads are added once they are active). The order follows
  the page language: Instagram first on German pages, Telegram first on Ukrainian pages. Links carry
  `rel="me"`, and the home page states the same profiles as schema.org `sameAs`. The newsletter stays
  the site's main call to action; profile links never appear in the header or on work cards.
- **F40** Cloth look (v12, approved by Volodymyr 2026-11-14). Every page of the site looks like an
  unrolled scroll of homespun cloth, so the site reads as a craft workshop. Reference mockup:
  `docs/design/site-cloth/index.html` (home page; the other pages follow the same parts).
  - **Roll**: the header is a round bolt of cloth with the site name, navigation and language
    switch. It stays at the top of the screen; the cloth comes out from under it, and the surface
    of the roll moves with the scroll so the roll reads as turning.
  - **Cloth**: one centred strip of unbleached linen drawn in code (faint weave, a tighter selvedge
    on both sides, a hem and a fringe at the end of the page). No photo texture. Behind it a dark
    blue ground; the footer sits on the ground below the fringe.
  - **Seam**: a red running stitch down the left edge of the cloth, sewn by a needle as far as the
    visitor has scrolled; it stops before the fringe. It is the only motion that is not a direct
    hover or focus response.
  - **Name**: on the home page the heading is the name in the author's own handwriting, in the red
    thread colour, with the name as text for assistive technology and search engines. A tenant
    without a handwriting asset gets the name set in the display typeface.
  - **Photos and video**: shown whole, never cropped, as patches sewn on with a linen-coloured
    running stitch and a slight tilt that straightens on hover and focus.
  - **Type and colour**: display typeface Gabriela, body Onest, both self-hosted with Latin and
    Cyrillic. Text is a dark blue related to the ground. Three colours carry the page: linen, blue,
    red thread.
  - **Rules**: colours, typefaces and the handwriting asset come from tenant configuration (F23),
    nothing brand-specific in code. No third-party requests. Without JavaScript and with reduced
    motion the page is complete: the seam is shown fully sewn and the roll does not move. Text
    contrast meets WCAG AA; keyboard focus stays visible; no horizontal scroll from 320 px up.
  - Acceptance: home, shows (list and page), works and collections (list and page), post, circle,
    gift, legal and 404 pages in both languages use the look and pass the rules above at 390 px
    and 1280 px widths.
- **F24** Collections and works are content types in the content store, created through the bot like
  posts (the author sends photos and a short note; AI drafts the description; she approves).

### Social networks (phase 1b, v7)
- **F33** Instagram, a Facebook Page and Threads are built together as three channel adapters behind
  one Meta app and one setup step (H8), not one by one. All three get the same German copy of each
  site-worthy item with the canonical link where the network allows it (otherwise "link in bio").
  Caption rules (ported from instagram-agent-skill, MIT, with attribution): the first ~125 characters
  carry the message, at most 5 hashtags, no stock phrases. Shows and multi-photo posts go out as
  carousels; every Instagram image, single or carousel, is framed 4:5 (1080x1350, padded, never
  cut), since Instagram rejects feed images outside 4:5..1.91:1. Every profile links to the Impressum.
- **F34** Comment inbox: the bot collects new comments on our own posts from Instagram, Facebook and
  Threads and sends them to the author in Telegram with a Ukrainian translation and a drafted German
  reply (reply rules ported from `/ig-reply`). She sends, edits or skips; nothing is posted without
  her press. Comment text and the commenter's handle are personal data of readers: kept only until
  the comment is handled (at most 30 days), never in Git, listed in the Datenschutzerklärung.
- Weekly planning and post-mortems (`/ig-plan`, `/ig-audit`) are not built: Volodymyr runs those
  skills himself in Claude Code.

### Community: participants' photos (F35)
- **F35** Participants post photos of their own works themselves, without the author.
  - **Where.** A Telegram discussion group linked to the channel. Every channel post gets comments;
    participants answer with photos and text, and can also post in the group itself. The channel
    stays author-only: only her (and the bot's) posts appear in the channel feed.
  - **Zero author effort.** No pre-moderation, no approval queue, no notifications for the author.
    Spam is kept out by Telegram's own group settings (only members may comment, photos and text
    only, link previews off, slow mode, Telegram's built-in anti-spam) and by the pinned rules.
    Telegram cannot block plain-text links or forwards by setting, so the no-links rule rests on
    anti-spam, Volodymyr's moderation and the rules. Volodymyr is the admin who handles reports; the author is not an admin of the group unless she wants to be.
  - **Responsibility.** Pinned group rules (German and Ukrainian, the author approves the wording):
    post only your own works; no faces or names of other people without their consent; no ads; you
    keep the rights to your photos and are responsible for what you post. Posting means accepting
    the rules. *Flag, not legal advice: the rules move responsibility for content to the poster, but
    the group operator still has to remove clearly unlawful content once notified (notice-and-action duty
    under the DSA/DDG) and needs a reachable contact; the Impressum covers that.*
  - **Outside our system.** The bot is not a member of the group and never reads it. Nothing from
    the group reaches D1, Git, the site, Instagram or the contest; the platform stores no new personal
    data. Contest entries stay as in F19 (through the author).
  - **Convenience for participants.** One link in the channel description, on `/kreis/` and in the
    pinned channel post ("Zeig deine Arbeit"); comments open under every post.
- Acceptance: a participant can comment with a photo under a channel post and in the group without
  any action by the author; a non-member cannot, and link spam is limited by anti-spam, slow mode and moderation; the Datenschutzerklärung names the
  group.

### Funnel and audience (phase 3)
- **F25** Weekly audience metrics per channel (follower and subscriber counts, per-post reach where the
  API provides it) are collected without any personal data and shown to the operator and author.
  Until then: Cloudflare server-side zone traffic statistics for the site (no script, no device
  access, no consent banner; changed 2026-11-04 from the Web Analytics beacon because of §25 TDDDG)
  and manual Telegram view counts per post.
- **F26** Each channel and the site link to each other (cross-promotion), configured per tenant.
- **F27** Email capture: a sign-up form on the site via a ready email service with double opt-in
  (EU hosting and a data processing agreement). Addresses live only in that service, never in the
  repo. Lead magnet: a free embroidery pattern (PDF) by the author, sent after confirmation. Approved
  in principle by Volodymyr (2026-11-04); goes live only with the updated Datenschutzerklärung.
- **Funnel (v7):** networks (shows, works, contest) -> site page with one call to action -> email
  sign-up -> Telegram channel as the warm step -> shop later, offered to the email list first.

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
| 2 | F22-F24, F31 website on fadenundstimmung.de; legal pages and site analytics first | in progress |
| 2a | F30, F32 AI shows on virtual models, cost budget | done (live check pending) |
| 1b | F18 recurring posts (done); F33 Instagram, Facebook, Threads; F34 comment inbox; F19 contest | after the end-to-end check |
| 3 | F27 email capture with lead magnet; F25-F26 metrics and cross-promotion | after the Meta channels |
| 2b | F20-F21 video from the author's new works (the show video of F30 is the first use) | later |
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
  external AI API, which must be listed in the Datenschutzerklärung. Reader data appears only in F34
  (comments, kept until handled) and F27 (email, held by the email service); both are listed in the
  Datenschutzerklärung before they go live.
- **AI transparency (flag, not legal advice):** AI-generated text, images and video are marked by
  `provenance`; whether public labelling is required (EU AI Act transparency duties) is checked before
  phase 2b.
  v9: AI-assisted translation of an author-approved text is not labelled publicly (author's editorial
  responsibility; EU AI Act art. 50(4) exception, to be confirmed). Generated images of people stay
  labelled.
- **Branding:** only our own names. The host organization is not named anywhere until written permission.
- **Public repo hygiene:** no personal facts about the author's family, participants or readers in the
  repo, its history, or generated content.
- **Quality:** small reviewed PRs, tests for all logic, docs updated with every change.

## 8. Monetization and legal prerequisites

- Nothing paid is built before phase 4. The `offerings` config section stays empty until then.
- **Protection first (v7).** Before anything goes public: Impressum and Datenschutzerklärung from a
  free generator by lawyers (not AI-written text), every processor listed, no third-party fonts,
  embeds or trackers on the site, Impressum linked from every profile. AI-made images are labelled.
- **Address.** While there are no sales, the Impressum uses the author's home address (Q2). At the
  first sale: switch to an address service with a serviceable address and to lawyer-maintained legal
  texts.
- Before F29 (shop) goes live, Volodymyr decides, with professional advice: the country
  and form of business registration, tax status, consumer-law texts (terms, right of withdrawal),
  product-safety and packaging duties for shipped goods, and the updated privacy policy.
- The volunteer status of the circle stays separate from the author's own shop.

## 9. Non-goals and deferred features

Not built now, but supported by design (a new channel = a new adapter, no core changes):
- TikTok, YouTube, X, Mastodon/Bluesky, nebenan.de, Meetup and others (Facebook and Threads moved
  into scope in v7, F33).
- Automated planning, Stories and DMs; the instagram-agent-skill is used manually by Volodymyr.

Non-goals in v6 (in addition to v5):
- No fully AI-generated works or product images; only real works are shown (F30).
- AI models are fictional; never a likeness of a real person.
- Participants' works and contest results are not shown on the site.
- No English site version for now.

Non-goals in v5:
- Participants never use the bot and are never contacted by the system.
- Participants' works are never sold, licensed or used outside the contest and its posts.
- No participant-facing bot (the v4 phase 3 "sign-up and submissions bot" is dropped).

Non-goals in v10:
- No show made only of authentic media (that is a `/work` post, F36).
- No AI editing, retouching or upscaling of authentic media.
- No people other than the author and Volodymyr in authentic media.

Non-goals in v8:
- The system never reads, stores, moderates or re-publishes posts from the discussion group (F35).
- No pre-moderation by the author; participants' photos are not copied to the site or other networks.

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
- **Q10** Resolved again (2026-11-04): audience and the author's business first, portfolio as a
  by-product (section 1).
- **Q16** Resolved in v10 (Volodymyr, 2026-11-13, F37): real people (only the author and Volodymyr) appear only in
  authentic media of a show, stored as a separate list, not as a new content type.
- **Q18** Resolved in v10 (Volodymyr, 2026-11-13, F37): the author's own photos (0-3) and video (0-1) in a show, labelled
  "Originalarbeit". *Flag, not legal advice: photos of the author and Volodymyr are their own personal
  data, published with their consent; AI Act art. 50 marking stays on each generated item.* Volodymyr
  accepts this working assessment.
- **Q11** Open (phase P): business model for bloggers (done-for-you setup vs self-service). Decides
  whether the MIT license stays for all modules or commercial modules move to another license or a
  private repo.
- **Q12** Open (before phase 4): country and form of business registration.
- **Q17** Agreed (Volodymyr, 2026-11-06); working answer, *not legal advice*. The lawyer
  questions on the fal DPA and Art. 9 stay open separately. Question: does running the linked Telegram group make the operator a joint
  controller with Telegram (as for Facebook fan pages, CJEU C-210/16)?
  - Assessment: joint controllership is possible but less likely than for a fan page. The operator
    sets up the group and its rules, but gets no analytics of visitors and does not decide Telegram's
    purposes. The operator is still the controller for what it does itself (sees member names and
    profiles, removes content, keeps the rules); the household exemption does not apply to a group
    open to the public.
  - Decision for go-live: act as if the operator is at least responsible for its own part. The
    Datenschutzerklärung names the group, says Telegram processes members' data under its own
    responsibility (Telegram FZ-LLC, possible transfer to third countries), states that the operator
    sees only what members show in the group, stores nothing from it (F35) and removes content on
    notice, and links Telegram's privacy policy and the Impressum contact. The paragraph is written
    in T50 and marked for Volodymyr's and the author's review.
  - The same reasoning already applies to the existing channel.
  - Go-live of the group does not wait for the lawyer; the lawyer's confirmation is requested before
    the group is promoted widely.
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

- **Lead:** an email subscriber who confirmed the sign-up (double opt-in). Followers and channel
  subscribers are the audience before that step (held by the networks, no data on our side).
- **Double opt-in:** an email sign-up is only valid after the person confirms it via a link sent to
  that address (required practice in Germany).
- **Funnel:** attract (shows, works, contest on all networks) -> engage (comments, Telegram channel) ->
  capture (email with lead magnet) -> convert (shop, phase 4).

## 14-v12. Changes from v11 (v12, approved 2026-11-14)

- New F40: the cloth look for every page of the site (roll header, linen cloth, sewn red seam,
  handwritten name, uncropped sewn-on photos, Gabriela and Onest, dark blue ground).
- Architecture impact (for T60 tasks): `site.theme` gains `ground` and `thread` colours and an
  optional handwriting asset; `rule` is retired in favour of `thread`; the bundled Latin family
  Familjen Grotesk is replaced by Gabriela (display) with Onest as body for both scripts; one small
  inline script drives the seam and the roll.

## 14-v11. Changes from v10 (v11, approved 2026-11-14)

- New F39: the author's own video (0-1, at most 60 s / 20 MB) in a `/work` work, added in an optional
  step, published on the site and in all four channels without AI generation; only the author and
  Volodymyr may appear; metadata stripped by remux.
- Architecture impact (for T55 tasks): work schema gets an optional `video`; bot `/work` session step;
  publisher downloads, strips and commits the video; site work page; Telegram reply, Instagram Reel,
  Facebook video post, Threads carousel item.

## 14-v10. Changes from v9 (v10, approved 2026-11-13)

- New F37: the author's own photos (0-3) and video (0-1, at most 60 s / 20 MB) in a show, added in an
  optional `/show` step, shown on the site and in channels before the generated items as
  "Originalarbeit"; only the author and Volodymyr may appear; metadata stripped; no AI cost.
- Q16 and Q18 get a proposed answer (F37). New non-goals for v10.
- Architecture impact (for T53 tasks): show schema gets an authentic-media list; bot `/show` session
  step; media pipeline for video download and metadata stripping; site show page block; channel
  renderers order items and add the caption line.

## 14-v9. Changes from v8 (v9, approved 2026-11-13)

- New F36: "Оригінальна робота" / "Originalarbeit" on every publication with authentic media (site,
  all channels, bot preview); no public AI note for human or AI-assisted texts; shows keep their AI
  model note and also carry the label. AI transparency note updated. Q18 added.
- No architecture change: rendering only; `provenance` data unchanged.

## 14. Changes from v7 (v8, approved 2026-11-06)

- New F35: participants post their own photos in a Telegram discussion group linked to the channel;
  comments open; no author moderation; the system stays out of the group.
- Participant role widened accordingly; new non-goals; Q17 (joint controllership) added.
- No architecture change: no new port, adapter, storage or bot permission.

## 14a. Changes from v6 (v7)

- Vision v7 and goal order: audience and business first, portfolio as a by-product; participant
  target dropped; checkpoints after 4 shows and on 2027-01-21.
- New F33 (Instagram, Facebook, Threads together) and F34 (comment inbox with author approval).
- F19 extended to all networks (comment votes, no prizes); F25 interim site analytics; F27 approved in
  principle with a lead magnet; legal "protection first" rules in section 8.
- Phases re-ordered: legal pages, then an end-to-end check, then the Meta channels, email, contest.
- Q10 resolved again, Q16 added. Facebook and Threads removed from the deferred list.

## 14b. Changes from v5 (v6)

- Vision v6 (POSSE): own site first, channels as linked copies; brand «Faden und Stimmung»; AI shows.
- F22 rewritten (German default, `/uk/`, shows, `/kreis/` page; contest winners removed from the site).
- F23 domain; new F31 canonical links, F30 shows, F32 AI cost budget (20 EUR, +5 tolerance).
- Phases re-cut: site (2) before shows (2a) before Instagram and contest (1b remainder).
- Q14 resolved, Q15 opened. Non-goals extended.

## 14c. Changes from v4 (v5)

- Vision rewritten (section 1): contest of participants' works, videos, author showcase site, funnel,
  monetization switch, resale to bloggers.
- New role Participant; participants never use the system; only an optional consented first name or
  nickname is stored, outside Git.
- F19 redefined: candidates are participant entries uploaded by the author, not the author's own posts.
- New F20-F29: video, website, audience metrics, email capture, monetization switch, shop.
- Phases re-cut (section 6). The v4 phase 3 participant bot is dropped.
- N1, N2, N4, N6, N9 extended; N10 added.
- New open questions Q9, Q11, Q12; Q10 and Q13 resolved in review.
