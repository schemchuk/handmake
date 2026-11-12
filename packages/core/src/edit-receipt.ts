import { z } from 'zod';

import { entryReferences, resolveEntryNames } from './entry-names';
import type { EntryNames } from './entry-names';
import type { SendOperation } from './ports/channel';

const text = z.string().max(8192);
const replyToOp = z.number().int().min(0).max(31).optional();
/** Rendered BEFORE name resolution. Operation order fixes layout across configuration changes. */
export const anonymousEditPlanSchema = z
  .object({
    version: z.literal(1),
    type: z.enum(['wotw-poll', 'wotw-result']),
    entryRefs: z
      .array(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/))
      .min(1)
      .max(10),
    allowNames: z.boolean(),
    // Secret names only, exactly as supplied to render/deliver; never resolved credentials.
    settings: z.record(z.string(), z.unknown()),
    operations: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              kind: z.literal('mediaGroup'),
              photoIndexes: z.array(z.number().int().min(0).max(9)).min(1).max(10),
              caption: text.optional(),
              captionLang: z.string().max(8).optional(),
              replyToOp,
            })
            .strict(),
          z
            .object({ kind: z.literal('message'), text, lang: z.string().max(8), replyToOp })
            .strict(),
          z
            .object({
              kind: z.literal('poll'),
              question: text,
              options: z.array(text).min(2).max(10),
              replyToOp,
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((plan, ctx) => {
    let valid =
      JSON.stringify(plan).length <= 65536 &&
      new Set(plan.entryRefs).size === plan.entryRefs.length;
    try {
      for (const [index, op] of plan.operations.entries()) {
        if (op.replyToOp !== undefined && op.replyToOp >= index) valid = false;
        const texts =
          op.kind === 'message'
            ? [op.text]
            : op.kind === 'mediaGroup'
              ? [op.caption ?? '']
              : [op.question, ...op.options];
        if (texts.flatMap(entryReferences).some((id) => !plan.entryRefs.includes(id)))
          valid = false;
      }
    } catch {
      valid = false;
    }
    if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid anonymous edit plan' });
  });
export type AnonymousEditPlan = z.infer<typeof anonymousEditPlanSchema>;

export const anonymousEditReceiptSchema = z
  .object({
    plan: anonymousEditPlanSchema,
    remoteIds: z
      .array(z.union([z.string().min(1).max(256), z.number().int()]))
      .min(1)
      .max(32),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (receipt) => receipt.remoteIds.length === receipt.plan.operations.length,
    'Incomplete operation IDs',
  );
export type AnonymousEditReceipt = z.infer<typeof anonymousEditReceiptSchema>;

/** Name-bearing projections stay transient; receipt and ledger always retain the source plan. */
export function resolveEditPlan(plan: AnonymousEditPlan, names: EntryNames): SendOperation[] {
  const resolve = (value: string, lang: string) =>
    resolveEntryNames(value, names, plan.allowNames, plan.entryRefs, lang);
  const primary = plan.operations.find(
    (op) => op.kind === 'message' || (op.kind === 'mediaGroup' && op.captionLang),
  );
  const language =
    primary?.kind === 'message'
      ? primary.lang
      : primary?.kind === 'mediaGroup'
        ? (primary.captionLang ?? 'en')
        : 'en';
  return plan.operations.map((op) =>
    op.kind === 'message'
      ? { ...op, text: resolve(op.text, op.lang) }
      : op.kind === 'mediaGroup'
        ? {
            ...op,
            ...(op.caption !== undefined
              ? { caption: resolve(op.caption, op.captionLang ?? language) }
              : {}),
          }
        : {
            ...op,
            question: resolve(op.question, language),
            options: op.options.map((value) => resolve(value, language)),
          },
  );
}
