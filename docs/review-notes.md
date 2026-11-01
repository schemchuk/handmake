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
- Site: a post with no German text is not shown on `/` (no language fallback); T36d applies the same policy to works and collections, including detail routes and navigation (T35 review).
- Site: T36d optimizes work/collection photos with responsive WebP copies while retaining originals. Regular blog photos remain unresized (T35 review).

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
- A collection's `cover` (`{ workId, fileName }`) is not checked by the low-level writer. T36c1 creates a new collection with its first work and first photo as cover; the site (T36d) fails the build on a dangling cover, missing collection or missing declared photo.
- If a save crashes after the photos but before `index.md`, `listWorks` fails with "missing document" until a retry of the same publish completes the work.
- Flat Git paths need globally unique work ids and collection slugs; a foreign-tenant write fails instead of overwriting.

## Work text generation (T36b)
- T36c2 uses `textGeneratorFor(tenantId, workId)` through `createWorkDraftFlow`, persisting per-language baselines/metadata. T36c3 must wire the flow into the authorized background/session handlers; no `/work` entry point yet.
- A failed required ledger write rejects the generation/translation. Paid calls whose usage could not be persisted need manual billing reconciliation; no application retry after a bookkeeping/output failure or zero-cost record is made by the work flow. SDK transport retries retain the existing two-retry policy.
- Both work text operations use the tenant's `ai.translation` model and manually supplied EUR rates; T43 still verifies rates. Existing post-translation model/pricing and best-effort behavior remain as noted under T42. Prompt-cache tokens remain unaccounted for.
- Work text costs have `ref: work:<id>`; they contribute to monthly/service totals but not the existing `show:` subtotal. They are not rebooked when a later show uses that work.
- (T36b review, decided by Volodymyr 2026-11-01) Provenance of generated work descriptions is set at approval: text the author edited is `ai-assisted`; text approved unchanged is `ai-generated`. The DE version is `ai-assisted` if the UA text was edited, otherwise `ai-generated`. T36c compares the generated draft with the approved text and stores the result in the work's `versions`.
- (T36b review, agreed by Volodymyr 2026-11-01; implemented T36c2) The staged generator and work draft flow checkpoint UA before DE. DE failure/restart retries only translation; the UA baseline and per-language model/prompt metadata remain in `extras.work`.

## Work publication (T36c1)
- T36c2/T36c3 must build a `kind: work` job with required `work` metadata; `texts` must exactly match `work.versions` descriptions. Top-level `provenance` remains for post compatibility and is not used for work versions.
- Work/collection versions must cover exactly the configured tenant languages. Empty `work.channels` means no announcements; non-empty lists must contain unique enabled channel names. Both new collection and work are committed before delivery; no separate blog post is created.
- The publisher rejects changed work metadata or channel selection on a retry. A collection slug created by another work cannot be reused as `newCollection`; select the existing collection instead. Flat-path cross-tenant collision checks remain in the store.
- Publisher work callbacks require the bot version accepting `kind: work`; deploy only when explicitly authorized. Until T36c3 no `/work` entry point is exposed. Site pages remain T36d; a stored work is not yet a rendered page.

## Work draft recovery (T36c2)
- T36c3 must use `createWorkDraftFlow.configure` with a current `StoredDraft`, then `generate` behind the allow-list gate and background runner. Work DE regeneration uses `generate(tenantId, draftId, true)`; it translates current UA without regenerating UA.
- `buildApprovedWorkJob` must receive the freshly claimed publishing draft, not a stale preview. It requires both generated baselines, uses `createdAt` for stable publication date, compares UA exactly and preserves approved text/model/prompt metadata.
- An uncertain UA attempt (API/accounting failure or lost checkpoint) retains `uaPending`; retry/configuration is blocked for manual billing/result reconciliation. T36c3 must surface that failure clearly and must not clear the marker automatically. No database can reconstruct an API result lost before its checkpoint.
- Template/collection cannot be changed after UA generation; announcement channels/new-collection metadata can be configured without losing baselines. A hand-written DE fallback without a generated DE baseline cannot be approved through the work helper; T36c3 must route recovery explicitly.
- (T36c2 review) Any failed UA call, including a transient network error with no billing, leaves `uaPending` set and blocks the draft. The author has no way to clear it, so T36c3 must offer a clear "discard and start over" path (and tell the operator to check billing), not only an error message.
- (T36c2 review) Approved provenance is computed from UA only, as decided: if the author edits only the German text, DE keeps `ai-generated`. This over-labels rather than under-labels AI use, so it is acceptable.

## Work session (T36c3)
- `/work` resumes its active work draft or collecting work; older ready drafts remain reachable through their own preview buttons after switching sessions. `/new` reattaches an existing collecting post. New-collection input uses one line per localized title/description; identifiers are generated, never typed by the author.
- The public collection reader surfaces HTTP/rate-limit, malformed-content and oversized-list failures; it has no stale-cache fallback. The [Contents API directory cap](https://docs.github.com/en/rest/repos/contents#get-repository-content) is checked rather than silently truncating the menu. Large catalogues may need pagination/concurrent reads in a later task.
- Redeploy the bot only with Volodymyr's explicit authorization. Site pages remain T36d; no deploy was run in T36c3.
- (T36c3 review) The collection reader calls the unauthenticated GitHub Contents API from a Worker; GitHub limits that per IP (60/hour) and Worker egress IPs are shared, so the menu can fail with a rate-limit error. The author sees "could not select collection, try /work again". If this happens in practice, send the existing GitHub token or read a generated index file instead. It also reads each collection file in sequence (one subrequest per collection).
- (T36c3 review) `/work` on a draft in `publishing` state answers "description not finished" (the retry text). Harmless, but misleading; use the "busy" text if touched.
- (T36c3 review) Announcement "yes" selects every channel in the tenant config, including `instagram` once configured. Check that the publisher can deliver to it before T26-T34 enable it.

## Show contracts (T44a)
- (T44a review) No blockers; CI green, core tests 205 passed. T44b must check that a show's `workId`, tenant, `originals` file names and generated media bytes really exist, and that `versions` cover exactly the tenant languages (the schema only checks shape).
- (T44a review) Show `images[].prompt` and `video.prompt` hold the prompt version (e.g. `worn@1`), while the port calls it `promptVersion`. Pick one name in T44b/T44d so the stored field and the call result map without a rename.
- (T44a review) `showSchema` does not tie `model` (snapshot) to the tenant `shows.models` list or `images[].model` to `shows.image.model`; that consistency belongs to the T44c orchestration, not the schema.
- (T44a review) Marker declarations are shape-only by design; T44d must verify the bytes before approval. `eurPerImage`/`eurPerSecond` are operator estimates until reconciled with fal billing (ADR 015 pre-production check).
- (T44a review) Test title "requires a persona except for %s interior" reads oddly for `worn`/`closeup`; cosmetic.
