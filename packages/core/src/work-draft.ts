import { z } from 'zod';

import type { Draft } from './ports/store';
import type { PublishJob } from './ports/services';
import { workIdSchema, workVersionsSchema } from './work';
import { workPublicationSchema } from './work-publication';

export const workDraftConfigSchema = workPublicationSchema.omit({ date: true, versions: true });
export const workDraftDataSchema = z
  .object({
    config: workDraftConfigSchema,
    generated: workVersionsSchema
      .refine((v) => !!v['uk'] && Object.keys(v).every((lang) => lang === 'uk' || lang === 'de'))
      .optional(),
    notes: z.record(z.string(), z.string()).default({}),
    /** Set before paying for UA; an interrupted attempt must not silently generate it again. */
    uaPending: z.boolean().default(false),
  })
  .strict();
export type WorkDraftData = z.infer<typeof workDraftDataSchema>;
export type WorkDraftConfig = z.infer<typeof workDraftConfigSchema>;

export function readWorkDraftData(draft: Draft): WorkDraftData {
  if (draft.kind !== 'work') throw new Error('expected a work draft');
  return workDraftDataSchema.parse(draft.extras['work']);
}

/** Call only from explicit approval, using the freshly claimed publishing snapshot. */
export function buildApprovedWorkJob(draft: Draft): PublishJob {
  if (!['ready', 'publishing'].includes(draft.state) || !draft.photoRefs.length)
    throw new Error('work is not ready for approval');
  workIdSchema.parse(draft.draftId);
  const data = readWorkDraftData(draft);
  if (data.uaPending || !data.generated?.['de']) throw new Error('work generation is incomplete');
  const provenance =
    draft.texts['uk'] === data.generated['uk']!.description ? 'ai-generated' : 'ai-assisted';
  const versions = Object.fromEntries(
    ['uk', 'de'].map((lang) => [
      lang,
      {
        ...data.generated![lang]!,
        description: draft.texts[lang],
        provenance,
      },
    ]),
  );
  return {
    tenantId: draft.tenantId,
    postId: draft.draftId,
    kind: 'work',
    type: 'free',
    texts: { uk: draft.texts['uk']!, de: draft.texts['de']! },
    fileIds: [...draft.photoRefs],
    provenance,
    work: workPublicationSchema.parse({ ...data.config, date: draft.createdAt, versions }),
  };
}
