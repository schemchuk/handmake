import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { renderTelegram } from '@handmake/channels';
import { parsePost } from '@handmake/core';
import type { MediaSource, Post, SendOperation, Work } from '@handmake/core';
import { GitRepoContentStore, postFolderName } from '@handmake/stores';

import { buildPostFromPayload } from './build-post';
import { fetchAndProcessPhotos } from './photos';
import { parseDispatchPayload } from './payload';
import { loadTenantConfig } from './tenant-config';
import { prepareWorkPublication } from './work-publication';

export interface DryRunDeps {
  cwd?: string;
  root?: string;
  tempDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: (line: string) => void;
  mediaSource?: MediaSource;
  now?: Date;
  newId?: () => string;
}

export interface DryRunResult {
  post: Post;
  work?: Work;
  ops: SendOperation[];
  postDir: string;
  photoCount: number;
}

/**
 * Dry-run (T09): payload -> post -> content store in a temp dir, then print
 * the Telegram operations renderTelegram would deliver. Nothing leaves the
 * machine; files are written only under the temp dir.
 */
export async function runDryRun(payloadPath: string, deps: DryRunDeps = {}): Promise<DryRunResult> {
  const cwd = deps.cwd ?? process.cwd();
  const root = deps.root ?? cwd;
  const log = deps.logger ?? console.log;

  const payload = parseDispatchPayload(await readFile(path.resolve(cwd, payloadPath), 'utf8'));
  const tenant = await loadTenantConfig(payload.tenantId, root);
  const publication =
    payload.kind === 'work'
      ? await prepareWorkPublication(payload, tenant, new GitRepoContentStore({ rootDir: root }))
      : undefined;
  const tempDir = deps.tempDir ?? (await mkdtemp(path.join(os.tmpdir(), 'handmake-dry-run-')));

  const photos = await fetchAndProcessPhotos(
    payload.fileIds,
    deps.mediaSource,
    deps.env ?? process.env,
  );

  const post =
    publication?.post ??
    buildPostFromPayload(payload, tenant, { now: deps.now, newId: deps.newId });
  const store = new GitRepoContentStore({ rootDir: tempDir });
  if (publication) {
    if (publication.collection) await store.saveCollection(publication.collection);
    await store.saveWork(publication.work, photos);
  } else await store.savePost(post, photos);

  const postDir = publication
    ? path.join(tempDir, 'content', 'works', post.id)
    : path.join(tempDir, 'content', 'posts', postFolderName(post));
  // Acceptance check: the written folder must validate with parsePost.
  if (!publication) parsePost(await readFile(path.join(postDir, 'index.md'), 'utf8'));

  const ops =
    publication && !post.channels.includes('telegram')
      ? []
      : renderTelegram(post, {
          channelId: tenant.channels.telegram?.channelId ?? '',
          languages: tenant.languages,
        });

  log(`post id: ${post.id}`);
  log(`tenant: ${post.tenant}`);
  log(`planned folder: ${path.relative(tempDir, postDir)}`);
  log(`photos: ${photos.length}`);
  ops.forEach((op, i) => log(`op ${i}: ${JSON.stringify(op)}`));
  log(`dry-run: nothing was delivered; files written only under ${tempDir}`);

  return {
    post,
    ...(publication ? { work: publication.work } : {}),
    ops,
    postDir,
    photoCount: photos.length,
  };
}
