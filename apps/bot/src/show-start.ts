import { showDraftDataSchema, showDraftPlanSchema } from '@handmake/core';
import type { ShowSourceImage, WorkReader } from '@handmake/core';
import type { StoredDraft, D1DraftStore } from './draft-store';
import type { ShowInput } from './show-input';
import type { TenantConfigSource } from './tenant-config-source';
import type { createShowDraftFlow } from './show-draft-flow';

const limit = 20_000_000;
const part = /^[A-Za-z0-9_-]{1,128}$/;
export type ShowStart = (stored: StoredDraft, regenerate?: string) => Promise<void>;

/** No provider calls: snapshot bounded private inputs, freeze the plan, dispatch Node. */
export function createShowStart(deps: {
  bucket: R2Bucket;
  drafts: D1DraftStore;
  configs: TenantConfigSource;
  works: WorkReader;
  flow: Pick<ReturnType<typeof createShowDraftFlow>, 'configure' | 'prepareRegeneration'>;
  open: (tenant: string, show: string, version: number) => Promise<{ id: string }>;
  telegram: (fileId: string) => Promise<ShowSourceImage>;
  repo: string;
  token: string;
  fetchImpl?: typeof fetch;
}): ShowStart {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const check = (image: ShowSourceImage) => {
    if (
      !image.bytes.length ||
      image.bytes.length > limit ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)
    )
      throw new Error('invalid show input');
    return image;
  };
  const privateImage = async (tenant: string, ref: string) => {
    if (!part.test(ref)) throw new Error('invalid private reference');
    const object = await deps.bucket.get(`show-input/v1/${tenant}/${ref}`);
    if (!object || !object.size || object.size > limit) {
      await object?.body.cancel();
      throw new Error('private input unavailable');
    }
    return check({
      bytes: new Uint8Array(await object.arrayBuffer()),
      mimeType: object.httpMetadata?.contentType as ShowSourceImage['mimeType'],
    });
  };
  const download = async (url: string): Promise<ShowSourceImage> => {
    // Workers reject redirect: 'error'; readShowImage refuses the unfollowed 3xx instead.
    const response = await fetchImpl(url, { redirect: 'manual' });
    return readShowImage(response);
  };
  return async (stored, regenerate) => {
    const { tenantId, draftId } = stored.draft;
    if (
      !part.test(tenantId) ||
      !part.test(draftId) ||
      stored.draft.kind !== 'show' ||
      !['collecting', 'failed', 'ready'].includes(stored.draft.state)
    )
      throw new Error('stale show');
    const latest = await deps.drafts.get(tenantId, draftId);
    if (!latest || latest.version !== stored.version) throw new Error('stale show');
    if (regenerate) {
      await deps.flow.prepareRegeneration(stored, regenerate);
      stored = (await deps.drafts.get(tenantId, draftId))!;
    } else if (stored.draft.state === 'ready') throw new Error('stale show');
    if (!stored.draft.extras['show']) {
      const tenant = await deps.configs.load(tenantId);
      const input = stored.draft.extras['showInput'] as ShowInput | undefined;
      const workId = (stored.draft.extras['showSelection'] as { workId?: string })?.workId;
      const work = workId ? await deps.works.readWork(tenantId, workId) : undefined;
      if (
        tenant.id !== tenantId ||
        !tenant.ai ||
        !tenant.shows ||
        !work ||
        work.tenant !== tenantId ||
        work.id !== workId ||
        !input?.ready ||
        input.menuConfig !== JSON.stringify(tenant.shows) ||
        input.originals.length < 2 ||
        input.originals.length > 3 ||
        new Set(input.originals.map((ref) => JSON.stringify(ref))).size !==
          input.originals.length ||
        (input.template !== 'interior' && !input.model) ||
        (input.model &&
          !tenant.shows.models.some((m) => JSON.stringify(m) === JSON.stringify(input.model)))
      )
        throw new Error('invalid show selection');
      showDraftPlanSchema.parse({
        workId,
        template: input.template,
        model: input.model,
        originals: ['validate-first', 'validate-second'],
        imageCount: 3,
        provider: { image: tenant.shows.image, video: tenant.shows.video },
      });
      // Validate every reference before downloading any private media.
      for (const ref of input.originals) {
        if (ref.kind === 'work') {
          if (ref.workId !== work.id || !work.photos.includes(ref.fileName))
            throw new Error('invalid work original');
        } else if (ref.kind !== 'telegram' || !ref.fileId) throw new Error('invalid original');
      }
      const snapshot = async (image: ShowSourceImage) => {
        check(image);
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', image.bytes)),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
        const key = `snapshot-${hash}`;
        await deps.bucket.put(`show-input/v1/${tenantId}/${key}`, image.bytes, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: image.mimeType },
        });
        return key;
      };
      const persona = input.model
        ? await snapshot(await privateImage(tenantId, input.model.referenceImage))
        : undefined;
      const originals: string[] = [];
      for (const ref of input.originals) {
        const image =
          ref.kind === 'telegram'
            ? await deps.telegram(ref.fileId)
            : await download(
                `https://raw.githubusercontent.com/${deps.repo}/main/content/works/${work.id}/photos/${encodeURIComponent(ref.fileName)}`,
              );
        originals.push(await snapshot(image));
      }
      const plan = showDraftPlanSchema.parse({
        workId,
        template: input.template,
        model: input.model,
        originals,
        imageCount: 3,
        provider: { image: tenant.shows.image, video: tenant.shows.video },
      });
      if (!(await deps.flow.configure(stored, plan, persona))) throw new Error('show changed');
      stored = (await deps.drafts.get(tenantId, draftId))!;
    }
    showDraftDataSchema.parse(stored.draft.extras['show']);
    const job = await deps.open(tenantId, draftId, stored.version);
    // Exact key order and stable job identity make retries share the workflow concurrency group.
    const payload = JSON.stringify({
      tenantId,
      showId: draftId,
      jobId: job.id,
      version: stored.version,
    });
    const response = await fetchImpl(
      `https://api.github.com/repos/${deps.repo}/actions/workflows/show.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deps.token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'handmake-bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { payload } }),
      },
    );
    if (response.status !== 204) throw new Error(`show dispatch failed: HTTP ${response.status}`);
  };
}

/** Bound actual streamed bytes, including responses without a Content-Length header. */
export async function readShowImage(response: Response): Promise<ShowSourceImage> {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('show input download failed');
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType ?? '')) {
    await response.body.cancel();
    throw new Error('invalid input type');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error('oversized input');
    }
    chunks.push(value);
  }
  if (!length) throw new Error('empty input');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, mimeType: mimeType as ShowSourceImage['mimeType'] };
}
