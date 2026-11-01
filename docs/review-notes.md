# Review notes carried forward

Open findings from past reviews that a later task must handle. Read only the entries for the area your
task touches (ADR 009). Delete an entry in the PR that resolves it.

## Publisher and ledger
- T10: run `processPhoto` on every MediaSource result before `savePost` (the store writes bytes as given; PR #11 note 1). `MediaSource` returns raw bytes; the publish pipeline calls `processPhoto` once for every source (PR #9 review note 1).
- Ledger: guard `markOpDelivered` on a `done` channel; restore an immutability assertion (PR #8 re-review).
- Ledger path `content/ledger/<postId>.json` has no tenant; revisit with a second tenant (PR #11 note 2). Folder date is UTC; align with scheduled publishing (note 3).

## Runbook (T17)
- 5xx and network errors are not retried in-process, the ledger re-run covers them (PR #10 review note 4). Document the small at-least-once window between a send and the ledger write (PR #8 review note 3).
- Bot: a DB write that succeeded with a failed reply lets a Telegram retry re-append text (at-least-once window, PR #22).

## Content store
- F19 (work of the week): `ContentStore.listPosts` now exists (T35, ADR 016); use it when candidates are built (PR #6 review note 3).
- Site: a post with no German text is not shown on `/` (no language fallback); a work without a translation needs the same decision (T35 review).
- Site: photos are published unresized; add an optimization step before the show pipeline (T35 review).

## CI
- gitleaks-action needs `GITLEAKS_LICENSE` if the repo moves to an organization.

## Bot drafts (T25)
- Drafts created before migration 0006 have no `chat_sessions` row: `/done` and legacy buttons on such a draft answer "no draft" until the author sends new text or photos (which re-attaches the collecting draft). Production had no collecting or ready drafts at merge time (2026-10-30), so this only matters for a restored backup (PR #32 review).
- Two drafts from 2026-10-27 (before the T19 published callback) are stuck in `publishing` although their posts and ledgers exist. Harmless; delete them by hand or let a cleanup that covers `publishing` remove them.

## Polls (T21)
- The poll message id sits at op index 1 or 2 (depends on caption overflow). T22 and the closing cron must find it by op kind (`kind === 'poll'`), not by a fixed index (PR #31 N1).
- Bot API now allows 1-12 options and media on a poll option (`InputPollOption.media`), which weakens ADR 008's "polls cannot carry images". MVP keeps album + poll; revisit in a later ADR (PR #31 N2).

## AI cost ledger (T42, PR #34)
- `assertCanStartShow` and `costLimitText` are not invoked by a production flow until T44 adds the show entry point and budget gate.
- All existing allow-listed users are operators (Volodymyr, 2026-10-31); no separate operator role.
- Notices claim before sending: a crash between claim and delivery can lose a notification; consider expiring claims in a later task.
- Translation model and configured prices are not validated against each other.
- When SDK `messages.parse` throws, paid usage is not recorded because no parsed response reaches the usage hook. T36b work translation surfaces this as an accounting-uncertain failure (never zero usage); reconcile provider billing manually. UA generation uses SDK `messages.create` and books returned usage before validating JSON. Transport/SDK failures without a response still have unknown usage; T36b cannot reconstruct it.
- Any tenant-config refresh failure uses the last-known config without notifying the operator; cold failures fall back to the default translator without accounting. Diagnostic warnings are logged.
- `aiRuntime()` is constructed three times along the scheduled path; consolidate in a later task.
- Prompt-cache read/write tokens are not accounted for; EUR prices are entered manually and need verification in T43.

## Site workflow (T39, PR #35)
- A failure of the `site` job in `publish.yml` raises no Telegram alert (the alert covers only the `publish` job). The post is already published; re-run the failed job. Consider an operator alert in a later task.
- Test-channel publish runs also commit a post and trigger the site deploy, so test posts reach the site. Harmless while the site is `noindex` and has no domain; decide before T41 whether to filter them.
- Deploy runs after channel delivery, so a "Mehr auf der Website" link (T40) can briefly point to a page that does not exist yet. T40 must account for this.
- First deploy must be started by hand (Actions → Site → Run workflow on `main`) to confirm locked Wrangler 4.152.0 does not need `--force` for the existing Pages project.

## Works and collections (T36a, PR #36)
- `buildWorkFromPayload` does not check languages against `tenant.languages` (it has no tenant input); T36c must validate them when it wires dispatch.
- A collection's `cover` (`{ workId, fileName }`) is not checked for existence at write time. T36c should create a new collection together with its first work and use that work's photo as cover; the site (T36d) must fail or skip loudly on a dangling cover.
- If a save crashes after the photos but before `index.md`, `listWorks` fails with "missing document" until a retry of the same publish completes the work.
- Flat Git paths need globally unique work ids and collection slugs; a foreign-tenant write fails instead of overwriting.

## Work text generation (T36b)
- T36c must call `textGeneratorFor(tenantId, workId)` and persist returned per-language provenance/model/prompt metadata in the draft; approval remains separate. No `/work` wiring in T36b.
- A failed required ledger write rejects the generation/translation. Paid calls whose usage could not be persisted need manual billing reconciliation; no application retry after a bookkeeping/output failure or zero-cost record is made by the work flow. SDK transport retries retain the existing two-retry policy.
- Both work text operations use the tenant's `ai.translation` model and manually supplied EUR rates; T43 still verifies rates. Existing post-translation model/pricing and best-effort behavior remain as noted under T42. Prompt-cache tokens remain unaccounted for.
- Work text costs have `ref: work:<id>`; they contribute to monthly/service totals but not the existing `show:` subtotal. They are not rebooked when a later show uses that work.
- (T36b review) Both language versions are marked `ai-assisted`. T36c should set provenance at approval: text the author did not edit is closer to `ai-generated` (AGENTS.md provenance rule); decide with Volodymyr.
- (T36b review) If the UA draft succeeds and the DE translation fails, the UA draft is not returned, so a retry pays for UA again. T36c may keep the UA text in the draft and retry only the translation.
