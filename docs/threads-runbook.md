# Threads publishing

- Runtime secrets: numeric `THREADS_USER_ID` and `THREADS_ACCESS_TOKEN` with `threads_basic`
  and `threads_content_publish`. App credentials are setup-only; never log tokens.
- `.github/workflows/threads-token.yml` refreshes the long-lived token every Monday, with a
  manual `workflow_dispatch` option on `main`. It masks the new token, requires at least 50 days
  of validity and replaces the repository's `THREADS_ACCESS_TOKEN` via stdin. Publishing reads
  the updated secret on its next run. Only unexpired tokens at least 24 hours old can refresh;
  avoid dispatching again within 24 hours of a successful refresh.
- Failed refreshes fail the job without logging the response. Check Actions failure notifications
  and restore refresh before expiry; weekly scheduling leaves about eight retries. Manual
  reauthorization is needed after expiry. Never paste tokens or API responses into logs or issues.
- `SECRETS_WRITE_TOKEN` is a fine-grained token scoped to this repository, Secrets read/write.
  It has no expiration (Volodymyr's choice); revoke and replace it if it leaks. Store it only as
  a GitHub Secret. The workflow uses only `contents: read` for checkout, with no persisted credentials.
- After merge and Volodymyr's rollout approval, dispatch `threads-token.yml` on `main`, record
  its run URL in the PR and check logs contain neither token nor response. Verify the next
  authorized publish delivers to Threads and record that run too. These live checks are pending.
- T49d must extend this job to update the Worker secret when Threads comments use that token;
  currently the token is used only by the publisher.
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
