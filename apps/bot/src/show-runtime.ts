import type { ShowSourceImage } from '@handmake/core';
import { createAiCostLedger } from './ai-costs';
import { createD1DraftStore } from './draft-store';
import type { Env } from './env';
import { createShowDraftFlow } from './show-draft-flow';
import { createShowGenerationLocks } from './show-generation-locks';
import { createR2ShowStorage } from './show-storage';
import { createShowTransport } from './show-transport';
import { createGitHubTenantConfigSource } from './tenant-config-source';

/** Private inputs are populated by later author/configuration tasks, never arbitrary URLs. */
export function createShowRuntime(env: Env) {
  if (!env.SHOW_MEDIA || !env.SHOW_TRANSPORT_SECRET) return undefined;
  const bucket = env.SHOW_MEDIA;
  const drafts = createD1DraftStore(env.DB);
  const raw = createR2ShowStorage(bucket);
  const disabled = async (): Promise<never> => {
    throw new Error('paid execution disabled');
  };
  const flow = createShowDraftFlow({
    drafts,
    configs: createGitHubTenantConfigSource({ repo: env.GITHUB_REPO, ref: 'main' }),
    ledger: createAiCostLedger(env.DB),
    locks: createShowGenerationLocks(env.DB),
    results: raw.results,
    generator: { generateImage: disabled, generateVideo: disabled },
    resolveImage: async (tenant, ref): Promise<ShowSourceImage> => {
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
    },
  });
  return createShowTransport({ bucket, secret: env.SHOW_TRANSPORT_SECRET, drafts, flow });
}
