import { showDraftDataSchema, showDraftPlanSchema, showReceiptSchema } from '@handmake/core';
import type {
  DraftState,
  ShowDraftPlan,
  ShowReceipt,
  ShowGenerator,
  ShowResultStore,
  ShowSourceImage,
  ShowImageRequest,
  ShowVideoRequest,
} from '@handmake/core';
import type { D1DraftStore, StoredDraft } from './draft-store';
import type { TenantConfigSource } from './tenant-config-source';
import { assertCanStartShow } from './ai-costs';
import type { AiCostLedger } from './ai-costs';
import type { createShowGenerationLocks } from './show-generation-locks';

type Result = NonNullable<Awaited<ReturnType<ShowResultStore['get']>>>['result'];
export type ShowCallGrant =
  { kind: 'image'; request: ShowImageRequest } | { kind: 'video'; request: ShowVideoRequest };
type Operation =
  | { kind: 'authorize' }
  | { kind: 'accept'; attemptId: string; result?: Result }
  | { kind: 'recover'; attemptId: string; recovery: ShowRecovery }
  | { kind: 'reconcile'; attemptId: string; confirmation: ShowReconciliation };
/** Adapter reads an immutable journal identity and resumes GETs only; no submission fallback. */
export type ShowRecovery = {
  requestId(scope: {
    tenantId: string;
    showId: string;
    attemptId: string;
  }): Promise<string | undefined>;
  read(requestId: string): Promise<Result>;
};
/** The operator must check provider billing, including for reservations without a request id. */
export type ShowReconciliation = {
  operatorConfirmed: true;
  note: string;
  billing: Pick<ShowReceipt, 'callId' | 'model' | 'costEur'> | null;
};

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
  const flow = {
    async configure(stored: StoredDraft, input: ShowDraftPlan, privateModelReference?: string) {
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
      // Trusted preparation may replace only the validated persona's media pointer.
      if (plan.model && privateModelReference) plan.model.referenceImage = privateModelReference;
      return drafts.updateShow(
        {
          ...stored.draft,
          extras: { ...stored.draft.extras, show: showDraftDataSchema.parse({ plan }) },
          updatedAt: now().toISOString(),
        },
        stored.version,
      );
    },

    async run(
      tenantId: string,
      draftId: string,
      regenerate?: string,
      operation?: Operation,
    ): Promise<boolean | ShowCallGrant> {
      const found = await drafts.get(tenantId, draftId);
      if (!found || found.draft.kind !== 'show') return false;
      let current = found;
      const data = showDraftDataSchema.parse(current.draft.extras['show']);
      if (
        operation &&
        operation.kind !== 'authorize' &&
        data.pending?.attemptId !== operation.attemptId
      )
        return false;
      if (operation?.kind === 'reconcile' && operation.confirmation.billing) {
        const billing = operation.confirmation.billing;
        if (
          !billing.callId.trim() ||
          !billing.model.trim() ||
          !Number.isFinite(billing.costEur) ||
          billing.costEur < 0
        )
          throw new Error('show billing requires reconciliation: invalid billing');
      }
      if (operation?.kind === 'authorize' && data.pending)
        throw new Error('show outcome requires reconciliation; no new authorization');
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
        if (!(await locks.refresh(tenantId, lease, now())))
          throw new Error('show generation lease lost');
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
          if (data.pending && data.pending.slot !== slot)
            throw new Error('show checkpoint slot mismatch');
          if (operation?.kind === 'reconcile') {
            const confirmation = operation.confirmation;
            if (confirmation.operatorConfirmed !== true || !confirmation.note.trim())
              throw new Error('explicit operator reconciliation is required');
            const durable = await results.get(tenantId, draftId, data.pending!.attemptId);
            const billing = confirmation.billing;
            if (
              durable &&
              (!billing ||
                billing.callId !== durable.result.callId ||
                billing.model !== durable.result.model ||
                billing.costEur !== durable.result.costEur)
            )
              throw new Error('reconciliation must match durable billing');
            const previous = data.reconciled.find((r) => r.attemptId === data.pending!.attemptId);
            const evidence = {
              attemptId: data.pending!.attemptId,
              at: now().toISOString(),
              operatorConfirmed: confirmation.operatorConfirmed,
              note: confirmation.note,
              billing,
            };
            if (
              previous &&
              (previous.billing?.callId !== billing?.callId ||
                previous.billing?.model !== billing?.model ||
                previous.billing?.costEur !== billing?.costEur)
            )
              throw new Error('reconciliation billing is immutable');
            if (!previous) data.reconciled.push(evidence);
            // Save explicit evidence before booking; a failed ledger write keeps the pending marker.
            await save('translating');
            if (billing) await book(billing);
            delete data.pending;
            await save('failed');
            return true;
          }
          let durable;
          if (data.pending) {
            if (
              (operation?.kind === 'accept' && operation.result) ||
              operation?.kind === 'recover'
            ) {
              if (data.reconciled.some((r) => r.attemptId === data.pending!.attemptId))
                throw new Error('attempt has explicit reconciliation evidence');
              let result: Result;
              if (operation.kind === 'recover') {
                const requestId = await operation.recovery.requestId({
                  tenantId,
                  showId: draftId,
                  attemptId: data.pending.attemptId,
                });
                if (!requestId?.trim())
                  throw new Error('no journalled provider id; reconciliation required');
                result = await operation.recovery.read(requestId);
              } else result = operation.result!;
              try {
                await results.put(tenantId, draftId, data.pending.attemptId, result);
              } catch (error) {
                await book(result);
                throw error;
              }
              // Book even if the acknowledgement/read is lost after immutable persistence.
              await book(result);
            }
            if (data.reconciled.some((r) => r.attemptId === data.pending!.attemptId))
              throw new Error('finish explicit reconciliation before accepting output');
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
            const request: ShowCallGrant = video
              ? {
                  kind: 'video',
                  request: {
                    ...common,
                    image: first!.result as ShowSourceImage,
                    durationSeconds: 5,
                  },
                }
              : {
                  kind: 'image',
                  request: {
                    ...common,
                    originals: originals as [ShowSourceImage, ...ShowSourceImage[]],
                    ...(data.plan.template === 'interior'
                      ? { template: 'interior' as const, persona }
                      : { template: data.plan.template, persona: persona! }),
                  },
                };
            if (operation?.kind === 'authorize') {
              // Paused/resumable: release execution ownership, retain the uncertain tenant lock.
              await save('failed');
              return request;
            }
            const result =
              request.kind === 'video'
                ? await generator.generateVideo(request.request)
                : await generator.generateImage(request.request);
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
          await save(
            operation
              ? slots.every((key) => data.outputs[key])
                ? 'ready'
                : 'failed'
              : 'translating',
          );
          if (operation) return true;
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
        // A failed first checkpoint never persisted ownership of this acquired lease.
        if (!data.pending || current.version === found.version)
          await locks.release(tenantId, lease);
      }
    },
  };
  return {
    configure: flow.configure,
    /** Invalidate before dispatch, using the same tenant lock and optimistic version fence. */
    async prepareRegeneration(stored: StoredDraft, slot: string) {
      const { tenantId, draftId } = stored.draft;
      const data = showDraftDataSchema.parse(stored.draft.extras['show']);
      if (
        stored.draft.kind !== 'show' ||
        stored.draft.state !== 'ready' ||
        data.pending ||
        ![
          ...Array.from({ length: data.plan.imageCount }, (_, i) => `image-${i}`),
          'video',
        ].includes(slot)
      )
        throw new Error('invalid regeneration');
      const lease = crypto.randomUUID();
      if (!(await locks.acquireIdle(tenantId, draftId, lease, now())))
        throw new Error('show is busy');
      try {
        const tenant = await configs.load(tenantId);
        if (tenant.id !== tenantId || !tenant.ai || !tenant.shows)
          throw new Error('show generation is disabled');
        await assertCanStartShow(ledger, tenantId, tenant.ai, now());
        const summary = await ledger.summary(tenantId, now());
        const estimate =
          data.plan.provider.video.eurPerSecond * 5 +
          (slot === 'video' ? 0 : data.plan.provider.image.eurPerImage);
        if (summary.total + estimate > tenant.ai.monthlyTargetEur + tenant.ai.toleranceEur)
          throw new Error('show call would exceed the monthly cap');
        for (const key of slot === 'video' ? ['video'] : [slot, 'video']) {
          if (data.outputs[key]) data.retired.push(data.outputs[key]!);
          delete data.outputs[key];
        }
        if (
          !(await drafts.updateShow(
            {
              ...stored.draft,
              state: 'failed',
              updatedAt: now().toISOString(),
              extras: { ...stored.draft.extras, show: data },
            },
            stored.version,
          ))
        )
          throw new Error('stale show');
      } finally {
        await locks.release(tenantId, lease);
      }
    },
    async generate(tenantId: string, draftId: string, regenerate?: string) {
      return (await flow.run(tenantId, draftId, regenerate)) === true;
    },
    async authorize(tenantId: string, draftId: string, regenerate?: string) {
      const result = await flow.run(tenantId, draftId, regenerate, { kind: 'authorize' });
      return typeof result === 'object' ? result : undefined;
    },
    async accept(tenantId: string, draftId: string, attemptId: string, result?: Result) {
      return (
        (await flow.run(tenantId, draftId, undefined, { kind: 'accept', attemptId, result })) ===
        true
      );
    },
    async recover(tenantId: string, draftId: string, attemptId: string, recovery: ShowRecovery) {
      return (
        (await flow.run(tenantId, draftId, undefined, { kind: 'recover', attemptId, recovery })) ===
        true
      );
    },
    async reconcile(
      tenantId: string,
      draftId: string,
      attemptId: string,
      confirmation: ShowReconciliation,
    ) {
      return (
        (await flow.run(tenantId, draftId, undefined, {
          kind: 'reconcile',
          attemptId,
          confirmation,
        })) === true
      );
    },
  };
}
