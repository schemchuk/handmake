import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { isUlid, isoDateTime, versionSchema } from './post';

export const contentSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const workIdSchema = z.string().refine(isUlid, 'work id must be a ULID');
export const workKindSchema = z.enum(['worn', 'closeup', 'interior']);
export const workPhotoSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(jpg|jpeg|png|webp)$/);
const text = z.string().refine((value) => value.trim().length > 0, 'text must not be blank');
const localized = <T extends z.ZodType>(schema: T) =>
  z
    .record(z.string().regex(/^[a-z]{2}$/), schema)
    .refine((value) => Object.keys(value).length > 0, 'at least one language is required');

export const workVersionsSchema = localized(versionSchema.extend({ description: text }).strict());
export const workSchema = z
  .object({
    id: workIdSchema,
    tenant: contentSlugSchema,
    date: isoDateTime,
    collection: contentSlugSchema,
    kind: workKindSchema,
    photos: z
      .array(workPhotoSchema)
      .min(1)
      .refine((names) => new Set(names).size === names.length, 'duplicate photo names'),
    versions: workVersionsSchema,
  })
  .strict();
export type Work = z.infer<typeof workSchema>;

export const collectionSchema = z
  .object({
    tenant: contentSlugSchema,
    slug: contentSlugSchema,
    versions: localized(
      z.object({ title: text, description: text, ...versionSchema.shape }).strict(),
    ),
    order: z.number().int().nonnegative(),
    cover: z.object({ workId: workIdSchema, fileName: workPhotoSchema }).strict(),
  })
  .strict();
export type Collection = z.infer<typeof collectionSchema>;

// Descriptions live in localized frontmatter, not a second, potentially divergent body.
function parseDocument<T>(markdown: string, schema: z.ZodType<T>): T {
  const match = /^---\n([\s\S]*?)\n---\s*$/.exec(markdown.replace(/\r\n/g, '\n'));
  if (!match) throw new Error('expected a frontmatter-only content document');
  return schema.parse(parseYaml(match[1]!));
}
export const parseWork = (markdown: string): Work => parseDocument(markdown, workSchema);
export const parseCollection = (markdown: string): Collection =>
  parseDocument(markdown, collectionSchema);
export const serializeWork = (work: Work): string =>
  `---\n${stringifyYaml(workSchema.parse(work))}---\n`;
export const serializeCollection = (collection: Collection): string =>
  `---\n${stringifyYaml(collectionSchema.parse(collection))}---\n`;

/** Ascending configured order, then slug: shared by every store implementation. */
export function compareCollections(a: Collection, b: Collection): number {
  return a.order - b.order || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}
