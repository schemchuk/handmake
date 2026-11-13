# Instagram publishing runbook (T26a3)

Operator procedures for the Instagram channel. Secrets live in GitHub Secrets
(see H8); the publisher resolves them by fixed name at delivery.

## Secret inventory

| Secret | What it is |
|---|---|
| `INSTAGRAM_USER_ID` | The Instagram Business/Creator account's `ig-user-id` |
| `INSTAGRAM_ACCESS_TOKEN` | Long-lived User access token (Instagram Graph API) |
| `META_APP_ID` / `META_APP_SECRET` | The Meta developer app, for `fb_exchange_token` |

## Rotating `INSTAGRAM_ACCESS_TOKEN` (before ~60-day expiry)

Current setup (checked 2026-11-08 with `debug_token`): the stored token is a **System User** token
with `expires_at = 0` and `data_access_expires_at = 0`, so it does not expire and needs no
scheduled rotation. Rotate it only if it is revoked, the system user loses the asset, or you
replace it with a regular user token. The procedure below applies to long-lived **user** tokens.

Meta's long-lived tokens expire after about 60 days, and **`fb_exchange_token`
refuses an already-expired token** — so the adapter's in-flight refresh on a
190 error is only a last resort (it helps when the token dies mid-deliver or
Meta flags it early, not after a quiet expiry). The reliable rotation is
external, while the stored token is still valid:

1. Take the current secret value and exchange it for a fresh long-lived token
   (the response also reports the new token's expiry):

   ```sh
   curl -s "https://graph.facebook.com/v21.0/oauth/access_token" \
     -d "grant_type=fb_exchange_token" \
     -d "client_id=$META_APP_ID" \
     -d "client_secret=$META_APP_SECRET" \
     -d "fb_exchange_token=$CURRENT_INSTAGRAM_ACCESS_TOKEN"
   ```

2. Update the GitHub Secret `INSTAGRAM_ACCESS_TOKEN` with the response's
   `access_token`. No deploy is needed — the publisher resolves the secret at
   every delivery.
3. If the token already expired, start from a fresh short-lived token
   (Facebook Login flow for the author's account) and exchange that the same
   way.

Consider a scheduled reminder ~50 days after each rotation; a future scheduled
job may automate the exchange, but it must run before expiry for the same
reason.

## First live checks (record outcomes in the PR/task)

- **Carousel parent parameters (T51).** The first live three-photo post failed
  in run `43386329746` with `(#100) The parameter image_url is required`:
  the parent omitted `media_type: 'CAROUSEL'`. The adapter now sends that
  type and comma-separated child ids (`children.join(',')`). Unit tests assert
  the exact parent parameters; live verification remains pending after merge.
  Start a new publish from `main` for draft `01M79WSSK61F11FA1C5J61BVCS`
  (bot "Publish" again, or workflow dispatch with the same payload and `live`).
  Do not re-run the failed run: it uses the old dispatch commit. Verify that
  the ledger skips Telegram, the remaining networks deliver, and the site
  page becomes available before recording live success here.
- **Raw-URL acceptance.** Confirm Meta fetches `raw.githubusercontent.com`
  photo URLs (served as `image/jpeg`) on the first live post; if the CDN is
  rejected, serve the framed copies from another public https origin and
  point `CONTENT_RAW_BASE_URL` at it.
- **Single-photo post** goes out as one image container, framed to 4:5 like
  everything else — Instagram rejects feed images outside 4:5..1.91:1, so an
  unframed phone portrait would fail container creation.
- **Multi-photo post / show copy**: the publisher frames 4:5 (1080x1350,
  white padding, never cutting) copies `*.ig.jpg` beside the item, commits
  them and pushes before delivery so Meta can fetch the raw-GitHub URLs.
- **Idempotency**: re-running the publish workflow must skip the delivered
  Instagram op via the ledger (`content/ledger/<id>.json`), not repost.
- **Failure isolation**: with the tenant order telegram → instagram, an
  Instagram failure must leave Telegram delivered, the ledger showing
  telegram done / instagram failed, and an operator alert sent.

## Test publishes never reach Instagram

Site-excluded (test-channel) publishes render to zero Instagram operations
(`site-excluded` skip), so the bot's `PUBLISH_LIVE=false` drafts are safe.
Instagram only receives site-worthy posts from live publishes.

## Account housekeeping (H8)

The profile bio carries the site link ("link in bio", F33 — captions have no
clickable links). The Impressum link in the profile is part of H8 and still
needs verification.
