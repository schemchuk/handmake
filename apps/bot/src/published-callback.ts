import { publishedCallbackBodySchema, verifyCallbackSignature } from '@handmake/core';

import { createD1DraftStore } from './draft-store';
import type { Env } from './env';

/**
 * Publisher → bot "post is published" callback (architecture 4.3, T18).
 * The publish pipeline POSTs here after delivering a post; the handler
 * marks the draft published and indexes the post. Everything is idempotent:
 * a retried callback is a no-op 200, and the index insert is
 * insert-or-ignore, so re-runs of the whole pipeline never double-write.
 *
 * Auth: HMAC-SHA256 over the RAW request body with PUBLISH_CALLBACK_SECRET
 * (header X-Handmake-Signature, constant-time compare). A missing or wrong
 * signature is a 401 and must not write anything.
 */

export const publishedCallbackPath = '/callbacks/published';

/** Header the publisher signs into; lowercase because D1/Worker headers are. */
export const signatureHeader = 'x-handmake-signature';

export async function handlePublishedCallback(env: Env, request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  // The signature covers the exact bytes, so the body is read as text and
  // the very same string is what gets parsed and verified.
  const rawBody = await request.text();
  const provided = request.headers.get(signatureHeader);
  if (
    !env.PUBLISH_CALLBACK_SECRET ||
    provided === null ||
    !(await verifyCallbackSignature(env.PUBLISH_CALLBACK_SECRET, rawBody, provided))
  ) {
    return new Response('unauthorized', { status: 401 });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const parsed = publishedCallbackBodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return new Response('bad request', { status: 400 });
  }
  const { tenantId, postId, date, photos } = parsed.data;
  const store = createD1DraftStore(env.DB);
  // The index row is written even when no draft matches: a post published
  // by hand still belongs in the index. The draft transition is the guarded
  // no-op part — a draft that is not 'publishing' (already published,
  // unknown) simply stays as it is.
  await store.indexPublished({ tenantId, postId, publishedAt: date, photos });
  await store.markPublished(tenantId, postId, new Date());
  return new Response('ok');
}
