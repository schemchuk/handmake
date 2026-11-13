import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { isoDateTime } from './post';
import { showModelSchema, showTemplateSchema } from './show-config';
import { contentSlugSchema, workIdSchema, workPhotoSchema, workVersionsSchema } from './work';

const text = z.string().refine((s) => s.trim().length > 0, 'text must not be blank');
const videoFileSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.mp4$/);

/** A declaration verified by the marking adapter before approval, not proof by itself. */
export const aiMarkerSchema = z
  .object({
    visible: z.literal('KI-generiertes Model'),
    machineReadable: z.object({ format: text, value: text }).strict(),
  })
  .strict();

const generatedMetadata = {
  provenance: z.literal('ai-generated'),
  model: text,
  promptVersion: text,
  callId: text,
  marker: aiMarkerSchema,
};
export const showImageSchema = z
  .object({ fileName: workPhotoSchema, ...generatedMetadata })
  .strict();
export const showVideoSchema = z
  .object({
    fileName: videoFileSchema,
    durationSeconds: z.number().positive().max(15),
    ...generatedMetadata,
  })
  .strict();
export type ShowImage = z.infer<typeof showImageSchema>;
export type ShowVideo = z.infer<typeof showVideoSchema>;

export const showAuthenticMediaSchema = z.discriminatedUnion('kind', [
  z
    .object({
      fileName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(jpg|jpeg)$/),
      kind: z.literal('photo'),
      provenance: z.literal('human'),
      people: z.enum(['none', 'author', 'operator']),
    })
    .strict(),
  z
    .object({
      fileName: videoFileSchema,
      kind: z.literal('video'),
      provenance: z.literal('human'),
      people: z.enum(['none', 'author', 'operator']),
    })
    .strict(),
]);
export type ShowAuthenticMedia = z.infer<typeof showAuthenticMediaSchema>;

/** Stored file names only: no expiring provider URLs or platform-specific file ids. */
export const showSchema = z
  .object({
    id: workIdSchema,
    tenant: contentSlugSchema,
    date: isoDateTime,
    workId: workIdSchema,
    template: showTemplateSchema,
    siteExcluded: z.boolean().optional(),
    // Snapshot keeps past shows stable when the tenant's persona config changes.
    model: showModelSchema.optional(),
    provenance: z.literal('ai-assisted'),
    originals: z
      .array(z.object({ fileName: workPhotoSchema, provenance: z.literal('human') }).strict())
      .min(1),
    images: z.array(showImageSchema).min(3).max(5),
    video: showVideoSchema,
    authentic: z.array(showAuthenticMediaSchema).max(4).optional(),
    versions: workVersionsSchema,
  })
  .strict()
  .superRefine((show, ctx) => {
    if (show.template !== 'interior' && !show.model) {
      ctx.addIssue({ code: 'custom', path: ['model'], message: 'this template requires a model' });
    }
    const originals = show.originals.map((p) => p.fileName);
    const generated = [...show.images.map((p) => p.fileName), show.video.fileName];
    const authentic = show.authentic ?? [];
    const authenticNames = authentic.map((p) => p.fileName);
    if (
      authentic.filter((p) => p.kind === 'photo').length > 3 ||
      authentic.filter((p) => p.kind === 'video').length > 1 ||
      generated.length + authentic.length > 10
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authentic'],
        message: 'authentic media limits exceeded',
      });
    }
    if (
      new Set(authenticNames).size !== authenticNames.length ||
      authenticNames.some((name) => originals.includes(name) || generated.includes(name))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authentic'],
        message: 'authentic media file names must be disjoint',
      });
    }
    // Originals belong to the linked work; generated files belong to the show directory.
    if (
      new Set(originals).size !== originals.length ||
      new Set(generated).size !== generated.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'duplicate media file names' });
    }
  });
export type Show = z.infer<typeof showSchema>;

export function parseShow(markdown: string): Show {
  const match = /^---\n([\s\S]*?)\n---\s*$/.exec(markdown.replace(/\r\n/g, '\n'));
  if (!match) throw new Error('expected a frontmatter-only show document');
  return showSchema.parse(parseYaml(match[1]!));
}
export const serializeShow = (show: Show): string =>
  `---\n${stringifyYaml(showSchema.parse(show))}---\n`;

/** Opaque durable references; no bytes, provider URLs or credentials in dispatch. */
export const showPublicationSchema = z
  .object({
    show: showSchema,
    media: z
      .array(z.object({ fileName: z.string().min(1), ref: text }).strict())
      .min(4)
      .max(10),
  })
  .strict()
  .superRefine(({ show, media }, ctx) => {
    const names = [
      ...show.images.map((image) => image.fileName),
      show.video.fileName,
      ...(show.authentic ?? []).map((item) => item.fileName),
    ].sort();
    if (JSON.stringify(names) !== JSON.stringify(media.map((file) => file.fileName).sort())) {
      ctx.addIssue({ code: 'custom', message: 'show media must match declared files exactly' });
    }
  });
export type ShowPublication = z.infer<typeof showPublicationSchema>;
