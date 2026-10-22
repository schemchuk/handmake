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

// Crockford's Base32, 26 chars — https://github.com/ulid/spec
const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const isoDateTime = z.iso.datetime({ offset: true });

export const frontmatterSchema = z.object({
  id: z.string().regex(ulidRegex, 'id must be a ULID (26 chars, Crockford Base32)'),
  tenant: z.string().min(1),
  date: isoDateTime,
  publishAt: z.union([z.literal('now'), isoDateTime]),
  type: postTypeSchema,
  photos: z.array(z.string().min(1)),
  channels: z.array(z.string().min(1)),
  versions: z
    .record(z.string().regex(/^[a-z]{2}$/, 'language key must be a 2-letter code'), versionSchema)
    .refine((v) => Object.keys(v).length > 0, 'versions must declare at least one language'),
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
  const match = frontmatterRegex.exec(markdown);
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
