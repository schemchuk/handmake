import { dispatchShowBackfill } from './show-backfill';
import { createShowApproval } from './show-approval';
import { createShowVerificationStore } from './show-verification';
import type { ShowSourceImage } from '@handmake/core';
import { createTenantLookup } from './allow-list';
import { dispatchShow } from './show-start';
import { showDraftDataSchema } from '@handmake/core';
import { botTexts } from './texts';
import { createShowPreview } from './show-preview';
import { createR2MarkedShowStorage } from './show-storage';
import { createShowStart, readShowImage } from './show-start';
import { createGitHubWorkReader } from './work-reader';
import { createAiCostLedger } from './ai-costs';
import { createD1DraftStore } from './draft-store';
import type { Env } from './env';
import { createShowDraftFlow } from './show-draft-flow';
import { createShowGenerationLocks } from './show-generation-locks';
import { createR2ShowStorage } from './show-storage';
import { createShowTransport } from './show-transport';
import { createGitHubTenantConfigSource } from './tenant-config-source';

/** Worker prepares private inputs; paid generation and marking stay in Node. */
export function createShowRuntime(env: Env) {
  if (!env.SHOW_MEDIA || !env.SHOW_TRANSPORT_SECRET) return undefined;
  const bucket = env.SHOW_MEDIA;
  const drafts = createD1DraftStore(env.DB);
  const raw = createR2ShowStorage(bucket);
  const disabled = async (): Promise<never> => {
    throw new Error('paid execution disabled');
  };
  const original = async (tenant: string, ref: string): Promise<ShowSourceImage> => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(tenant) || !/^[A-Za-z0-9_-]{1,128}$/.test(ref))
      throw new Error('invalid private input');
    const object = await bucket.get(`show-input/v1/${tenant}/${ref}`);
    const mimeType = object?.httpMetadata?.contentType;
    if (
      !object ||
      !object.size ||
      object.size > 20_000_000 ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType ?? '')
    ) {
      await object?.body.cancel();
      throw new Error('private input unavailable');
    }
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      mimeType: mimeType as ShowSourceImage['mimeType'],
    };
  };
  const flow = createShowDraftFlow({
    drafts,
    configs: createGitHubTenantConfigSource({ repo: env.GITHUB_REPO, ref: 'main' }),
    ledger: createAiCostLedger(env.DB),
    locks: createShowGenerationLocks(env.DB),
    results: raw.results,
    generator: { generateImage: disabled, generateVideo: disabled },
    resolveImage: original,
  });
  const transport = createShowTransport({
    bucket,
    secret: env.SHOW_TRANSPORT_SECRET,
    drafts,
    flow,
  });
  const operator = createTenantLookup(env.TELEGRAM_SHOW_OPERATOR_IDS ?? '{}');
  return {
    ...transport,
    approval: createShowApproval({
      drafts,
      backfill: async (stored) => {
        const { tenantId, draftId } = stored.draft;
        // Recovery jobs can prepare existing outputs but cannot authorize provider calls.
        const job = await transport.open(tenantId, draftId, stored.version, true, true);
        return dispatchShowBackfill(bucket, job, () =>
          dispatchShow(env.GITHUB_REPO, env.GITHUB_DISPATCH_TOKEN, {
            tenantId,
            showId: draftId,
            jobId: job.id,
            version: stored.version,
          }),
        );
      },
      verified: createShowVerificationStore(bucket),
      works: createGitHubWorkReader({ repo: env.GITHUB_REPO, ref: 'main' }),
    }),
    recovery: {
      isOperator: (userId: number, tenantId: string) => operator(userId) === tenantId,
      async recover(stored: import('./draft-store').StoredDraft) {
        const { tenantId, draftId } = stored.draft;
        const data = showDraftDataSchema.parse(stored.draft.extras['show']);
        if (!data.pending || stored.draft.extras['showCancelled'])
          throw new Error('stale recovery');
        const job = await transport.open(tenantId, draftId, stored.version, true, true);
        await dispatchShow(env.GITHUB_REPO, env.GITHUB_DISPATCH_TOKEN, {
          tenantId,
          showId: draftId,
          jobId: job.id,
          version: stored.version,
        });
      },
      async reconcile(
        stored: import('./draft-store').StoredDraft,
        confirmation: import('./show-draft-flow').ShowReconciliation,
      ) {
        const latest = await drafts.get(stored.draft.tenantId, stored.draft.draftId);
        if (!latest || latest.version !== stored.version) return false;
        const data = showDraftDataSchema.parse(stored.draft.extras['show']);
        if (!data.pending) return false;
        return flow.reconcile(
          stored.draft.tenantId,
          stored.draft.draftId,
          data.pending.attemptId,
          confirmation,
          stored.version,
        );
      },
    },
    preview: createShowPreview({
      drafts,
      texts: botTexts,
      original,
      marked: createR2MarkedShowStorage(bucket),
    }),
    start: createShowStart({
      bucket,
      drafts,
      flow,
      configs: createGitHubTenantConfigSource({ repo: env.GITHUB_REPO, ref: 'main' }),
      works: createGitHubWorkReader({ repo: env.GITHUB_REPO, ref: 'main' }),
      open: (tenant, show, version) => transport.open(tenant, show, version, true),
      repo: env.GITHUB_REPO,
      token: env.GITHUB_DISPATCH_TOKEN,
      telegram: async (fileId) => {
        const response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId }),
          },
        );
        const data = (await response.json()) as {
          ok: boolean;
          result?: { file_path?: string; file_size?: number };
        };
        const path = data.result?.file_path;
        if (
          !response.ok ||
          !data.ok ||
          !path ||
          !/^[A-Za-z0-9_./-]+$/.test(path) ||
          path.split('/').includes('..') ||
          (data.result?.file_size ?? 0) > 20_000_000
        )
          throw new Error('private original unavailable');
        return readShowImage(
          await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`, {
            redirect: 'manual',
          }),
        );
      },
    }),
  };
}
