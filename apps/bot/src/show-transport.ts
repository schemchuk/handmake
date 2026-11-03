import { showDraftDataSchema, showReceiptSchema } from '@handmake/core';
import type { ShowFinishOutcome } from './show-finish';
import type { StoredDraft, D1DraftStore } from './draft-store';
import type { createShowDraftFlow, ShowCallGrant } from './show-draft-flow';
import { createR2MarkedShowStorage, createR2ShowStorage } from './show-storage';

import { createShowVerificationStore } from './show-verification';

export const showTransportPath = '/internal/shows/';
const limit = 20_000_000;
const part = /^[A-Za-z0-9_-]{1,128}$/;
type Flow = Pick<ReturnType<typeof createShowDraftFlow>, 'authorize' | 'accept'>;
type Job = {
  id: string;
  version: number;
  expires: number;
  busy?: number;
  recovery?: boolean;
  finished?: boolean;
};
type Scope = { tenantId: string; showId: string; attemptId: string };

/** No URLs or credentials in the protocol. All fields and exact bytes are signed. */
export async function showRequestSignature(secret: string, request: Request, bytes: Uint8Array) {
  const message = [
    request.method,
    new URL(request.url).pathname,
    request.headers.get('x-show-time') ?? '',
    request.headers.get('x-show-nonce') ?? '',
    request.headers.get('x-show-receipt') ?? '',
    await hash(bytes),
  ].join('\n');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))),
  );
}

export function createShowTransport(deps: {
  bucket: R2Bucket;
  secret: string;
  drafts: Pick<D1DraftStore, 'get'>;
  flow: Flow;
  notify?: (stored: StoredDraft, outcome: ShowFinishOutcome, recovery: boolean) => Promise<void>;
  now?: () => number;
}) {
  const { bucket, secret, drafts, flow } = deps;
  const now = deps.now ?? Date.now;
  const raw = createR2ShowStorage(bucket);
  const marked = createR2MarkedShowStorage(bucket);
  const verified = createShowVerificationStore(bucket);
  const jobKey = (tenant: string, show: string) => `show-job/v1/${tenant}/${show}`;
  const load = async (tenant: string, show: string) => {
    const object = await bucket.get(jobKey(tenant, show));
    if (!object || object.size > 1024) throw new Error('job unavailable');
    const job = JSON.parse(await object.text()) as Job;
    if (
      !part.test(job.id) ||
      !Number.isSafeInteger(job.version) ||
      !Number.isFinite(job.expires) ||
      (job.busy !== undefined && !Number.isFinite(job.busy))
    )
      throw new Error('invalid job');
    return { job, etag: object.etag };
  };

  return {
    /** Internal dispatch boundary only. Never exposed as an HTTP operation. */
    async open(tenantId: string, showId: string, version: number, reuse = false, recovery = false) {
      if (!secret || !part.test(tenantId) || !part.test(showId)) throw new Error('shows disabled');
      const draft = await drafts.get(tenantId, showId);
      if (
        !draft ||
        draft.draft.kind !== 'show' ||
        draft.version !== version ||
        draft.draft.extras['showCancelled']
      )
        throw new Error('stale show');
      const key = jobKey(tenantId, showId);
      const previous = await bucket.get(key);
      if (previous && reuse) {
        const { job } = await load(tenantId, showId);
        if (
          !job.finished &&
          job.version === version &&
          job.expires > now() &&
          !!job.recovery === recovery
        )
          return job;
        // A newer draft or an expired execution gets a new identity. Pending attempts
        // retain their grant and immutable journal; reopening never authorizes a replacement.
        if (job.version > version) throw new Error('stale show');
      }
      if (previous) {
        const busy = (await load(tenantId, showId)).job.busy;
        if (busy !== undefined && busy + 600_000 > now()) throw new Error('job requires recovery');
      }
      const job: Job = { id: crypto.randomUUID(), version, expires: now() + 60 * 60_000, recovery };
      if (previous && !recovery) {
        const prior = JSON.parse(await previous.text()) as Job;
        const data = showDraftDataSchema.parse(draft.draft.extras['show']);
        if (data.pending) {
          const attempt = data.pending.attemptId;
          const grant = await bucket.get(`show-grant/v1/${prior.id}/${attempt}`);
          if (!grant) throw new Error('grant requires reconciliation');
          for (let i = 0; i < 4; i++) {
            const source = await bucket.get(`show-source/v1/${prior.id}/${attempt}/source-${i}`);
            if (source && source.size <= limit)
              await bucket.put(
                `show-source/v1/${job.id}/${attempt}/source-${i}`,
                await source.arrayBuffer(),
                {
                  httpMetadata: source.httpMetadata,
                },
              );
          }
          await bucket.put(`show-grant/v1/${job.id}/${attempt}`, await grant.arrayBuffer());
        }
      }
      const saved = await bucket.put(key, JSON.stringify(job), {
        onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' },
      });
      if (!saved) throw new Error('job changed');
      return job;
    },

    async handle(request: Request): Promise<Response> {
      const reply = (status: number, value: unknown) =>
        Response.json(value, {
          status,
          headers: { 'cache-control': 'no-store' },
        });
      if (!secret) return reply(503, { error: 'shows disabled' });
      let unlock: (() => Promise<void>) | undefined;
      let recoveryClaim: string | undefined;
      try {
        const url = new URL(request.url);
        const parts = url.pathname.slice(showTransportPath.length).split('/');
        const [tenantId, showId, jobId, versionText, attemptId, operation] = parts;
        if (
          request.method !== 'POST' ||
          url.search ||
          parts.length !== 6 ||
          !parts.every((p) => part.test(p)) ||
          !/^\d+$/.test(versionText!)
        )
          return reply(400, { error: 'invalid request' });
        const timestamp = request.headers.get('x-show-time') ?? '';
        const nonce = request.headers.get('x-show-nonce') ?? '';
        if (
          !/^\d{13}$/.test(timestamp) ||
          Math.abs(now() - Number(timestamp)) > 300_000 ||
          !part.test(nonce)
        )
          return reply(401, { error: 'unauthorized' });
        const bytes = await bounded(
          request,
          ['raw-put', 'marked-put'].includes(operation!) ? limit : 4096,
        );
        const signature = await showRequestSignature(secret, request, bytes);
        const supplied = request.headers.get('x-show-signature') ?? '';
        if (!equal(signature, supplied)) return reply(401, { error: 'unauthorized' });
        const scope: Scope = { tenantId: tenantId!, showId: showId!, attemptId: attemptId! };
        const { job, etag } = await load(scope.tenantId, scope.showId);
        const draft = await drafts.get(scope.tenantId, scope.showId);
        if (
          !draft ||
          draft.draft.kind !== 'show' ||
          draft.draft.extras['showCancelled'] ||
          job.id !== jobId ||
          job.expires < now() ||
          (job.busy !== undefined && job.busy + 600_000 > now())
        )
          return reply(409, { error: 'stale job' });
        const data = showDraftDataSchema.parse(draft.draft.extras['show']);
        // Finish accepts the dispatch version: setup failures have no checkpoint version.
        // Nonce replay is harmless here: finished + etag claim delivery at most once.
        // Claim before delivery: ambiguous Telegram failures must never send a duplicate.
        if (operation === 'finish' && attemptId === 'next') {
          const { outcome } = JSON.parse(new TextDecoder().decode(bytes));
          if (!['ready', 'paid-calls-disabled', 'failed'].includes(outcome))
            return reply(400, { error: 'invalid outcome' });
          if (job.finished) return reply(200, { version: draft.version });
          if (
            outcome === 'ready' &&
            (data.pending ||
              (!job.recovery && Object.keys(data.outputs).length !== data.plan.imageCount + 1))
          )
            return reply(409, { error: 'unfinished job' });
          const claimed = await bucket.put(
            jobKey(scope.tenantId, scope.showId),
            JSON.stringify({ ...job, finished: true }),
            { onlyIf: { etagMatches: etag } },
          );
          if (!claimed) return reply(409, { error: 'job changed' });
          if (job.recovery)
            await bucket.delete(`show-backfill-dispatch/v1/${job.id}`).catch(() => undefined);
          await deps.notify?.(draft, outcome, job.recovery ?? false);
          return reply(200, { version: draft.version });
        }
        // Read-only restart discovery accepts an old version, never an old job identity.
        if (['status', 'backfill-release'].includes(operation!) && attemptId === 'next') {
          if (operation === 'backfill-release' && !job.recovery)
            return reply(409, { error: 'recovery required' });
          const replay = await bucket.put(`show-replay/v1/${job.id}/${nonce}`, '', {
            onlyIf: { etagDoesNotMatch: '*' },
          });
          if (!replay) return reply(409, { error: 'replay' });
          if (operation === 'backfill-release')
            await bucket.delete(`show-backfill-dispatch/v1/${job.id}`);
          return reply(200, {
            version: draft.version,
            pending: data.pending,
            outputs: data.outputs,
            recovery: job.recovery ?? false,
          });
        }
        if (job.version !== Number(versionText) || draft.version !== job.version)
          return reply(409, { error: 'stale job' });
        const known =
          data.pending?.attemptId === attemptId ||
          Object.values(data.outputs).some((output) => output.attemptId === attemptId);
        if (
          (operation === 'authorize' && attemptId !== 'next') ||
          (operation !== 'authorize' && !known)
        )
          return reply(409, { error: 'stale attempt' });
        const replay = await bucket.put(`show-replay/v1/${job.id}/${nonce}`, '', {
          onlyIf: { etagDoesNotMatch: '*' },
        });
        if (!replay) return reply(409, { error: 'replay' });
        const locked = await bucket.put(
          jobKey(scope.tenantId, scope.showId),
          JSON.stringify({ ...job, busy: now() }),
          { onlyIf: { etagMatches: etag } },
        );
        if (!locked) return reply(409, { error: 'job changed' });
        if (job.recovery) recoveryClaim = `show-backfill-dispatch/v1/${job.id}`;
        unlock = async () => {
          const latest = await drafts.get(scope.tenantId, scope.showId);
          if (!latest) throw new Error('draft unavailable');
          delete job.busy;
          // Only application checkpoints may advance this job's version fence.
          if (operation === 'authorize' || operation === 'checkpoint') job.version = latest.version;
          const saved = await bucket.put(
            jobKey(scope.tenantId, scope.showId),
            JSON.stringify(job),
            {
              onlyIf: { etagMatches: locked.etag },
            },
          );
          if (!saved) throw new Error('job changed');
        };
        let value: unknown;
        const json = () => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
        if (job.recovery && ['authorize', 'reserve', 'record', 'grant'].includes(operation!))
          throw new Error('recovery is GET-only');
        if (operation === 'authorize') {
          const grant = await flow.authorize(scope.tenantId, scope.showId);
          value = grant ? await wireGrant(grant, bucket, job.id) : null;
          if (grant)
            await bucket.put(
              `show-grant/v1/${job.id}/${grant.request.attemptId}`,
              JSON.stringify(value),
            );
        } else if (operation === 'grant') {
          const saved = await bucket.get(`show-grant/v1/${job.id}/${attemptId}`);
          if (!saved || saved.size > 32_000) throw new Error('grant unavailable');
          value = await saved.json();
        } else if (operation === 'reserve') {
          value = await raw.journal.reserve(scope, json()['fingerprint'] ?? '');
        } else if (operation === 'record') {
          await raw.journal.record(scope, json()['requestId'] ?? '');
        } else if (operation === 'stored') {
          value = {
            raw: !!(await raw.results.get(scope.tenantId, scope.showId, scope.attemptId)),
            marked: !!(await marked.get(scope.tenantId, scope.showId, scope.attemptId)),
          };
        } else if (operation === 'recovery') {
          if (!job.recovery || !data.pending || data.pending.attemptId !== attemptId)
            throw new Error('stale recovery');
          const ticket = await raw.readAttempt(scope);
          if (!ticket.requestId) throw new Error('billing reconciliation required');
          const video = data.pending.slot === 'video';
          value = {
            requestId: ticket.requestId,
            video,
            providerModel: video ? data.plan.provider.video.model : data.plan.provider.image.model,
            promptVersion: video ? 'show-video@1' : `show-${data.plan.template}@1`,
            costEur: video
              ? data.plan.provider.video.eurPerSecond * 5
              : data.plan.provider.image.eurPerImage,
          };
        } else if (operation === 'journal') {
          value = await raw.readAttempt(scope);
        } else if (operation === 'verified-put') {
          const evidence = JSON.parse(new TextDecoder().decode(bytes));
          if (
            evidence.tenantId !== scope.tenantId ||
            evidence.showId !== scope.showId ||
            evidence.attemptId !== scope.attemptId
          )
            throw new Error('verification scope mismatch');
          await verified.attest(evidence);
          if (job.recovery && !data.pending) {
            const outputs = Object.values(data.outputs);
            const complete =
              outputs.length === data.plan.imageCount + 1 &&
              (
                await Promise.all(
                  outputs.map((output) =>
                    bucket.head(
                      `show-verified/v1/${scope.tenantId}/${scope.showId}/${output.attemptId}`,
                    ),
                  ),
                )
              ).every(Boolean);
            if (complete) await bucket.delete(`show-backfill-dispatch/v1/${job.id}`);
          }
        } else if (operation === 'checkpoint') {
          value = await flow.accept(scope.tenantId, scope.showId, scope.attemptId);
        } else if (operation === 'raw-put' || operation === 'marked-put') {
          const receipt = showReceiptSchema.parse(
            JSON.parse(request.headers.get('x-show-receipt') ?? ''),
          );
          if (receipt.attemptId !== attemptId) throw new Error('invalid receipt');
          const ticket = await raw.readAttempt(scope);
          if (!ticket.requestId || receipt.callId !== `fal:${ticket.requestId}`)
            throw new Error('receipt does not match journal');
          if (operation === 'marked-put') {
            const original = await raw.results.get(scope.tenantId, scope.showId, scope.attemptId);
            if (
              !original ||
              Object.entries(original.result).some(
                ([key, value]) =>
                  key !== 'bytes' &&
                  key !== 'mimeType' &&
                  receipt[key as keyof typeof receipt] !== value,
              )
            )
              throw new Error('marked receipt changed');
          }
          const { ref: _ref, attemptId: _attempt, ...metadata } = receipt;
          await (operation === 'raw-put' ? raw.results : marked).put(
            scope.tenantId,
            scope.showId,
            scope.attemptId,
            { ...metadata, bytes },
          );
        } else if (operation === 'raw-get' || operation === 'marked-get') {
          const stored = await (operation === 'raw-get' ? raw.results : marked).get(
            scope.tenantId,
            scope.showId,
            scope.attemptId,
          );
          if (!stored) throw new Error('result unavailable');
          await unlock();
          unlock = undefined;
          const { bytes: media, ...receipt } = stored.result;
          return new Response(media, {
            headers: {
              'content-type': receipt.mimeType,
              'cache-control': 'no-store',
              'x-show-version': String(job.version),
              'x-show-receipt': JSON.stringify({ ...receipt, attemptId, ref: stored.ref }),
            },
          });
        } else if (/^source-[0-3]$/.test(operation!)) {
          const source = await bucket.get(`show-source/v1/${job.id}/${attemptId}/${operation}`);
          if (!source || !source.size || source.size > limit) throw new Error('source unavailable');
          await unlock();
          unlock = undefined;
          return new Response(source.body, {
            headers: {
              'content-type': source.httpMetadata?.contentType ?? 'application/octet-stream',
              'cache-control': 'no-store',
              'x-show-version': String(job.version),
            },
          });
        } else return reply(400, { error: 'unknown operation' });
        await unlock();
        unlock = undefined;
        return reply(200, { version: job.version, value: value ?? null });
      } catch {
        if (recoveryClaim) await bucket.delete(recoveryClaim).catch(() => undefined);
        console.warn('show transport operation rejected');
        return reply(409, { error: 'show operation rejected; inspect durable state before retry' });
      } finally {
        if (unlock) await unlock().catch(() => undefined);
      }
    },
  };
}

async function wireGrant(grant: ShowCallGrant, bucket: R2Bucket, job: string) {
  let index = 0;
  const source = async (image: { bytes: Uint8Array; mimeType: string }) => {
    if (!image.bytes.length || image.bytes.length > limit) throw new Error('invalid source');
    const id = `source-${index++}`;
    const saved = await bucket.put(
      `show-source/v1/${job}/${grant.request.attemptId}/${id}`,
      image.bytes,
      {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: image.mimeType },
      },
    );
    if (!saved) throw new Error('source changed');
    return { sourceId: id, mimeType: image.mimeType };
  };
  if (grant.kind === 'video')
    return {
      ...grant,
      request: {
        ...grant.request,
        image: await source(grant.request.image),
      },
    };
  const { originals, persona, ...request } = grant.request;
  return {
    kind: grant.kind,
    request: {
      ...request,
      originals: await Promise.all(originals.map(source)),
      ...(persona
        ? { persona: { model: persona.model, reference: await source(persona.reference) } }
        : {}),
    },
  };
}
async function bounded(request: Request, max: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error('body too large');
      }
      chunks.push(value);
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function hash(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}
