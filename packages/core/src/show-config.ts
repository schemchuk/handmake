import { z } from 'zod';

import { contentSlugSchema, workKindSchema } from './work';
import type { Work } from './work';

const text = z.string().refine((s) => s.trim().length > 0, 'text must not be blank');

/** Reference is an opaque media-store identifier, resolved by the adapter. */
export const showModelSchema = z
  .object({
    id: contentSlugSchema,
    name: text,
    look: text,
    referenceImage: text,
    fictional: z.literal(true),
    adult: z.literal(true),
  })
  .strict();
export type ShowModel = z.infer<typeof showModelSchema>;

/** No provider-specific keys in the core; the composition root selects the adapter. */
export const showConfigSchema = z
  .object({
    models: z.array(showModelSchema).min(1),
    image: z.object({ model: text, eurPerImage: z.number().positive() }).strict(),
    video: z.object({ model: text, eurPerSecond: z.number().positive() }).strict(),
  })
  .strict()
  .refine((config) => new Set(config.models.map((m) => m.id)).size === config.models.length, {
    path: ['models'],
    message: 'model ids must be unique',
  });
export type ShowConfig = z.infer<typeof showConfigSchema>;

export const showTemplateSchema = workKindSchema;
export type ShowTemplate = z.infer<typeof showTemplateSchema>;

/** Work kinds already describe the three templates; an explicit author choice wins. */
export function selectShowTemplate(kind: Work['kind'], override?: ShowTemplate): ShowTemplate {
  return showTemplateSchema.parse(override ?? kind);
}
