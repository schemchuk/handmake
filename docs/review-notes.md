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
- (T44a review) Marker declarations are shape-only by design; T44d must verify the bytes before approval. `eurPerImage`/`eurPerSecond` are operator estimates until reconciled with fal billing (ADR 015 pre-production check).
- (T44a review) Test title "requires a persona except for %s interior" reads oddly for `worn`/`closeup`; cosmetic.

## Show publication (T44b)
- (T44b review) Generated media reach the publisher as Telegram file ids (`TelegramMediaSource.fetchMedia`). The Bot API `getFile` downloads files up to 20 MB only; T44c rejects raw outputs above 20 MB; T44d/T44e must recheck after marking/ingestion or add another transport.
- (T44b review) A show folder without `index.md` (interrupted save) keeps its already written media, and a retry with different bytes fails as "immutable". If T44e lets the author regenerate after a failed approval, it needs a new show id or a cleanup path for the incomplete folder.
- (T44b review) The bot approval path throws for `kind: show` drafts until T44e wires the show approval; no show drafts can be created before then.
- (T44b review) `apps/bot` test "completes a site-only work idempotently" failed once in a full local run and passed alone twice; likely a timeout under load, not a defect. Watch it in CI.

## Show generation (T44c)
- (T44c review) No blockers; CI green, bot 249 and core 213 tests pass. `recordCost` is `INSERT OR IGNORE` on `(tenant_id, id)`, so rebooking by `callId` on recovery is idempotent; T44d must give every real call a provider-unique `callId`.
- (T44c review) The whole show (3-5 images + video, sequential) runs in one `generate` call. T44e must run it in a way that survives the Worker time limits (queue or resumed invocations); checkpoints make a resume safe.
- (T44c review) An uncertain outcome (pending marker without a durable result) keeps the tenant lock and the draft in `failed`; nothing clears it. T44e needs an explicit operator/author "discard after reconciling" path, like the T36c2 `uaPending` note.
- (T44c review) The lock timestamp is set only at acquire and not refreshed during a run; the stale takeover relies on the draft's `updatedAt` check. If a flow ever exceeds ten minutes with no checkpoint, a second `generate` for the same draft could take over. Refresh the lease per checkpoint if calls get slower.
- (T44c review) `configure` compares plan and tenant config with `JSON.stringify`, which depends on key order from the same zod schemas. Fine today; use a deep-equal if the schemas diverge.
- (T44c review) Migration 0008 (`show_generation_locks`) is not applied remotely; apply it before deploying a bot that calls the show flow.

## fal adapter (T44d1)
- (T44d1 review) No blockers; CI green, packages/ai 116 tests pass. The API key goes only to the constructed `queue.fal.run` origin; returned URLs are ignored, media downloads carry no credentials and do not follow redirects.
- (T44d1 review) If the adapter throws after fal accepted the job (timeout, invalid media, failed result), no cost is booked because T44c books only returned results. T44e's recovery path must resume by the journalled request id and book the cost, or the operator must book it by hand, otherwise real spend can sit outside the cap.
- (T44d1 review) The fingerprint hashes the JSON of all base64 data URIs, so one call holds several copies of the reference bytes in memory (up to 20 MB of references). Hash the raw bytes instead if Worker memory becomes a problem; photos are normally small.
- (T44d1 review) `callId` is `fal:<requestId>`, unique per job, as T44c requires for idempotent booking.
- (T44d1 review) The ADR 015 check did not clear the excluded-model gate; `verifiedModels` stays empty and `allowPaidCalls` off until Volodymyr confirms the exact-model terms and billing.

## Show raw storage (T44d2)
- (T44d2 review) No blockers; CI green, 53 new R2 tests pass (Miniflare). No secrets, no workflow changes, no bucket or binding created; the adapters are unwired.
- (T44d2 review) A transient R2 error in `reserve` (before any POST) leaves the attempt id unusable: the next call sees a reservation without a request id and demands reconciliation. Safe but strict; T44e's discard path must let the operator drop such a no-spend attempt after checking fal.
- (T44d2 review) Raw objects and journal tickets must never get an R2 lifecycle deletion rule; the bucket needs to be private with no custom domain. Set this up when T44e creates the bucket.
- (T44d2 review) Receipt metadata is capped at 1,800 bytes to fit R2's 2 KB custom metadata. Real receipts are a few hundred bytes; do not add large fields to `showReceiptSchema`.
- (T44d2 review) Running the whole bot suite in parallel hits 5 s timeouts in some tests (also seen in T44b); CI is green. Use `--maxWorkers 1` locally.

## Show marking (T44d3)
- (T44d3 review) No blockers; CI green, publisher 137 and bot storage 54 tests pass with real ffmpeg. Sensitive merge (workflow changes) approved by Volodymyr in chat 2026-11-02. ffmpeg arrives from the Ubuntu apt repository, with no secrets in the install steps.
- (T44d3 review) The publisher checks that media contain the marker declared in the show, not that the marker hash equals the raw result's hash; that link is verified only in `createShowMarkingGate.prepare`. T44e must always call `prepare` before building the approval payload.
- (T44d3 review) Marked images must reach the publisher as PNG documents, never as Telegram photos (those strip XMP). T44e must send them as documents and keep `.png` file names.
- (T44d3 review) Marking runs only in Node. T44e needs an authenticated Worker-to-Node transport (for example a workflow dispatch) and must stay within the 20 MB Telegram download limit after the footer is added.
- (T44d3 review) ffmpeg/ffprobe run on provider output with restricted protocols, thread limits, a 60 s timeout and no shell; the footer adds pixels, so very large inputs near the 1920 px limit grow slightly.

## Show Worker transport (T44e2)
- (T44e2 review) No blockers; CI green, bot 345 tests pass locally. Sensitive merge (new `SHOW_TRANSPORT_SECRET`) approved by Volodymyr in chat 2026-11-02. No remote bucket, secret or deploy.
- (T44e2 review) Grants and sources are keyed by job id. If `authorize` persisted the pending attempt but the grant save failed, or a new job replaced the old one, the grant is lost; this fails closed but needs `recover`/`reconcile`. T44e3 should resume in the same job; T44e5 must cover the case.
- (T44e2 review) Jobs expire after a fixed hour with no extension. T44e3 must handle a long provider wait that outlives the job (resume via a new job; the journal is keyed by scope).
- (T44e2 review) `show-replay/v1/` gets one object per request. A lifecycle rule for that prefix only is safe after job expiry; never for journal/raw/marked. Add it with bucket provisioning.
- (T44e2 review) The transport's catch-all 409 logs nothing; T44e3 should add a secret-safe log there. `wireGrant` ignores a `null` result from the conditional source put.

## Show Node executor (T44e3)
- (T44e3 review) No blockers; CI green. Sensitive merge (new `show.yml` workflow, `FAL_KEY`/`SHOW_TRANSPORT_SECRET` references) approved by Volodymyr in chat 2026-11-02. No secrets, vars, bucket or deploy were installed.
- (T44e3 review) The workflow concurrency group is the raw `payload` string, so dispatches with a different `version` or JSON spacing for the same show run in parallel. The Worker lock and journal prevent double spend; T44e4/T44e5 should dispatch with a canonical payload or group by `tenantId`/`showId`.
- (T44e3 review) `open` copies the pending attempt's grant and sources to the new job before the job CAS; if the CAS loses, the copies stay orphaned under an unused job id. Storage only; cover with the `show-replay`-style lifecycle when provisioning the bucket (never journal/raw/marked).
- (T44e3 review) Oversized sources are skipped silently during the copy; the executor then fails closed on the missing source, which needs operator recovery (T44e5).
- (T44e3 review) `show-cli` swallows all errors into one generic line to stay secret-safe; diagnosis relies on Worker durable state and the transport's 409 log.
- (T44e3 setup, 2026-11-02) At Volodymyr's request the show secrets and vars were installed: GitHub `SHOW_TRANSPORT_SECRET` (random 32 bytes, generated locally, never printed) plus `FAL_KEY` (set by Volodymyr), and Worker `SHOW_TRANSPORT_SECRET` with the same value; the temporary local copy was shredded. Migration 0008 was applied to remote D1 later the same day. R2 bucket `handmake-show` was created the same day (binding pending deploy). Still open before the first real show: deploy, exact-model terms and billing.
- (T44e4a review) `listWorks` fetches the listing plus one raw file per work and `/show` renders one button per work: with dozens of works this hits the Worker subrequest limit (50 on the free plan) and Telegram's keyboard size. Add paging or a bound in T44e4b/c.
- (T44e4a review) Draft retention can purge the awaited work draft before the author returns to `/show`; the show then reports the work as missing although it exists in Git. Recovery is `/discard` and a new `/show`; consider linking straight from Git when the pending draft is gone.
- (T44e4a review) Button labels use `.slice(0, 60)`, which can split a surrogate pair (emoji). Minor.
