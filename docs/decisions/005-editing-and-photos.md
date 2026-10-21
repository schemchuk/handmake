# 005 — Editing UX in the MVP and photo handling

Status: proposed · Date: 2026-10-21

## Context
The author must edit both language versions before publishing (spec F9). Photos must be EXIF-free
(F4) and fit Telegram and Instagram.

## Editing options
1. **Reply-based edit**: buttons "Edit UA" / "Edit DE"; the bot sends the current text so she can copy
   it, she sends the corrected version, the preview updates. Phone-native, no extra UI.
2. Telegram Mini App with a text editor: nicer editing, and the start of the future web admin, but a
   frontend to build and host in week one.

## Photo options
1. **Keep Telegram `file_id`s in the draft**, download and process only on publish in GitHub Actions.
   No image storage in Cloudflare.
2. Upload to R2 at intake: more moving parts, storage of unpublished photos.

## Decision
MVP: reply-based edit, and photos as `file_id`s processed at publish time (re-encode to JPEG, strip all
metadata, resize to max 2048 px). Photos sent as files (uncompressed) are accepted and processed the
same way. The Mini App is planned after the MVP and reuses the Worker's draft API.

## Consequences
- Telegram keeps `file_id`s valid long enough for drafts; drafts older than 30 days are discarded.
- The publisher, not the bot, guarantees that only metadata-free images reach Git and channels.
