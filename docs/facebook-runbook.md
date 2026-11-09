# Facebook Page publishing runbook (T26b)

Operator procedures for the Facebook Page channel. Secrets live in GitHub
Secrets (see H8); the publisher resolves them by fixed name at delivery.
The Meta-wide parts (token exchange endpoint, app credentials) match
`docs/instagram-runbook.md` — both networks sit behind one Meta app.

## Secret inventory

| Secret | What it is |
|---|---|
| `FACEBOOK_PAGE_ID` | The Facebook Page's id (`fb-page-…`) |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | The non-expiring Page token (System User) with `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement` |
| `META_APP_ID` / `META_APP_SECRET` | The Meta developer app, for the `fb_exchange_token` last-resort refresh |

## Token notes

The stored Page token should be a **System User** token with
`expires_at = 0` (verify with `debug_token`, same as the Instagram
runbook). It then never expires and needs no scheduled rotation; rotate
only when revoked or when the System User loses the Page asset. The
`fb_exchange_token` exchange of an already-expired token fails by design,
so the adapter's in-flight refresh on a 190 error is a last resort only —
the reliable rotation is external, exactly as documented in
`docs/instagram-runbook.md`.

To create or renew the Page token: Graph API Explorer with the app →
`/{page-id}?fields=access_token` while holding a valid user token with
`pages_manage_posts`, or the System User flow from the Meta developer
app (H8). Store only the token string in the GitHub Secret — never in the
repo, the tenant yaml or logs.

## First live checks (record outcomes in the PR/task)

- **Single-photo post**: goes out as one `POST /{page-id}/photos` with the
  photo URL and the caption; the canonical site link is part of the
  caption and must render clickable.
- **Multi-photo post / show copy**: each photo uploads unpublished
  (`published=false`), then one `POST /{page-id}/feed` attaches them via
  `attached_media`; verify all photos appear in one post.
- **Raw-URL acceptance**: Meta must fetch `raw.githubusercontent.com`
  photo URLs (served as `image/jpeg`); the Instagram live check covers
  the same CDN behaviour — if the CDN is rejected, point
  `CONTENT_RAW_BASE_URL` at another public https origin.
- **Idempotency**: re-running the publish workflow must skip the
  delivered Facebook op via the ledger (`content/ledger/<id>.json`), not
  repost.
- **Failure isolation**: with the tenant order telegram → instagram →
  facebook, a Facebook failure must leave Telegram and Instagram
  delivered, the ledger showing them done / facebook failed, and an
  operator alert sent. A missing or revoked `FACEBOOK_PAGE_ACCESS_TOKEN`
  fails exactly this way — Facebook only, never the earlier channels.

## Test publishes never reach Facebook

Site-excluded (test-channel) publishes render to zero Facebook operations
(`site-excluded` skip), so the bot's `PUBLISH_LIVE=false` drafts are safe.
Facebook only receives site-worthy posts from live publishes.

## Page housekeeping (H8)

The Page profile links to the site and the Impressum (H8, same rule as
the Instagram profile). The Page itself is part of the brand presence
checked there.
