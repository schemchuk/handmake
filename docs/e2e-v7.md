# End-to-end check of what exists (T47)

Date: 2026-11-04 · Production: bot Worker with `PUBLISH_LIVE = "true"`, site fadenundstimmung.de ·
Checked by claude-code with Volodymyr. Each defect becomes a small fix task right after T47 in
docs/03-tasks.md.

## Post (UA → DE, preview, edit, publish to Telegram and site)

Real post by the author, id `01M6GWMCGBP2CT99VA1ZGZFBKP`, 3 photos.

| # | Step | Result | Evidence |
|---|---|---|---|
| P1 | `/new`, photos, UA text, `/done` → preview with German | pass | Preview arrived 5–6 s after `/done` (Volodymyr). |
| P2 | Edit DE → updated preview | pass | New German text "Motiv aus irischer Häkelspitze" shown at once in the updated preview. |
| P3 | Publish (after the no-faces confirmation) → workflow | pass | Publish run [41852787422](https://github.com/schemchuk/handmake/actions/runs/41852787422): `publish` and `site / deploy` succeeded. |
| P4 | Post in the repo | pass | `content/posts/2026-11-04-01m6gwmcgbp2ct99va1zgzfbkp/` (`16dec40`): `provenance: ai-assisted`, no `siteExcluded`, `photo-1..3.jpg` without EXIF. Ledger `8233368`: telegram `done`, message ids 37, 40. |
| P5 | Telegram channel | pass | Album of 3 photos with the UA caption, German text as a reply below it (screenshot by Volodymyr). |
| P6 | Site | pass | `/posts/01m6gwmcgbp2ct99va1zgzfbkp/` (DE) and `/uk/posts/01m6gwmcgbp2ct99va1zgzfbkp/` return 200 with the post text; listed on the home page and in `sitemap.xml`. |

## Work and collection

Checked live by Volodymyr on 2026-11-03, not repeated: work `01M6GJ3EQ30PG574W23NPSAY2T` with a new
collection.

| # | Step | Result | Evidence |
|---|---|---|---|
| W1 | `/work` → kind → new collection form (4 lines) → photos and caption → preview → publish | pass | Commit `255daa2` adds `content/works/01M6GJ3EQ30PG574W23NPSAY2T/` (3 photos, `kind: closeup`) and `content/collections/collection-01m6gj3eq30pg574w23npsay2t.md`. |
| W2 | Collection texts from the form reach the site | pass | `/collections/` lists "Irisches Spitzenelement"; the collection page shows the DE title and description from the form. |
| W3 | Work description | pass | Generated from the photos and caption (`provenance: ai-generated`, `describe-work-uk@1`, `humanize-de@1`). |

| W4 | Repeat on 2026-11-04 after the D4 unblock: `/work` → "on a model" → new collection → 3 photos and caption → preview → publish (no channel announcement) | pass | Bot confirmed the publish; run [41858778611](https://github.com/schemchuk/handmake/actions/runs/41858778611); commit `ed53eed` adds work `01M6KJ8RHC6M3XY072Z980YZEM` and its collection; `/works/…`, `/uk/works/…` and the collection page return 200, the work is listed on `/works/`. |

## Show

Paid run approved by Volodymyr in chat (2026-11-04). Show `01M6KK8QCHCWS3CWGK1X2T9G2E` for work
`01M6KJ8RHC6M3XY072Z980YZEM`, template "on a model", persona Lena, 3 originals.

| # | Step | Result | Evidence |
|---|---|---|---|
| S1 | `/show` → work → template, persona, work photos → save → start | pass | Bot: "inputs saved", then "generation job dispatched" (17:37 local). |
| S2 | Generation of the first image | fail | Show run [41859645677](https://github.com/schemchuk/handmake/actions/runs/41859645677) stopped after ~2 min. D1: draft `failed`, no outputs, pending attempt for `image-0` without a fal request id, no new `ai_costs` row, tenant generation lock still held. The cause is not logged (D6). |
| S3 | Failure reaches the author | pass | Bot: "the run stopped … the operator checks possible unfinished costs", with "continue generation" and "refresh preview" buttons. |
| S4 | Where S2 failed | evidence | fal history: request `01a1a736-…` for image-0 at 17:38, status 200, $0.08. R2: attempt journal holds that request id, raw PNG stored, no marked copy. Worker tail of the next run: the `checkpoint` call answered 409 "show transport operation rejected" (D7). |
| S5 | "Continue generation" resumes without paying twice | pass | First resume (15:55 UTC): image-0 checkpointed from the stored raw result, image-1 and image-2 generated and marked; the video was generated and stored, then its `checkpoint` got 409 again. Second resume (16:09 UTC): video checkpointed from the stored file, no new fal call. D1: show `ready`, 4 outputs, `ai_costs` 3 × €0.10 image + €0.40 video = €0.70. |
| S6 | Preview → approve | pass | Bot sent the 3 marked PNGs, the video ("KI-generiertes Model"), the work id and both `ai-generated` texts, then "Approve show"; approved 18:20 local. |
| S7 | Show on the site | pass | Commit `bc47910` adds `content/shows/01M6KK8QCHCWS3CWGK1X2T9G2E/` (3 PNG, `video.mp4`); `/shows/01m6kk8qchcws3cwgk1x2t9g2e/` and `/uk/…` return 200 with the images, the video and the "KI erstellt" / "KI-generiertes Model" labels. |
| S8 | Show copied to Telegram | pass | Show appeared in the channel (Volodymyr). |
| S10 | Generation finish messages (T44e11) | pass | The chat that ran the show got "run stopped" twice (17:39, 18:03 local) and "results ready" once (18:13). |
| S11 | Publish result after approval | fail | Nothing arrived in the approving chat; the author's chat got the same technical line as for posts (D2). |
| S9 | Test-run shows and the site (review note from PR #81) | fail (latent) | `apps/publisher/src/publish.ts` sets `siteExcluded` only for posts; shows and works are saved without it, so a test-channel run would reach the site (D8). All three shows on the site were published live. |

GitHub showed show runs 41862598252 and 41864548868 and publish run 41866334659 as `queued` for
minutes after the Worker had received all their calls; the Worker tail and D1 are the evidence for
S5–S7.

## Defects found

| # | Defect | Evidence | Fix task |
|---|---|---|---|
| D1 | Flaky bot test: `show-transport.test.ts` timed out (5000 ms) on a docs-only push; the second failure follows from the first. The same code passed CI before. | CI run [41849567117](https://github.com/schemchuk/handmake/actions/runs/41849567117) on `db308a7`. | to be added after T47 |
| D2 | After Publish the bot says "the result will come here as a message", but the result goes only to the fixed `AUTHOR_CHAT_ID` chat, not to the chat that pressed Publish, and it is a technical English line (`published <id> to telegram`). | Post `01M6GWMCGBP2CT99VA1ZGZFBKP` published from Volodymyr's chat; the line arrived in the author's chat only (Volodymyr). | to be added after T47 |
| D4 | A pending "Edit" survives publish and `/discard`: post `01M6GWMCGBP2CT99VA1ZGZFBKP` reached `published` with `pending_edit = 'de'`, so every later text in that chat went to the edit handler and got `editConflictText`; the `/work` collection form was never read. Only a successful edit clears the flag. | D1 query 2026-11-04: one row, `status = published`, `pending_edit = de`. Unblocked by hand with Volodymyr's OK (`UPDATE … SET pending_edit = NULL` on that id, 1 change). | to be added after T47 |
| D5 | A show that waits for a new work (`awaitingWorkId`) stays stuck when that work draft is discarded and the work is published from a fresh draft: `/show` answers `showMissingWorkText`; only `/discard` + `/show` recovers. | Show draft `01M6KHW46GE0MH0T1GAXV20GSC` waited for discarded draft `01M6GX6M8S0QB4HHE3RDNNSN0J`; the work went out as `01M6KJ8RHC6M3XY072Z980YZEM`. | to be added after T47 |
| D6 | A failed show run cannot be diagnosed: `show-cli.ts` logs only "Show execution stopped" and the fal adapter maps any non-OK HTTP answer to `provider` without the status code. | Run 41859645677 log; `packages/ai/src/fal-show-generator.ts` `#http`. | to be added after T47 |
| D7 | The show `checkpoint` right after a fresh generation sometimes fails with 409; the same checkpoint succeeds on "continue generation". 2 of 5 slots failed (image-0 of the first run, the video). `flow.accept` threw, but the transport `catch` drops the error, so the cause is unknown. Each failure needs an extra manual resume and leaves a paid result unbooked until then. | Worker tail 2026-11-04 ~16:03 UTC: `checkpoint` 409 "show transport operation rejected" after `raw-put` 200; D1/R2 state in S4–S5. | to be added after T47 |
| D8 | Shows and works published from a test-channel run reach the site: only posts get `siteExcluded`. | S9. | to be added after T47 |
| D3 | `/work` "new collection" form does not say that its four lines describe the collection, not the work; Volodymyr took it for an unused form. | Form text `workFormText` in `apps/bot/src/texts.ts`; the work text comes from the caption. | to be added after T47 |
