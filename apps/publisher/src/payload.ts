import { z } from 'zod';

import { provenanceSchema } from '@handmake/core';

/**
 * Dispatch payload (T09): what the bot hands to the publisher when an author
 * approves a draft — texts per language plus opaque photo references, no
 * binary data and no secrets.
 */

export const dispatchPayloadSchema = z
  .object({
    tenantId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'tenantId must be kebab-case'),
    draftId: z.string().min(1),
    texts: z
      .record(
        z.string().regex(/^[a-z]{2}$/, 'language key must be a 2-letter code'),
        z.string().min(1),
      )
      .refine((texts) => Object.keys(texts).length > 0, 'texts must not be empty'),
    fileIds: z.array(z.string().min(1)),
    provenance: provenanceSchema,
  })
  .strict();

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
