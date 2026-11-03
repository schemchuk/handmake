import {
  describeShowVerification,
  showDraftDataSchema,
  showVerificationSchema,
} from '@handmake/core';
import type { D1DraftStore, StoredDraft } from './draft-store';
import { createR2MarkedShowStorage, createR2ShowStorage } from './show-storage';

type Scope = { tenantId: string; showId: string; attemptId: string };
/** Private immutable attestation, written exclusively by the authenticated Node boundary. */
export function createShowVerificationStore(bucket: Pick<R2Bucket, 'get' | 'put'>) {
  const raw = createR2ShowStorage(bucket).results;
  const marked = createR2MarkedShowStorage(bucket);
  const key = (scope: Scope) => {
    for (const id of [scope.tenantId, scope.showId, scope.attemptId])
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid verification scope');
    return `show-verified/v1/${scope.tenantId}/${scope.showId}/${scope.attemptId}`;
  };
  const describe = async (scope: Scope) => {
    const args = [scope.tenantId, scope.showId, scope.attemptId] as const;
    const original = await raw.get(...args),
      output = await marked.get(...args);
    if (!original || !output) throw new Error('verification media missing');
    return { evidence: await describeShowVerification(...args, original, output), output };
  };
  const read = async (scope: Scope) => {
    const object = await bucket.get(key(scope));
    if (!object) throw new Error('verification missing');
    if (!object.size || object.size > 4096) {
      await object.body.cancel();
      throw new Error('invalid verification');
    }
    return showVerificationSchema.parse(await object.json());
  };
  return {
    async attest(input: unknown) {
      const evidence = showVerificationSchema.parse(input);
      const expected = (await describe(evidence)).evidence;
      const serialized = JSON.stringify(evidence);
      if (serialized !== JSON.stringify(expected)) throw new Error('verification mismatch');
      const saved = await bucket.put(key(evidence), serialized, {
        onlyIf: { etagDoesNotMatch: '*' },
      });
      if (!saved && JSON.stringify(await read(evidence)) !== serialized)
        throw new Error('verification collision');
    },
    async get(scope: Scope) {
      const evidence = await read(scope);
      const current = await describe(scope);
      if (JSON.stringify(evidence) !== JSON.stringify(current.evidence))
        throw new Error('verification integrity failed');
      return { ...current.output, evidence };
    },
  };
}

/** Resolve the current generation; approval must CAS this version. A visitor consumes
 * one file at a time and the returned snapshot retains metadata only. */
export async function resolveVerifiedShowSnapshot(
  deps: {
    drafts: Pick<D1DraftStore, 'get'>;
    verified: Pick<ReturnType<typeof createShowVerificationStore>, 'get'>;
  },
  stored: StoredDraft,
  visit?: (
    item: { slot: string } & Awaited<
      ReturnType<ReturnType<typeof createShowVerificationStore>['get']>
    >,
  ) => Promise<void>,
) {
  stored = structuredClone(stored);
  const { tenantId, draftId } = stored.draft;
  const assertCurrent = async () => {
    const latest = await deps.drafts.get(tenantId, draftId);
    if (
      !latest ||
      latest.version !== stored.version ||
      latest.draft.kind !== 'show' ||
      latest.draft.state !== 'ready' ||
      latest.draft.extras['showCancelled'] ||
      JSON.stringify(latest.draft) !== JSON.stringify(stored.draft)
    )
      throw new Error('stale show snapshot');
  };
  await assertCurrent();
  const data = showDraftDataSchema.parse(stored.draft.extras['show']);
  const slots = [...Array.from({ length: data.plan.imageCount }, (_, i) => `image-${i}`), 'video'];
  if (
    data.pending ||
    Object.keys(data.outputs).length !== slots.length ||
    new Set(Object.values(data.outputs).map((output) => output.attemptId)).size !== slots.length
  )
    throw new Error('incomplete show snapshot');
  const media = [];
  for (const slot of slots) {
    const receipt = data.outputs[slot];
    if (!receipt) throw new Error('incomplete show snapshot');
    const output = await deps.verified.get({
      tenantId,
      showId: draftId,
      attemptId: receipt.attemptId,
    });
    if (
      JSON.stringify(output.evidence.rawReceipt) !== JSON.stringify(receipt) ||
      output.result.mimeType !== (slot === 'video' ? 'video/mp4' : 'image/png')
    )
      throw new Error('show snapshot receipt mismatch');
    const item = { slot, ...output };
    if (visit) {
      await visit(item);
      item.result = { ...item.result, bytes: new Uint8Array() };
    }
    media.push(item);
  }
  await assertCurrent();
  return { tenantId, showId: draftId, version: stored.version, plan: data.plan, media };
}
