import { z } from 'zod';
import { showConfigSchema, showModelSchema, showTemplateSchema } from './show-config';
import { workIdSchema } from './work';

const text = z.string().min(1);
export const showDraftPlanSchema = z
  .object({
    workId: workIdSchema,
    template: showTemplateSchema,
    model: showModelSchema.optional(),
    originals: z.array(text).min(1).max(3),
    imageCount: z.number().int().min(3).max(5),
    provider: z
      .object({ image: showConfigSchema.shape.image, video: showConfigSchema.shape.video })
      .strict(),
  })
  .strict()
  .refine((p) => p.template === 'interior' || !!p.model, 'template requires a persona');
export type ShowDraftPlan = z.infer<typeof showDraftPlanSchema>;
export const showReceiptSchema = z
  .object({
    attemptId: text,
    ref: text,
    callId: text,
    model: text,
    promptVersion: text,
    costEur: z.number().nonnegative(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  })
  .strict();
export const showDraftDataSchema = z
  .object({
    plan: showDraftPlanSchema,
    retired: z.array(showReceiptSchema).default([]),
    outputs: z.record(z.string().regex(/^(image-[0-4]|video)$/), showReceiptSchema).default({}),
    pending: z.object({ attemptId: text, slot: text, at: z.iso.datetime() }).strict().optional(),
    lease: text.optional(),
  })
  .strict();
export type ShowDraftData = z.infer<typeof showDraftDataSchema>;

export type ShowReceipt = z.infer<typeof showReceiptSchema>;
