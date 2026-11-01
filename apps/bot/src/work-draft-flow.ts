import { readWorkDraftData, workDraftConfigSchema, workDraftDataSchema } from '@handmake/core';
import type { DraftState, TextGenerator, WorkDraftConfig } from '@handmake/core';

import { translationStaleMs } from './draft-store';
import type { D1DraftStore, StoredDraft } from './draft-store';

type WorkDraftFlowDeps = {
  drafts: D1DraftStore;
  textGeneratorFor: (tenantId: string, workId: string) => Promise<TextGenerator>;
  now?: () => Date;
};

/** Application flow only; T36c3 supplies the allow-list gate, background runner and approval UI. */
export function createWorkDraftFlow({
  drafts,
  textGeneratorFor,
  now = () => new Date(),
}: WorkDraftFlowDeps) {
  return {
    async configure(stored: StoredDraft, input: WorkDraftConfig): Promise<boolean> {
      const draft = stored.draft;
      if (draft.kind !== 'work' || !['collecting', 'failed', 'ready'].includes(draft.state))
        return false;
      const config = workDraftConfigSchema.parse(input);
      const previous = Object.hasOwn(draft.extras, 'work') ? readWorkDraftData(draft) : undefined;
      if (previous?.uaPending) throw new Error('UA outcome requires reconciliation');
      if (
        previous?.generated &&
        (config.kind !== previous.config.kind || config.collection !== previous.config.collection)
      ) {
        throw new Error('generated work template/collection cannot be changed');
      }
      const data = workDraftDataSchema.parse({ ...previous, config });
      return drafts.updateWork(
        { ...draft, extras: { ...draft.extras, work: data }, updatedAt: now().toISOString() },
        stored.version,
      );
    },

    async generate(tenantId: string, draftId: string, regenerateGerman = false): Promise<boolean> {
      const found = await drafts.get(tenantId, draftId);
      if (!found || found.draft.kind !== 'work') return false;
      let current = found;
      const draft = current.draft;
      const stale =
        draft.state === 'translating' &&
        Date.parse(draft.updatedAt) < now().getTime() - translationStaleMs;
      if (
        !['collecting', 'failed'].includes(draft.state) &&
        !stale &&
        !(regenerateGerman && draft.state === 'ready')
      )
        return false;
      const data = readWorkDraftData(draft);
      if (data.uaPending && !data.generated?.['uk'])
        throw new Error('UA outcome requires reconciliation');
      if (!draft.texts['uk']?.trim() || !draft.photoRefs.length)
        throw new Error('work requires note and photos');

      // Every async result quotes its own row version, including stale-claim recovery.
      const save = async (state: DraftState, texts = current.draft.texts) => {
        const next = {
          ...current.draft,
          state,
          texts,
          updatedAt: now().toISOString(),
          extras: { ...current.draft.extras, work: workDraftDataSchema.parse(data) },
        };
        if (!(await drafts.updateWork(next, current.version)))
          throw new Error('work draft changed during generation');
        current = { ...current, draft: next, version: current.version + 1 };
      };
      await save('translating');
      try {
        const generator = await textGeneratorFor(tenantId, draftId);
        if (!data.generated?.['uk']) {
          data.uaPending = true;
          await save('translating');
          const uk = await generator.generateUkrainian({
            note: current.draft.texts['uk']!,
            kind: data.config.kind,
            collection: data.config.collection,
          });
          data.generated = { uk: uk.version };
          data.notes['uk'] = uk.notes;
          data.uaPending = false;
          await save('translating', { ...current.draft.texts, uk: uk.version.description });
        }
        const de = await generator.translateUkrainian(current.draft.texts['uk']!);
        data.generated = { ...data.generated, de: de.version };
        data.notes['de'] = de.notes;
        await save('ready', { ...current.draft.texts, de: de.version.description });
        return true;
      } catch (error) {
        // Preserve the last durable checkpoint. A newer claim/edit/discard makes this CAS a no-op.
        await drafts
          .updateWork(
            { ...current.draft, state: 'failed', updatedAt: now().toISOString() },
            current.version,
          )
          .catch(() => false);
        throw error;
      }
    },
  };
}
