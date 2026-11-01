import { showDraftDataSchema, showDraftPlanSchema, showReceiptSchema } from '@handmake/core';
import type {
  DraftState,
  ShowDraftPlan,
  ShowReceipt,
  ShowGenerator,
  ShowResultStore,
  ShowSourceImage,
} from '@handmake/core';
import type { D1DraftStore, StoredDraft } from './draft-store';
import type { TenantConfigSource } from './tenant-config-source';
import { assertCanStartShow } from './ai-costs';
import type { AiCostLedger } from './ai-costs';
import type { createShowGenerationLocks } from './show-generation-locks';

export const maxShowMediaBytes = 20_000_000;
type Deps = {
  drafts: D1DraftStore;
  configs: TenantConfigSource;
  ledger: AiCostLedger;
  locks: ReturnType<typeof createShowGenerationLocks>;
  generator: ShowGenerator;
  results: ShowResultStore;
  resolveImage: (tenantId: string, ref: string) => Promise<ShowSourceImage>;
  now?: () => Date;
};

/** Unwired application service: T44d supplies durable results; T44e supplies the UI. */
export function createShowDraftFlow(deps: Deps) {
  const { drafts, configs, ledger, locks, generator, results, resolveImage } = deps;
  const now = deps.now ?? (() => new Date());
  return {
    async configure(stored: StoredDraft, input: ShowDraftPlan) {
      if (
        stored.draft.kind !== 'show' ||
        stored.draft.state !== 'collecting' ||
        stored.draft.extras['show']
      )
        throw new Error('show plan is immutable once configured');
      const plan = showDraftPlanSchema.parse(input);
      const tenant = await configs.load(stored.draft.tenantId);
      if (tenant.id !== stored.draft.tenantId || !tenant.shows || !tenant.ai)
        throw new Error('show generation is disabled');
      if (
        JSON.stringify(plan.provider) !==
          JSON.stringify({ image: tenant.shows.image, video: tenant.shows.video }) ||
        (plan.model &&
          !tenant.shows.models.some(
            (model) => JSON.stringify(model) === JSON.stringify(plan.model),
          ))
      )
        throw new Error('show plan must match tenant models and pricing');
      return drafts.updateShow(
        {
          ...stored.draft,
          extras: { ...stored.draft.extras, show: showDraftDataSchema.parse({ plan }) },
          updatedAt: now().toISOString(),
        },
        stored.version,
      );
    },

    async generate(tenantId: string, draftId: string, regenerate?: string): Promise<boolean> {
      const found = await drafts.get(tenantId, draftId);
      if (!found || found.draft.kind !== 'show') return false;
      let current = found;
      const data = showDraftDataSchema.parse(current.draft.extras['show']);
      const stale =
        current.draft.state === 'translating' &&
        Date.parse(current.draft.updatedAt) < now().getTime() - 10 * 60_000;
      if (
        !['collecting', 'failed'].includes(current.draft.state) &&
        !stale &&
        !(current.draft.state === 'ready' && regenerate)
      )
        return false;
      const slots = [
        ...Array.from({ length: data.plan.imageCount }, (_, i) => `image-${i}`),
        'video',
      ];
      if (
        regenerate &&
        (!slots.includes(regenerate) || data.pending || current.draft.state !== 'ready')
      )
        throw new Error('regeneration requires a completed show and valid slot');
      const tenant = await configs.load(tenantId);
      if (tenant.id !== tenantId || !tenant.ai || !tenant.shows)
        throw new Error('show generation is disabled');
      const lease = crypto.randomUUID();
      if (
        !(await locks.acquire(
          tenantId,
          draftId,
          lease,
          now(),
          current.draft.state === 'failed' ? data.lease : undefined,
        ))
      )
        return false;
      const save = async (state: DraftState) => {
        const next = {
          ...current.draft,
          state,
          updatedAt: now().toISOString(),
          extras: { ...current.draft.extras, show: showDraftDataSchema.parse(data) },
        };
        if (!(await drafts.updateShow(next, current.version)))
          throw new Error('show draft changed during generation');
        current = { ...current, draft: next, version: current.version + 1 };
      };
      data.lease = lease;
      try {
        await save('translating');
        if (regenerate) {
          for (const slot of regenerate === 'video' ? ['video'] : [regenerate, 'video']) {
            if (data.outputs[slot]) data.retired.push(data.outputs[slot]!);
          }
          delete data.outputs[regenerate];
          if (regenerate !== 'video') delete data.outputs['video'];
          await save('translating');
        }
        for (const slot of slots) {
          if (data.outputs[slot]) continue;
          const video = slot === 'video';
          const model = video ? data.plan.provider.video.model : data.plan.provider.image.model;
          const promptVersion = video ? 'show-video@1' : `show-${data.plan.template}@1`;
          const book = (result: Pick<ShowReceipt, 'callId' | 'model' | 'costEur'>) => {
            if (!result.callId?.trim() || !result.model?.trim())
              throw new Error('show billing requires reconciliation');
            return ledger.recordCost(tenantId, {
              id: result.callId,
              at: new Date(data.pending!.at),
              service: `show-${video ? 'video' : 'image'}:${result.model}`,
              unit: video ? 'video' : 'image',
              amountEur: result.costEur,
              ref: `show:${draftId}`,
            });
          };
          let durable;
          if (data.pending) {
            if (data.pending.slot !== slot) throw new Error('show checkpoint slot mismatch');
            durable = await results.get(tenantId, draftId, data.pending.attemptId);
            if (!durable)
              throw new Error('show outcome requires reconciliation; never retry the paid call');
          } else {
            // Resolve inputs before the paid-call marker: input failures have no uncertain billing.
            const originals = await Promise.all(
              data.plan.originals.map((ref) => resolveImage(tenantId, ref)),
            );
            const persona = data.plan.model
              ? {
                  model: data.plan.model,
                  reference: await resolveImage(tenantId, data.plan.model.referenceImage),
                }
              : undefined;
            const first = video
              ? await results.get(tenantId, draftId, data.outputs['image-0']!.attemptId)
              : undefined;
            if (video && (!first || first.result.mimeType === 'video/mp4'))
              throw new Error('video source image is missing');
            await assertCanStartShow(ledger, tenantId, tenant.ai, now());
            const estimate = video
              ? data.plan.provider.video.eurPerSecond * 5
              : data.plan.provider.image.eurPerImage;
            const summary = await ledger.summary(tenantId, now());
            if (summary.total + estimate > tenant.ai.monthlyTargetEur + tenant.ai.toleranceEur)
              throw new Error('show call would exceed the monthly cap');
            data.pending = { attemptId: crypto.randomUUID(), slot, at: now().toISOString() };
            await save('translating');
            const common = {
              tenantId,
              showId: draftId,
              attemptId: data.pending.attemptId,
              providerModel: model,
              promptVersion,
            };
            const result = video
              ? await generator.generateVideo({
                  ...common,
                  image: first!.result as ShowSourceImage,
                  durationSeconds: 5,
                })
              : await generator.generateImage({
                  ...common,
                  originals: originals as [ShowSourceImage, ...ShowSourceImage[]],
                  ...(data.plan.template === 'interior'
                    ? { template: 'interior' as const, persona }
                    : { template: data.plan.template, persona: persona! }),
                });
            try {
              await results.put(tenantId, draftId, data.pending.attemptId, result);
            } catch (error) {
              await book(result);
              throw error;
            }
            durable = await results.get(tenantId, draftId, data.pending.attemptId);
            if (!durable) {
              await book(result);
              throw new Error('durable show result is missing');
            }
          }
          const result = durable.result;
          await book(result);
          if (
            result.model !== model ||
            result.promptVersion !== promptVersion ||
            !result.bytes.length ||
            result.bytes.length > maxShowMediaBytes ||
            (video ? result.mimeType !== 'video/mp4' : !result.mimeType.startsWith('image/'))
          )
            throw new Error('show result requires reconciliation: invalid model, prompt or media');
          const { bytes: _bytes, ...receipt } = result;
          data.outputs[slot] = showReceiptSchema.parse({
            ...receipt,
            attemptId: data.pending!.attemptId,
            ref: durable.ref,
          });
          delete data.pending;
          await save('translating');
        }
        await save('ready');
        return true;
      } catch (error) {
        // Persist only the last durable snapshot; never clear a paid marker on error.
        await drafts
          .updateShow(
            { ...current.draft, state: 'failed', updatedAt: now().toISOString() },
            current.version,
          )
          .catch(() => false);
        throw error;
      } finally {
        if (!data.pending) await locks.release(tenantId, lease);
      }
    },
  };
}
