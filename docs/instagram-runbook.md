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

- **Carousel `children` format.** The adapter sends the carousel container's
  child ids as a JSON array; Meta documents a comma-separated string. The
  mocks pre-land can't settle this — publish the first real multi-photo post
  and, if Meta rejects the container with a malformed-children error, switch
  `packages/channels/src/instagram/adapter.ts` to `children.join(',')`.
- **Single-photo post** goes out as one image container (no framing).
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
