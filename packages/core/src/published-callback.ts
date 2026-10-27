import { z } from 'zod';

/**
 * The publisher → bot "post is published" callback (architecture 4.3,
 * tasks T18/T19). Shared between the two sides: the publisher signs the
 * exact raw body it sends, the bot verifies the raw body it received, so
 * both must use the same algorithm and the same body schema.
 *
 * The signature is HMAC-SHA256 over the raw request body, lowercase hex,
 * sent in the `X-Handmake-Signature` header and compared in constant time.
 * Signing the raw body (not a canonicalized object) means any JSON
 * round-trip difference between sender and receiver cannot break the match.
 */

export const publishedCallbackBodySchema = z
  .object({
    tenantId: z.string().min(1),
    /** The draft id the pipeline published; becomes the D1 draft lookup key. */
    postId: z.string().min(1),
    /** Publication date (ISO); stored as published_at in the index. */
    date: z.string().min(1),
    /** Repo-relative photo paths, as written into the ledger. */
    photos: z.array(z.string()),
    /** Per-channel outcome of the publish run. */
    channels: z.record(z.string(), z.enum(['done', 'failed'])),
  })
  .strict();

export type PublishedCallbackBody = z.infer<typeof publishedCallbackBodySchema>;

const encoder = new TextEncoder();

/** HMAC-SHA256 of the raw body with the shared secret, as lowercase hex. */
export async function signCallbackBody(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * True when `signatureHex` matches the HMAC of the raw body. The comparison
 * runs over the full strings with no early exit, so a wrong guess does not
 * leak via timing how much of it was right.
 */
export async function verifyCallbackSignature(
  secret: string,
  rawBody: string,
  signatureHex: string,
): Promise<boolean> {
  const expected = await signCallbackBody(secret, rawBody);
  if (expected.length !== signatureHex.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= (expected.charCodeAt(i) ^ signatureHex.charCodeAt(i)) | 0;
  }
  return diff === 0;
}
