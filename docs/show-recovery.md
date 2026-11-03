# Show recovery (T44e5c)

Operator controls are private-chat only and fail closed. In addition to the existing author
allow-list, `TELEGRAM_SHOW_OPERATOR_IDS` must map an operator's user ID to the same tenant.
The default is `{}` (no operators). Provisioning this secret, deployment and paid calls
remain separate approval gates; this task changes no production secrets or resources.

- `/show_status [show-id]` reports the current version, pending attempt and cancellation flag.
  Without an ID it uses the operator's current session. Keep the show ID before cancelling.
- `/show_recover <show-id> <version> <attempt-id>` dispatches a recovery job. It uses only
  the immutable provider request ID and frozen plan metadata. Missing grants, missing source
  objects and oversized source media do not prevent this recovery. Provider operations are
  GET-only; no authorization, reservation or provider submission is available in this job.
  It checkpoints/accounts and marks this attempt, then stops before any new generation.
- `/show_reconcile <show-id> <version> <attempt-id> <JSON>` records an explicit billing check.
  JSON examples (replace billing fields with verified provider evidence):

  ```json
  {"operatorConfirmed":true,"note":"Provider billing checked: no charge","billing":null}
  ```

  ```json
  {"operatorConfirmed":true,"note":"Provider billing checked","billing":{"callId":"fal:verified-request-id","model":"configured/model","costEur":0.1}}
  ```

Check provider billing before confirming, including reservations without a request ID. A missing
request ID cannot be recovered by submitting again. A billed reconciliation books the cost once;
a no-spend reconciliation explicitly authorizes dropping that pending marker. Both retain evidence.
Durable result billing must match. Failed bookkeeping retains the pending marker and tenant lock.
Stale versions/attempts and users from another tenant are rejected.

`/discard` cancels the author's show and detaches its session, retaining the draft, journal,
receipts, retired outputs, raw/marked media and billing. It does not resolve an unknown attempt
or release its tenant lock. Cancelled shows accept billing reconciliation only; old results and
buttons cannot restore output or restart generation. Draft deletion and retention cleanup exclude
shows so recovery evidence survives. A later retention policy needs an explicit evidence lifecycle.

Parent T44e5 acceptance is covered by the preview/regeneration suites and the recovery tests:
operator/author separation, lost grants, GET-only resumption with paid gates closed, no-request-ID
locks, billed/no-spend reconciliation, cancellation, stale callbacks and retained evidence.
Approval/publication integration is covered by T44e6a/b/c. Independent review must confirm the parent gate.

## Author approval and dispatch (T44e6b)

For a ready show, `/show` delivers the current verified marked PNG/MP4 files as documents,
then the linked work ID and complete language descriptions with their existing provenance.
The version-bound approval button appears only after every returned document identity has
passed filename, MIME type and exact size checks. Texts are inherited from the linked work;
this step does not generate or rewrite them. Video duration remains the generation flow's
fixed five seconds.

Interrupted uploads or notifications can be retried through `/show`. A new preview invalidates
older buttons. Regeneration or cancellation racing with approval either wins the version CAS
or loses to the frozen publication; it cannot change an approved payload. Approval atomically
stores that payload and enters `publishing`. Once approved, regeneration and discard are blocked.

If dispatch fails, `/show` offers retry using the same approved payload and show ID. An interrupted
Worker dispatch can be reclaimed after the existing five-minute publishing timeout. Duplicate
presses during that interval do not dispatch again. The existing publish runner and signed
published callback handle delivery. T44e6c tests the complete publication path;
[deployment and acceptance gates](show-deployment.md) distinguish recorded setup from pending
production checks. No deployment or paid calls are authorized by this implementation.

## Legacy ready shows without attestations (T44e7)

A ready show generated before verification evidence was introduced keeps its original raw and
marked objects and paid attempt IDs. On “Refresh preview”, missing evidence now dispatches a
reusable recovery-mode `show.yml` job. The author sees a verification-in-progress message and
can refresh again after the workflow finishes. A dispatch failure leaves the ready show retryable.

The existing Node prepare step verifies each retained marked object against its raw source and
writes `show-verified/v1` evidence. Recovery mode rejects authorization, grants and provider journal
writes; it performs no generation or accounting checkpoint. Keep `SHOW_ALLOW_PAID_CALLS=false`.
Invalid evidence or mismatched marked/raw media fails closed rather than offering approval.
Repeated refreshes reuse the live job identity and suppress dispatch after a successful request.
A failed dispatch releases its claim for immediate retry; an interrupted request can retry after
a 60-second lease. If GitHub accepted a request whose response was lost, a retry may queue a
duplicate workflow; the existing transport fences still prevent repeated generation or spending.
All slots are verified before uploading any preview document, with media consumed one file at
a time. Existing verified shows use the normal preview.

After merge, deploy the bot only with Volodymyr's approval. For the retained production show,
refresh its preview, wait for the recovery workflow, then refresh again. Confirm three PNGs and
one MP4 plus the approval button, unchanged attempt IDs and no added `ai_costs` rows. This task's
implementation and tests do not execute that production procedure or deploy anything.
