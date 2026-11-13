import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { instagramCarouselFrame } from '@handmake/channels';
import type { SendOperation } from '@handmake/core';
import sharp from 'sharp';

import type { GitCommitter } from './git';
import { requiredEnv } from './required-env';

/**
 * Instagram publishing wiring (T26a3): Meta pulls photos from public
 * raw-GitHub URLs, so the publisher frames every image to the 4:5 feed
 * canvas with sharp and commits the copy beside the item BEFORE delivery,
 * and (when the workflow opts in via CONTENT_PUSH_BEFORE_DELIVERY) pushes
 * the content commit so the URLs resolve when Meta fetches them. Every
 * photo is framed — Instagram rejects feed images outside 4:5..1.91:1, so
 * an unframed phone portrait would fail container creation.
 */

/**
 * Base URL serving the repo's raw content: the CONTENT_RAW_BASE_URL override
 * (local runs/tests) or GitHub Actions' raw endpoint built from
 * GITHUB_REPOSITORY + GITHUB_REF_NAME; undefined anywhere else.
 */
export function contentRawBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const override = env['CONTENT_RAW_BASE_URL'];
  if (override !== undefined && override !== '') return override.replace(/\/+$/, '');
  const repo = env['GITHUB_REPOSITORY'];
  const ref = env['GITHUB_REF_NAME'];
  if (!repo || !ref) return undefined;
  return `https://raw.githubusercontent.com/${repo}/${ref}`;
}

/** Public raw URL of one repo-relative content path (posix separators). */
export function contentRawPhotoUrl(base: string, repoDir: string, fileName: string): string {
  return `${base}/${repoDir.replace(/\\/g, '/')}/${fileName}`;
}

/** Framed carousel copy name: photo-1.jpg -> photo-1.ig.jpg (a new file, never a declared photo). */
export function instagramFramedFileName(fileName: string): string {
  return `${fileName.replace(/\.[^.]+$/, '')}.ig.jpg`;
}

/**
 * One carousel image on the exact 4:5 canvas (1080x1350): contain fit, white
 * padding, never cutting the work (`instagramCarouselFrame`, T26a1). JPEG at
 * the photo-pipeline quality.
 */
export async function frameInstagramPhoto(input: Uint8Array): Promise<Uint8Array> {
  const { data } = await sharp(input)
    .rotate() // honour EXIF before measuring, like processPhoto
    .resize({
      width: instagramCarouselFrame.width,
      height: instagramCarouselFrame.height,
      fit: 'contain',
      background: { r: 255, g: 255, b: 255 },
    })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

export interface PrepareInstagramDeliveryDeps {
  root: string;
  env: NodeJS.ProcessEnv;
  git: GitCommitter;
  /** Repo-relative item directory (e.g. content/posts/<folder>), aligned with the caller's git paths. */
  repoDir: string;
  /** Photo file names aligned with `photoBytes`. */
  fileNames: string[];
  photoBytes: Uint8Array[];
  ops: SendOperation[];
  /** Ledger resume point: ops before it are already delivered. */
  startAt: number;
  /** Post/show id for the framed-copy commit message. */
  itemId: string;
  /**
   * Set by the caller when an earlier Meta preparation in this run already
   * pushed (a second push would be a no-op): the push is skipped.
   */
  contentAlreadyPushed?: boolean;
  logger?: (line: string) => void;
}

export interface PreparedInstagramDelivery {
  /** Public URL of `photoBytes[i]`; carousel photos point at the framed copies. */
  photoUrls: string[];
  /** True when this preparation ran the opted-in content push. */
  pushed: boolean;
}

/**
 * Everything the Instagram delivery needs before any network side effect:
 * public photo URLs aligned with the photos, 4:5 framed copies of every
 * remaining carousel written beside the item and committed, and the
 * opted-in content push (so Meta can fetch fresh URLs). Throws when no raw
 * base URL is available — the caller records the channel failure.
 */
export async function prepareInstagramDelivery(
  deps: PrepareInstagramDeliveryDeps,
): Promise<PreparedInstagramDelivery> {
  const log = deps.logger ?? (() => {});
  const base = contentRawBaseUrl(deps.env);
  if (base === undefined) {
    throw new Error(
      'Instagram delivery needs public photo URLs: set CONTENT_RAW_BASE_URL ' +
        'or run in GitHub Actions (GITHUB_REPOSITORY and GITHUB_REF_NAME)',
    );
  }
  const urls = deps.fileNames.map((fileName) => contentRawPhotoUrl(base, deps.repoDir, fileName));

  // Nothing left to deliver (e.g. an announcement renders to zero ops): no
  // framing, no commit and no push — Meta is never asked to fetch URLs.
  const remaining = deps.ops.slice(deps.startAt);
  if (remaining.length === 0) return { photoUrls: urls, pushed: false };

  // Validate all names before framing: different extensions can share an output name.
  const framedNames = deps.fileNames.map(instagramFramedFileName);
  if (new Set(framedNames).size !== framedNames.length) {
    throw new Error('Instagram framed photo names collide');
  }

  const framedRepoPaths: string[] = [];
  for (const op of remaining) {
    if (op.kind !== 'mediaGroup') continue;
    for (const index of op.photoIndexes) {
      const fileName = deps.fileNames[index];
      const bytes = deps.photoBytes[index];
      if (fileName === undefined || bytes === undefined) {
        throw new Error(`Instagram carousel references missing photo at index ${index}`);
      }
      const framedName = instagramFramedFileName(fileName);
      const framedDir = path.join(deps.root, ...deps.repoDir.split('/'));
      await mkdir(framedDir, { recursive: true });
      await writeFile(path.join(framedDir, framedName), await frameInstagramPhoto(bytes));
      urls[index] = contentRawPhotoUrl(base, deps.repoDir, framedName);
      framedRepoPaths.push(path.join(deps.repoDir, framedName));
    }
  }
  if (framedRepoPaths.length > 0) {
    const committed = await deps.git.commit(
      framedRepoPaths,
      `content: frame instagram photos ${deps.itemId}`,
    );
    log(
      committed
        ? `committed framed copies: ${framedRepoPaths.join(', ')}`
        : 'framed copies already committed',
    );
  }
  if (deps.env['CONTENT_PUSH_BEFORE_DELIVERY'] === 'true' && !deps.contentAlreadyPushed) {
    await deps.git.push(requiredEnv('GITHUB_REF_NAME', deps.env));
    log('pushed content before Instagram delivery');
    return { photoUrls: urls, pushed: true };
  }
  return { photoUrls: urls, pushed: false };
}
