# MVP end-to-end check (T17)

Date: 2026-10-27 · Bot Worker deployed from `main` after PR #27 · Spec 01-spec.md section 5.

Live runs: test channel `40525514688` (first bot publish), live channel `40528957572`.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| A1 | UA text + photos → preview with German within 60 s | pass (live) | Preview arrived within ~30 s of `/done` (Volodymyr, 2026-10-27). |
| A2 | Edit German text, see updated preview | pass (automated) | `apps/bot/test/bot.test.ts` "Edit DE arms the edit; the next text message replaces the German version". Not repeated by hand (Volodymyr's call). |
| A3 | Channel shows UA post then DE post | pass (live) | Run `40528957572`: album with UA caption, DE reply. The first test run had the order swapped; fixed in PR #27. |
| A4 | Double press / webhook retry → no duplicate | pass (live + automated) | Repeated presses answered "busy", one run per draft. Tests "a double confirm dispatches exactly once (A4)", "a redelivered update_id ... not processed twice". |
| A5 | Post folder in the repo, correct frontmatter, EXIF-free photos | pass (live) | `content/posts/2026-10-27-01m5yys4hkd43sp821xejqvt6e/`: frontmatter `uk` before `de`, `photo-1.jpg` has no EXIF segment. |
| A6 | Non-allow-listed user refused, nothing stored | pass (automated) | Tests "a non-allow-listed user gets the refusal and nothing is stored", "refused strangers leave no trace in the dedupe table (A6)". Not repeated by hand. |
| A7 | CI runs lint, types, tests on every PR | pass | `ci` check on every PR (#23-#27). |
| A8 | Forced Telegram failure → operator alert, retryable ledger | pass (automated) | `apps/publisher/test/publish.test.ts` "marks the channel failed mid-delivery and resumes only the missing op on re-run"; `packages/core/test/ledger.test.ts` retry cases; notifier routing in `telegram-notifier.test.ts`. No live forced failure. |
| A9 | No secret in repo, logs or CI output | pass | gitleaks in CI and pre-push; no secret values in workflow logs (tokens only via `secrets.*`). |

Bugs found during the live check, all fixed before the switch to live:
- PR #25: the Worker crashed at load (`import.meta.url` in `packages/ai`).
- PR #26: GitHub rejected the dispatch without a `User-Agent` (403).
- PR #27: German became the album caption (GitHub sorts `client_payload` keys).

Switch to the live channel: `PUBLISH_LIVE = "true"` on Volodymyr's go, 2026-10-27 (`ff18fbe`).
