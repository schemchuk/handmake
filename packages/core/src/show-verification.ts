import { z } from 'zod';
import { aiMarkerSchema } from './show';
import { showReceiptSchema } from './show-draft';
import type { ShowResultStore } from './ports/show-generator';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const showVerificationSchema = z
  .object({
    tenantId: id,
    showId: id,
    attemptId: id,
    rawSha256: digest,
    markedSha256: digest,
    rawReceipt: showReceiptSchema,
    markedReceipt: showReceiptSchema,
    marker: aiMarkerSchema,
  })
  .strict();
export type ShowVerification = z.infer<typeof showVerificationSchema>;
type StoredResult = NonNullable<Awaited<ReturnType<ShowResultStore['get']>>>;

/** Describe exact bytes. Only the authenticated Node marking gate can attest verification. */
export async function describeShowVerification(
  tenantId: string,
  showId: string,
  attemptId: string,
  raw: StoredResult,
  marked: StoredResult,
) {
  const hash = async (bytes: Uint8Array) => {
    if (!bytes.length || bytes.length > 20_000_000) throw new Error('invalid show media size');
    return Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
  };
  const receipt = (stored: StoredResult) => {
    const { bytes: _bytes, ...metadata } = stored.result;
    return showReceiptSchema.parse({ ...metadata, ref: stored.ref, attemptId });
  };
  const rawSha256 = await hash(raw.result.bytes);
  const evidence = showVerificationSchema.parse({
    tenantId,
    showId,
    attemptId,
    rawSha256,
    markedSha256: await hash(marked.result.bytes),
    rawReceipt: receipt(raw),
    markedReceipt: receipt(marked),
    marker: {
      visible: 'KI-generiertes Model',
      machineReadable: {
        format: marked.result.mimeType === 'video/mp4' ? 'MP4/comment' : 'XMP',
        value: `show-mark@1:${rawSha256}`,
      },
    },
  });
  if (
    raw.ref !== `show-raw:v1:${tenantId}:${showId}:${attemptId}` ||
    marked.ref !== `show-marked:v1:${tenantId}:${showId}:${attemptId}` ||
    marked.result.mimeType !== (raw.result.mimeType === 'video/mp4' ? 'video/mp4' : 'image/png') ||
    (['callId', 'model', 'promptVersion', 'costEur'] as const).some(
      (key) => raw.result[key] !== marked.result[key],
    ) ||
    evidence.rawSha256 === evidence.markedSha256
  )
    throw new Error('invalid marked result');
  return evidence;
}
