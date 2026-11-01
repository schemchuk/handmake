import { z } from 'zod';

import { isoDateTime } from './post';
import { collectionSchema, contentSlugSchema, workKindSchema, workVersionsSchema } from './work';

/** Approved work metadata shared by the bot job and publisher dispatch. No generated copy here. */
export const workPublicationSchema = z
  .object({
    date: isoDateTime,
    kind: workKindSchema,
    collection: contentSlugSchema,
    versions: workVersionsSchema,
    /** Empty means site-only; names are resolved through the tenant's channel registry. */
    channels: z.array(z.string().min(1)).refine((names) => new Set(names).size === names.length),
    /** Cover/identity come from the first work, never arbitrary paths supplied by the client. */
    newCollection: collectionSchema.pick({ versions: true, order: true }).optional(),
  })
  .strict();
export type WorkPublication = z.infer<typeof workPublicationSchema>;
