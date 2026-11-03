# Show deployment and acceptance gates

T44e6c provides mocked integration evidence, not permission to deploy or spend. The status
below is based on repository records as of 2026-11-03; this task performs no remote inspection
or configuration. Volodymyr must authorize production changes and the first real show separately.

## Recorded setup versus pending checks

| Area | Recorded evidence | Remaining gate |
| --- | --- | --- |
| Author consent and template trials | ADR 015 records consent and approved template trials on 2026-11-01. | The author still reviews each proposed show before publication. No identifiable people in input photos without written consent. |
| Provider credentials and transport authentication | `docs/review-notes.md`, T44e3 setup, records GitHub `FAL_KEY` and matching GitHub/Worker `SHOW_TRANSPORT_SECRET` installed on 2026-11-02. | Verify presence and matching configuration without printing values before an authorized deployment. Existing credentials do not authorize spend. |
| Worker origin | The T44e3 setup records show vars installed; `.github/workflows/show.yml` reads `SHOW_WORKER_ORIGIN`. | Confirm the HTTPS origin points to the intended deployed Worker before a dispatch. Do not treat the record as a live health check. |
| Private media bucket | T44e3 setup records `handmake-show` created on 2026-11-02; `wrangler.toml` declares `SHOW_MEDIA`. | Binding activation remains pending deployment. Confirm public access and custom domains are disabled, and no broad deletion lifecycle exists. |
| Database | T44e3 setup records remote migration `0008` applied on 2026-11-02, superseding the earlier T44c note that it was pending. T44e6a/b/c add no migration. | Check the migration list against `apps/bot/migrations/` before deployment; apply missing migrations only with authorization. Do not reclassify 0008 as unapplied. |
| Exact models and terms | ADR 015 names the tested model IDs and records commercial-use statements. Its later documentation check did not resolve excluded-model status. | Volodymyr must confirm the exact endpoints' excluded-model status and applicable underlying-model/data terms before enabling those IDs. Existing trial consent is not clearance of these terms. |
| Billing | ADR 015 records a trial balance change and estimates; tenant EUR prices are estimates, not reconciled provider invoices. | Confirm current pricing and EUR accounting assumptions with Volodymyr, then reconcile the first authorized production show against provider billing. Retain unknown attempts for operator reconciliation. |
| Paid execution | `show-cli.ts` defaults `SHOW_ALLOW_PAID_CALLS` to false and `SHOW_VERIFIED_MODELS` to `[]`. | Keep both gates closed until Volodymyr explicitly clears exact-model and billing checks. Dispatch alone does not open either gate. |
| Personas | ADR 015 and tenant config define fictional adult personas; preparation resolves their private `show-input/v1/<tenant>/<reference>` objects. | Confirm each configured reference exists in the private bucket and contains only an approved fictional adult persona before using worn/close-up templates. Interior shows do not require a persona. Provisioning references needs separate authorization. |
| Operator recovery | `/show_recover`, `/show_reconcile` and `/show_status` are implemented. | Confirm the tenant-scoped `TELEGRAM_SHOW_OPERATOR_IDS` mapping with Volodymyr; absence defaults to denial. Never publish this mapping. |
| Worker and site | Bot/website infrastructure predates this task; current show code and binding have no recorded deployment. | Authorize and deploy the bot separately. Public show pages remain T45; channel copies remain T46. A stored show document does not prove that a public show page exists. |

## Sequence for an authorized rollout

1. Resolve exact-model terms and billing with Volodymyr. Record decisions and evidence without
   credentials; generated text is not final legal advice. Keep paid gates closed during setup.
2. Confirm database migrations, the private bucket, transport secret/origin and operator mapping.
   Preserve journal, raw/marked results, verification and billing evidence. A retention policy is
   still open. Any future lifecycle cleanup must target only reviewed ephemeral prefixes;
   orphaned grants/inputs need a separate scope review, never a bucket-wide expiry.
3. Deploy the Worker only with explicit authorization, then verify the `SHOW_MEDIA` binding and
   authenticated transport. Missing binding or secret disables show execution. This checklist
   does not run `wrangler`, install secrets or change GitHub variables.
4. Check both workflows against the intended environment. Generation uses canonical
   tenant/show/job/version coordinates and durable authorization/journal fences. Publication
   strips only the routing `live` key before strict payload validation and ingests generated
   PNG/MP4 as documents. Confirm FFmpeg/FFprobe are available in the Node runners.
5. After separate permission to spend, enable only the confirmed exact model IDs and run one
   author-selected show. Check original-photo MIME handling noted in T44e4c review, post-marking
   transport limits, budget warning at 20 EUR and denial at 25 EUR, receipts and provider billing.
   Inspect every marked image/video and every full language version before consent.
6. Confirm publication preserves exact document bytes, work linkage and language provenance.
   Exercise retry and signed completion without regenerating or editing the approved payload.
   For a lost callback, rerun the same publish payload; for a lost Worker dispatch, `/show`
   retries after the existing five-minute reclaim timeout. See [show recovery](show-recovery.md).
7. Leave public show rendering and social copies to T45/T46. Authorize any further deployment
   separately; keep the existing legal pages and consent requirements for public content.

## Acceptance evidence for review

| Boundary | Evidence |
| --- | --- |
| Paid authorization, budgeting and uncertain outcomes | `apps/bot/test/show-draft-flow.test.ts`, `show-transport.test.ts`, `show-session.test.ts`; `packages/ai/src/fal-show-generator.test.ts` |
| Private inputs, grants and signed Node/Worker handoff | `apps/bot/test/show-start.test.ts`, `show-storage.test.ts`, `show-transport.test.ts` |
| Marking and attestation | `apps/publisher/test/show-marking.test.ts`; verified snapshot cases in `apps/bot/test/show-transport.test.ts` |
| Version-bound consent, cancellation/regeneration races and document identities | `apps/bot/test/show-approval.test.ts`, `show-preview.test.ts`, `show-session.test.ts` |
| Author session → real document transport → dispatch → Git → signed completion | `apps/bot/test/show-publication.test.ts`: real marking gate/attestation, local D1/R2, production approval/session, GitHub work reader/dispatch runner, Telegram downloader, publisher, Git committer and callback sender/handler. Network and provider outputs are fixtures. |
| Downloaded marker stripping/tampering and interrupted persistence | The same integration suite rejects modified downloads before writing show content or completing the draft, then retries the frozen payload. `apps/publisher/test/show-publish.test.ts` covers content conflicts and payload invariants. |
| Existing post/work behavior | `apps/publisher/test/publish.test.ts`, `work-publish.test.ts`; `apps/bot/test/bot.test.ts`, `work-session.test.ts`, `published-callback.test.ts` |

T44e6c implementation supplies the final integration evidence for parent T44e6/T44e. Those
acceptance gates remain pending independent review of the combined T44e6a/b/c evidence and green
CI. Closing an implementation gate does not clear any production, legal, billing or deployment gate.
