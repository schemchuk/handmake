# Threads publishing

- Runtime secrets: numeric `THREADS_USER_ID` and `THREADS_ACCESS_TOKEN` with `threads_basic`
  and `threads_content_publish`. App credentials are setup-only; never log tokens.
- Rotate the long-lived token before expiry, using `GET /refresh_access_token?grant_type=th_refresh_token`
  on the Threads host, then replace the GitHub Secret securely. Only unexpired long-lived tokens
  at least 24 hours old can be refreshed. Expired tokens require reauthorization; the adapter fails safely.
- Adapter: `graph.threads.com/v1.0`, form-encoded containers, bounded polling, `threads_publish`;
  photo URLs reuse committed originals without Instagram framing.
- Text and shows include their canonical link. Preview/render reject over 500 UTF-8 bytes (a
  conservative character budget, including emoji), without rewriting the author's copy. Photos: 1–20.
- Ledger-completed operations are skipped. After an ambiguous publish or interrupted ledger write,
  inspect Threads before retrying: the API has no native idempotency key, so that window can duplicate.
- Before first live use, obtain Volodymyr's merge/rollout OK; verify profile Impressum link, token scopes,
  text/image/carousel delivery, preserved show disclosure and a ledger-skipped rerun. Live checks pending.
- API contract sources: [Meta sample](https://github.com/fbsamples/threads_api/blob/main/src/index.js),
  [Meta collection](https://github.com/fbsamples/threads_api/blob/main/postman/threads-api.postman_collection.json),
  [token lifecycle](https://developers.facebook.com/docs/threads/get-started/long-lived-tokens).
  Threads comments remain T49d; T26c enables publishing only.
