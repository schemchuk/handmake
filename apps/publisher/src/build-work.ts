import { z } from 'zod';

import {
  contentSlugSchema,
  isoDateTime,
  workIdSchema,
  workKindSchema,
  workSchema,
  workVersionsSchema,
} from '@handmake/core';
import type { Work } from '@handmake/core';

/** Work-only contract; dispatch routing is connected in T36c. Date and identity survive retries. */
export const workPayloadSchema = z
  .object({
    kind: z.literal('work'),
    tenantId: contentSlugSchema,
    draftId: workIdSchema,
    date: isoDateTime,
    workKind: workKindSchema,
    collection: contentSlugSchema,
    fileIds: z.array(z.string().min(1)).min(1),
    versions: workVersionsSchema,
  })
  .strict();
export type WorkPayload = z.infer<typeof workPayloadSchema>;

export function buildWorkFromPayload(payload: unknown): Work {
  const input = workPayloadSchema.parse(payload);
  return workSchema.parse({
    id: input.draftId,
    tenant: input.tenantId,
    date: input.date,
    kind: input.workKind,
    collection: input.collection,
    photos: input.fileIds.map((_, i) => `photo-${i + 1}.jpg`),
    versions: input.versions,
  });
}
