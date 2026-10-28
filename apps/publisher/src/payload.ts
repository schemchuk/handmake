import { z } from 'zod';

import { pollSchema, postTypeSchema, provenanceSchema } from '@handmake/core';

/**
 * Dispatch payload (T09): what the bot hands to the publisher when an author
 * approves a draft — texts per language plus opaque photo references, no
 * binary data and no secrets. `wotw-poll` drafts additionally carry the
 * `poll` (question + one option per candidate photo, T21).
 */

export const dispatchPayloadSchema = z
  .object({
    tenantId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'tenantId must be kebab-case'),
    draftId: z.string().min(1),
    type: postTypeSchema.default('free'),
    texts: z
      .record(
        z.string().regex(/^[a-z]{2}$/, 'language key must be a 2-letter code'),
        z.string().min(1),
      )
      .refine((texts) => Object.keys(texts).length > 0, 'texts must not be empty'),
    fileIds: z.array(z.string().min(1)),
    poll: pollSchema.optional(),
    provenance: provenanceSchema,
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.type === 'wotw-poll') {
      if (!payload.poll) {
        ctx.addIssue({ code: 'custom', message: 'wotw-poll payload requires a poll' });
      } else if (payload.poll.options.length !== payload.fileIds.length) {
        ctx.addIssue({
          code: 'custom',
          message: `poll needs one option per candidate photo: ${payload.poll.options.length} options vs ${payload.fileIds.length} photos`,
        });
      }
    } else if (payload.poll) {
      ctx.addIssue({
        code: 'custom',
        message: `post type "${payload.type}" must not carry a poll`,
      });
    }
  });

export type DispatchPayload = z.infer<typeof dispatchPayloadSchema>;

export class PayloadParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadParseError';
  }
}

export function parseDispatchPayload(json: string): DispatchPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new PayloadParseError(`payload is not valid JSON: ${(error as Error).message}`);
  }
  const result = dispatchPayloadSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    throw new PayloadParseError(`invalid payload at ${path}: ${issue?.message ?? 'unknown error'}`);
  }
  return result.data;
}
