import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseLedger, parsePost, serializeLedger, serializePost } from '@handmake/core';
import type { ContentStore, PhotoFile, Post, PublishLedger } from '@handmake/core';

export interface GitRepoContentStoreOptions {
  rootDir: string;
}

/**
 * Content store backed by a git repo checkout: posts live in
 * `content/posts/<yyyy-mm-dd>-<id>/index.md` (+ photos beside it), ledgers
 * in `content/ledger/<postId>.json`. Folder names are derived from the post
 * itself (no slug field): date prefix plus the lowercased ULID.
 */
export function postFolderName(post: Pick<Post, 'date' | 'id'>): string {
  return `${post.date.slice(0, 10)}-${post.id.toLowerCase()}`;
}

const unsafeFileName = /[/\\]|\.{2}/;

export class GitRepoContentStore implements ContentStore {
  readonly #rootDir: string;

  constructor(options: GitRepoContentStoreOptions) {
    this.#rootDir = options.rootDir;
  }

  async savePost(post: Post, photos: PhotoFile[]): Promise<void> {
    const normalized = parsePost(serializePost(post));
    const postDir = path.join(this.#rootDir, 'content', 'posts', postFolderName(post));
    await mkdir(postDir, { recursive: true });
    await writeFile(path.join(postDir, 'index.md'), serializePost(normalized));
    for (const photo of photos) {
      if (unsafeFileName.test(photo.fileName)) {
        throw new Error(`photo file name must be a plain file name: "${photo.fileName}"`);
      }
      await writeFile(path.join(postDir, photo.fileName), photo.data);
    }
  }

  async readPost(tenantId: string, postId: string): Promise<Post | undefined> {
    const postsDir = path.join(this.#rootDir, 'content', 'posts');
    let entries;
    try {
      entries = await readdir(postsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const markdown = await readFile(path.join(postsDir, entry.name, 'index.md'), 'utf8');
        const post = parsePost(markdown);
        if (post.tenant === tenantId && post.id === postId) return post;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
    }
    return undefined;
  }

  async readLedger(tenantId: string, postId: string): Promise<PublishLedger | undefined> {
    const ledgerPath = path.join(this.#rootDir, 'content', 'ledger', `${postId}.json`);
    let json: string;
    try {
      json = await readFile(ledgerPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const ledger = parseLedger(json);
    return ledger.tenantId === tenantId ? ledger : undefined;
  }

  async writeLedger(ledger: PublishLedger): Promise<void> {
    const ledgerDir = path.join(this.#rootDir, 'content', 'ledger');
    await mkdir(ledgerDir, { recursive: true });
    await writeFile(path.join(ledgerDir, `${ledger.postId}.json`), serializeLedger(ledger));
  }
}
