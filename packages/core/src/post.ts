import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

export const provenanceValues = ['human', 'ai-assisted', 'ai-generated'] as const;
export const provenanceSchema = z.enum(provenanceValues);
export type Provenance = z.infer<typeof provenanceSchema>;

export const versionSchema = z.object({
  provenance: provenanceSchema,
  model: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
});
export type Version = z.infer<typeof versionSchema>;

export const postTypeSchema = z.enum([
  'free',
  'announcement',
  'reminder',
  'wotw-poll',
  'wotw-result',
]);
export type PostType = z.infer<typeof postTypeSchema>;

/**
 * A channel poll attached to a `wotw-poll` post (ADR 008): the question and
 * one option per candidate photo, in album order. Network-agnostic here;
 * per-network limits are enforced by the channel render.
 */
export const pollSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
});
export type PostPoll = z.infer<typeof pollSchema>;

// Crockford's Base32, 26 chars — https://github.com/ulid/spec
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ulidRegex.test(value);
}

export const isoDateTime = z.iso.datetime({ offset: true });

export const frontmatterSchema = z
  .object({
    id: z.string().regex(ulidRegex, 'id must be a ULID (26 chars, Crockford Base32)'),
    tenant: z.string().min(1),
    date: isoDateTime,
    publishAt: z.union([z.literal('now'), isoDateTime]),
    type: postTypeSchema,
    photos: z.array(z.string().min(1)),
    channels: z.array(z.string().min(1)),
    poll: pollSchema.optional(),
    versions: z
      .record(z.string().regex(/^[a-z]{2}$/, 'language key must be a 2-letter code'), versionSchema)
      .refine((v) => Object.keys(v).length > 0, 'versions must declare at least one language'),
  })
  .superRefine((post, ctx) => {
    if (post.type === 'wotw-poll') {
      if (!post.poll) {
        ctx.addIssue({ code: 'custom', message: 'wotw-poll requires a poll (question + options)' });
      } else if (post.poll.options.length !== post.photos.length) {
        ctx.addIssue({
          code: 'custom',
          message: `poll needs one option per candidate photo: ${post.poll.options.length} options vs ${post.photos.length} photos`,
        });
      }
    } else if (post.poll) {
      ctx.addIssue({ code: 'custom', message: `post type "${post.type}" must not carry a poll` });
    }
  });
export type PostFrontmatter = z.infer<typeof frontmatterSchema>;

export interface Post extends PostFrontmatter {
  /** Language code (e.g. "uk") -> post text for that language. */
  texts: Record<string, string>;
}

export class PostParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostParseError';
  }
}

const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const langMarkerRegex = /^<!-- lang:([a-z]{2}) -->$/;

function parseSections(body: string): Record<string, string> {
  const texts: Record<string, string> = {};
  let currentLang: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLang === null) return;
    while (currentLines.length > 0 && currentLines[0]!.trim() === '') currentLines.shift();
    while (currentLines.length > 0 && currentLines[currentLines.length - 1]!.trim() === '') {
      currentLines.pop();
    }
    if (currentLines.length === 0) {
      throw new PostParseError(`empty language section: lang:${currentLang}`);
    }
    texts[currentLang] = currentLines.join('\n');
  };

  for (const line of body.split('\n')) {
    const match = langMarkerRegex.exec(line.trim());
    if (match) {
      flush();
      const lang = match[1]!;
      if (lang in texts) {
        throw new PostParseError(`duplicate language section: lang:${lang}`);
      }
      currentLang = lang;
      currentLines = [];
    } else if (currentLang !== null) {
      currentLines.push(line);
    }
  }
  flush();

  if (Object.keys(texts).length === 0) {
    throw new PostParseError('post body has no <!-- lang:xx --> sections');
  }
  return texts;
}

export function parsePost(markdown: string): Post {
  // Tolerate CRLF files (Windows editors, GitHub web UI).
  const normalized = markdown.replace(/\r\n/g, '\n');
  const match = frontmatterRegex.exec(normalized);
  if (!match) {
    throw new PostParseError('post must start with a --- frontmatter block');
  }

  const [, frontmatterText, body] = match;
  let raw: unknown;
  try {
    raw = parseYaml(frontmatterText!);
  } catch (error) {
    throw new PostParseError(`frontmatter is not valid YAML: ${(error as Error).message}`);
  }

  const result = frontmatterSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    throw new PostParseError(
      `invalid frontmatter at ${path}: ${issue?.message ?? 'unknown error'}`,
    );
  }

  const frontmatter = result.data;
  const texts = parseSections(body!);

  for (const lang of Object.keys(frontmatter.versions)) {
    if (!(lang in texts)) {
      throw new PostParseError(`missing language section for declared version: lang:${lang}`);
    }
  }
  for (const lang of Object.keys(texts)) {
    if (!(lang in frontmatter.versions)) {
      throw new PostParseError(`language section without a declared version: lang:${lang}`);
    }
  }

  return { ...frontmatter, texts };
}

export function serializePost(post: Post): string {
  const { texts, ...frontmatter } = post;
  let out = `---\n${stringifyYaml(frontmatter)}---\n`;
  for (const [lang, text] of Object.entries(texts)) {
    out += `\n<!-- lang:${lang} -->\n\n${text}\n`;
  }
  return out;
}

/**
 * Sort order of `ContentStore.listPosts`: newest first by `date` (compared as
 * instants, since dates carry offsets), then by id descending, so every
 * store returns the same order for the same posts.
 */
export function compareNewestFirst(
  a: Pick<Post, 'date' | 'id'>,
  b: Pick<Post, 'date' | 'id'>,
): number {
  const byDate = Date.parse(b.date) - Date.parse(a.date);
  if (byDate !== 0) return byDate;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
