import { showReceiptSchema } from '@handmake/core';
import type { ShowResultStore } from '@handmake/core';
import type { FalAttemptJournal } from '@handmake/ai';

const maxBytes = 20_000_000;
const maxReceiptBytes = 1_800; // Leave room for SHA-256 and metadata keys within R2's 2 KB limit.
const fingerprintPattern = /^[a-f0-9]{64}$/;
const requestIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Scope = Parameters<FalAttemptJournal['reserve']>[0];
type Ticket = { fingerprint: string; requestId?: string };
type Bucket = Pick<R2Bucket, 'get' | 'put'>;

export class ShowStorageError extends Error {
  constructor(readonly code: 'invalid-input' | 'collision' | 'corrupt' | 'missing' | 'storage') {
    super(`show storage: ${code}`);
    this.name = 'ShowStorageError';
  }
}

/** Private R2 only: no public URL, credentials, expiry, delete or in-memory fallback.
 * Raw bytes and receipt commit as ONE conditional object, never separate writes.
 * A failed/uncertain write can be retried with the same scope and identical contents.
 */
export function createR2ShowStorage(bucket: Bucket) {
  return createStorage(bucket, 'raw');
}
/** Marked writes are trusted only after Node verification; never expose a public upload endpoint. */
export function createR2MarkedShowStorage(bucket: Bucket): ShowResultStore {
  return createStorage(bucket, 'marked').results;
}
function createStorage(bucket: Bucket, kind: 'raw' | 'marked') {
  const results: ShowResultStore = {
    put: (tenantId, showId, attemptId, result) =>
      protect(async () => {
        const scope = { tenantId, showId, attemptId };
        const key = objectKey(kind, scope);
        const ref = resultRef(scope, kind);
        const { bytes: inputBytes, ...receipt } = result;
        const validated = showReceiptSchema.safeParse({ ...receipt, attemptId, ref });
        if (
          !validated.success ||
          !(inputBytes instanceof Uint8Array) ||
          !inputBytes.length ||
          inputBytes.length > maxBytes
        )
          throw new ShowStorageError('invalid-input');
        // Snapshot caller-owned bytes before the first await.
        const bytes = new Uint8Array(inputBytes);
        const serialized = JSON.stringify(validated.data);
        if (byteLength(serialized) > maxReceiptBytes) throw new ShowStorageError('invalid-input');
        const sha256 = await digest(bytes);
        const written = await bucket.put(key, bytes, {
          onlyIf: { etagDoesNotMatch: '*' },
          sha256,
          customMetadata: {
            receipt: serialized,
            sha256,
            receiptSha256: await digest(new TextEncoder().encode(serialized)),
          },
        });
        if (written) return;
        const existing = await results.get(tenantId, showId, attemptId);
        if (!existing) throw new ShowStorageError('collision');
        const { bytes: oldBytes, ...oldReceipt } = existing.result;
        if (
          JSON.stringify(showReceiptSchema.parse({ ...oldReceipt, attemptId, ref })) !==
            serialized ||
          (await digest(oldBytes)) !== sha256
        )
          throw new ShowStorageError('collision');
      }),
    get: (tenantId, showId, attemptId) =>
      protect(async () => {
        const scope = { tenantId, showId, attemptId };
        const object = await bucket.get(objectKey(kind, scope));
        if (!object) return undefined;
        if (!object.size || object.size > maxBytes) {
          await object.body.cancel();
          throw new ShowStorageError('corrupt');
        }
        const serialized = object.customMetadata?.['receipt'];
        const hash = object.customMetadata?.['sha256'];
        const receiptHash = object.customMetadata?.['receiptSha256'];
        if (
          !serialized ||
          byteLength(serialized) > maxReceiptBytes ||
          !hash ||
          !fingerprintPattern.test(hash) ||
          !receiptHash ||
          (await digest(new TextEncoder().encode(serialized))) !== receiptHash
        ) {
          await object.body.cancel();
          throw new ShowStorageError('corrupt');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(serialized);
        } catch {
          await object.body.cancel();
          throw new ShowStorageError('corrupt');
        }
        const receipt = showReceiptSchema.safeParse(parsed);
        if (
          !receipt.success ||
          receipt.data.attemptId !== attemptId ||
          receipt.data.ref !== resultRef(scope, kind)
        ) {
          await object.body.cancel();
          throw new ShowStorageError('corrupt');
        }
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (bytes.length !== object.size || (await digest(bytes)) !== hash)
          throw new ShowStorageError('corrupt');
        const { ref, attemptId: _attempt, ...metadata } = receipt.data;
        return { ref, result: { ...metadata, bytes } };
      }),
  };

  const readTicket = async (key: string) => {
    const object = await bucket.get(key);
    if (!object) throw new ShowStorageError('missing');
    if (object.size > 512) {
      await object.body.cancel();
      throw new ShowStorageError('corrupt');
    }
    let value: unknown;
    try {
      value = JSON.parse(await object.text());
    } catch {
      throw new ShowStorageError('corrupt');
    }
    if (!value || typeof value !== 'object') throw new ShowStorageError('corrupt');
    const ticket = value as Ticket;
    if (
      typeof ticket.fingerprint !== 'string' ||
      !fingerprintPattern.test(ticket.fingerprint) ||
      (ticket.requestId !== undefined &&
        (typeof ticket.requestId !== 'string' || !requestIdPattern.test(ticket.requestId))) ||
      Object.keys(value).some((k) => k !== 'fingerprint' && k !== 'requestId')
    )
      throw new ShowStorageError('corrupt');
    return { ticket, etag: object.etag };
  };
  const journal: FalAttemptJournal = {
    reserve: (scope, fingerprint) =>
      protect(async () => {
        const key = objectKey('attempt', scope);
        if (!fingerprintPattern.test(fingerprint)) throw new ShowStorageError('invalid-input');
        const ticket: Ticket = { fingerprint };
        const written = await bucket.put(key, JSON.stringify(ticket), {
          onlyIf: { etagDoesNotMatch: '*' },
        });
        if (written) return { created: true, ...ticket };
        return { created: false, ...(await readTicket(key)).ticket };
      }),
    record: (scope, requestId) =>
      protect(async () => {
        const key = objectKey('attempt', scope);
        if (!requestIdPattern.test(requestId)) throw new ShowStorageError('invalid-input');
        const { ticket, etag } = await readTicket(key);
        if (ticket.requestId) {
          if (ticket.requestId !== requestId) throw new ShowStorageError('collision');
          return;
        }
        const written = await bucket.put(key, JSON.stringify({ ...ticket, requestId }), {
          onlyIf: { etagMatches: etag },
        });
        if (!written && (await readTicket(key)).ticket.requestId !== requestId)
          throw new ShowStorageError('collision');
      }),
  };

  return {
    results,
    journal,
    /** Internal raw-media resolution only; NEVER expose as the approval/publish media source. */
    resolveRaw: (tenantId: string, ref: string) =>
      protect(async () => {
        const parts = ref.split(':');
        if (
          parts.length !== 5 ||
          parts[0] !== `show-${kind}` ||
          parts[1] !== 'v1' ||
          parts[2] !== tenantId
        )
          throw new ShowStorageError('invalid-input');
        const result = await results.get(tenantId, parts[3]!, parts[4]!);
        if (!result) throw new ShowStorageError('missing');
        return result.result;
      }),
  };
}

function objectKey(kind: 'raw' | 'marked' | 'attempt', scope: Scope): string {
  for (const part of [scope.tenantId, scope.showId, scope.attemptId])
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(part)) throw new ShowStorageError('invalid-input');
  return `show-${kind}/v1/${scope.tenantId}/${scope.showId}/${scope.attemptId}`;
}
function resultRef(scope: Scope, kind: 'raw' | 'marked'): string {
  return `show-${kind}:v1:${scope.tenantId}:${scope.showId}:${scope.attemptId}`;
}
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
async function protect<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ShowStorageError) throw error;
    throw new ShowStorageError('storage');
  }
}
