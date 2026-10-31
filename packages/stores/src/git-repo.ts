import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  compareNewestFirst,
  parseLedger,
  parsePost,
  serializeLedger,
  serializePost,
} from '@handmake/core';
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

  get #postsDir(): string {
    return path.join(this.#rootDir, 'content', 'posts');
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
    return (await this.#findPost(tenantId, postId))?.post;
  }

  async listPosts(tenantId: string): Promise<Post[]> {
    const posts = (await this.#scanPosts()).map((entry) => entry.post);
    return posts.filter((post) => post.tenant === tenantId).sort(compareNewestFirst);
  }

  async readPostPhoto(
    tenantId: string,
    postId: string,
    fileName: string,
  ): Promise<Uint8Array | undefined> {
    const found = await this.#findPost(tenantId, postId);
    // Only photos the post declares: never index.md or a path outside the folder.
    if (!found || unsafeFileName.test(fileName) || !found.post.photos.includes(fileName)) {
      return undefined;
    }
    try {
      return new Uint8Array(await readFile(path.join(found.dir, fileName)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async #findPost(
    tenantId: string,
    postId: string,
  ): Promise<{ dir: string; post: Post } | undefined> {
    // Folder names end with the lowercased id (postFolderName), so only matching folders are
    // parsed: an unrelated broken post must not block reading this one (the publish path).
    const suffix = `-${postId.toLowerCase()}`;
    const names = await this.#postFolderNames();
    for (const name of names.filter((n) => n.endsWith(suffix))) {
      const entry = await this.#readPostFolder(name);
      if (entry && entry.post.tenant === tenantId && entry.post.id === postId) return entry;
    }
    return undefined;
  }

  async #postFolderNames(): Promise<string[]> {
    try {
      const entries = await readdir(this.#postsDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  /** Every parseable post folder; a folder without index.md is skipped. */
  async #scanPosts(): Promise<{ dir: string; post: Post }[]> {
    const found: { dir: string; post: Post }[] = [];
    for (const name of await this.#postFolderNames()) {
      const entry = await this.#readPostFolder(name);
      if (entry) found.push(entry);
    }
    return found;
  }

  async #readPostFolder(name: string): Promise<{ dir: string; post: Post } | undefined> {
    const dir = path.join(this.#postsDir, name);
    let markdown: string;
    try {
      markdown = await readFile(path.join(dir, 'index.md'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      return { dir, post: parsePost(markdown) };
    } catch (error) {
      // Name the folder: a broken post must fail the build loudly and findably.
      throw new Error(`content/posts/${name}/index.md: ${(error as Error).message}`, {
        cause: error,
      });
    }
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
