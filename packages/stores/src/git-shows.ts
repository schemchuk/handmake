import { lstat, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  compareNewestFirst,
  parseShow,
  serializeShow,
  showSchema,
  workIdSchema,
} from '@handmake/core';
import type { PhotoFile, Show, ShowContentStore } from '@handmake/core';
import { GitWorkContentStore } from './git-works';

/** Flat identities match works; workflow concurrency serializes checkout writers. */
export class GitShowContentStore extends GitWorkContentStore implements ShowContentStore {
  constructor(private readonly showRoot: string) {
    super(showRoot);
  }

  async #location(...parts: string[]): Promise<string> {
    let target = this.showRoot;
    for (const part of ['content', 'shows', ...parts]) {
      target = path.join(target, part);
      try {
        if ((await lstat(target)).isSymbolicLink()) throw new Error('symlink in show path');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return target;
  }
  async #bytes(id: string, name: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(await this.#location(id, name)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async #show(id: string): Promise<Show | undefined> {
    workIdSchema.parse(id);
    const bytes = await this.#bytes(id, 'index.md');
    if (!bytes) return undefined;
    try {
      const show = parseShow(new TextDecoder().decode(bytes));
      if (show.id !== id) throw new Error('id mismatch');
      return show;
    } catch (cause) {
      throw new Error(`content/shows/${id}/index.md: invalid show`, { cause });
    }
  }
  async saveShow(input: Show, media: PhotoFile[]): Promise<void> {
    const show = showSchema.parse(input);
    const existing = await this.#show(show.id);
    if (existing && !isDeepStrictEqual(existing, show))
      throw new Error('show identity is immutable');
    const work = await this.readWork(show.tenant, show.workId);
    if (!work) throw new Error('show work is unavailable for tenant');
    for (const original of show.originals) {
      if (!(await this.readWorkPhoto(show.tenant, work.id, original.fileName))?.length)
        throw new Error('show original is missing from linked work');
    }
    const names = [...show.images.map((image) => image.fileName), show.video.fileName];
    if (
      media.length !== names.length ||
      new Set(media.map((file) => file.fileName)).size !== names.length ||
      media.some((file) => !names.includes(file.fileName) || !file.data.length)
    )
      throw new Error('show requires exactly all declared nonempty media');
    // Compare every existing byte before any write: retries may not replace paid output.
    for (const file of media) {
      const stored = await this.#bytes(show.id, file.fileName);
      if (stored && !Buffer.from(stored).equals(file.data))
        throw new Error('show media is immutable');
    }
    await mkdir(await this.#location(show.id), { recursive: true });
    for (const file of media) {
      if (!(await this.#bytes(show.id, file.fileName)))
        await writeFile(await this.#location(show.id, file.fileName), file.data, { flag: 'wx' });
    }
    if (!existing) {
      // Publish the manifest last, atomically; an interrupted media write is never an approved show.
      const pending = await this.#location(show.id, 'index.pending');
      await writeFile(pending, serializeShow(show));
      await rename(pending, await this.#location(show.id, 'index.md'));
    }
  }
  async readShow(tenantId: string, id: string): Promise<Show | undefined> {
    const show = await this.#show(id);
    return show?.tenant === tenantId ? show : undefined;
  }
  async listShows(tenantId: string): Promise<Show[]> {
    let entries;
    try {
      entries = await readdir(await this.#location(), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const shows: Show[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('symlink in shows');
      if (!entry.isDirectory()) continue;
      const show = await this.#show(entry.name);
      if (show?.tenant === tenantId) shows.push(show);
    }
    return shows.sort(compareNewestFirst);
  }
  async readShowMedia(tenantId: string, id: string, name: string): Promise<Uint8Array | undefined> {
    const show = await this.readShow(tenantId, id);
    if (
      !show ||
      ![...show.images.map((image) => image.fileName), show.video.fileName].includes(name)
    )
      return undefined;
    return this.#bytes(id, name);
  }
}
