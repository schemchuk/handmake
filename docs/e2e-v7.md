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

## Defects found

| # | Defect | Evidence | Fix task |
|---|---|---|---|
| D1 | Flaky bot test: `show-transport.test.ts` timed out (5000 ms) on a docs-only push; the second failure follows from the first. The same code passed CI before. | CI run [41849567117](https://github.com/schemchuk/handmake/actions/runs/41849567117) on `db308a7`. | to be added after T47 |
| D2 | After Publish the bot says "the result will come here as a message", but the result goes only to the fixed `AUTHOR_CHAT_ID` chat, not to the chat that pressed Publish, and it is a technical English line (`published <id> to telegram`). | Post `01M6GWMCGBP2CT99VA1ZGZFBKP` published from Volodymyr's chat; the line arrived in the author's chat only (Volodymyr). | to be added after T47 |
| D3 | `/work` "new collection" form does not say that its four lines describe the collection, not the work; Volodymyr took it for an unused form. | Form text `workFormText` in `apps/bot/src/texts.ts`; the work text comes from the caption. | to be added after T47 |
