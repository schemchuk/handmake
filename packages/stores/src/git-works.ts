import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  collectionSchema,
  compareCollections,
  compareNewestFirst,
  contentSlugSchema,
  parseCollection,
  parseWork,
  serializeCollection,
  serializeWork,
  workIdSchema,
  workSchema,
} from '@handmake/core';
import type { Collection, PhotoFile, Work } from '@handmake/core';

/** Work/collection persistence shared by the Git checkout adapter; no channel dependencies. */
export class GitWorkContentStore {
  constructor(private readonly root: string) {}

  // Reject symlinks as well as unsafe names: declared photos must stay within their own work.
  async #location(...parts: string[]): Promise<string> {
    let target = this.root;
    for (const part of ['content', ...parts]) {
      target = path.join(target, part);
      try {
        if ((await lstat(target)).isSymbolicLink())
          throw new Error(`symlink in content path: ${target}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return target;
  }

  async #read<T>(parts: string[], parse: (markdown: string) => T): Promise<T | undefined> {
    const file = await this.#location(...parts);
    try {
      return parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error(`content/${parts.join('/')}: ${(error as Error).message}`, { cause: error });
    }
  }

  async #names(kind: 'works' | 'collections'): Promise<string[]> {
    try {
      const entries = await readdir(await this.#location(kind), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw new Error(`symlink in content/${kind}/${entry.name}`);
      }
      return entries
        .filter((e) => (kind === 'works' ? e.isDirectory() : e.isFile() && e.name.endsWith('.md')))
        .map((e) => e.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async #work(id: string): Promise<Work | undefined> {
    if (!workIdSchema.safeParse(id).success)
      throw new Error(`content/works/${id}: invalid work id`);
    const work = await this.#read(['works', id, 'index.md'], parseWork);
    if (work && work.id !== id) throw new Error(`content/works/${id}/index.md: id mismatch`);
    return work;
  }

  async saveWork(input: Work, photos: PhotoFile[], video?: Uint8Array): Promise<void> {
    const work = workSchema.parse(input);
    for (const photo of photos) {
      if (!work.photos.includes(photo.fileName)) throw new Error('photo must be declared by work');
    }
    if (video && !work.video) throw new Error('video must be declared by work');
    const existing = await this.#work(work.id);
    if (existing && existing.tenant !== work.tenant)
      throw new Error('work belongs to another tenant');
    const dir = await this.#location('works', work.id, 'photos');
    await mkdir(dir, { recursive: true });
    for (const photo of photos) {
      await writeFile(await this.#location('works', work.id, 'photos', photo.fileName), photo.data);
    }
    if (video) await writeFile(await this.#location('works', work.id, work.video!.fileName), video);
    await writeFile(await this.#location('works', work.id, 'index.md'), serializeWork(work));
  }

  async readWork(tenantId: string, id: string): Promise<Work | undefined> {
    const work = await this.#work(id);
    return work?.tenant === tenantId ? work : undefined;
  }

  async readWorkVideo(tenantId: string, id: string): Promise<Uint8Array | undefined> {
    const work = await this.readWork(tenantId, id);
    if (!work?.video) return undefined;
    return new Uint8Array(await readFile(await this.#location('works', id, work.video.fileName)));
  }

  async listWorks(tenantId: string): Promise<Work[]> {
    const works: Work[] = [];
    for (const name of await this.#names('works')) {
      const work = await this.#work(name);
      if (!work) throw new Error(`content/works/${name}/index.md: missing document`);
      if (work.tenant === tenantId) works.push(work);
    }
    return works.sort(compareNewestFirst);
  }

  async readWorkPhoto(
    tenantId: string,
    id: string,
    fileName: string,
  ): Promise<Uint8Array | undefined> {
    const work = await this.readWork(tenantId, id);
    if (!work?.photos.includes(fileName)) return undefined;
    try {
      return new Uint8Array(await readFile(await this.#location('works', id, 'photos', fileName)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async #collection(slug: string): Promise<Collection | undefined> {
    if (!contentSlugSchema.safeParse(slug).success)
      throw new Error(`content/collections/${slug}.md: invalid slug`);
    const collection = await this.#read(['collections', `${slug}.md`], parseCollection);
    if (collection && collection.slug !== slug)
      throw new Error(`content/collections/${slug}.md: slug mismatch`);
    return collection;
  }

  async saveCollection(input: Collection): Promise<void> {
    const collection = collectionSchema.parse(input);
    const existing = await this.#collection(collection.slug);
    if (existing && existing.tenant !== collection.tenant)
      throw new Error('collection belongs to another tenant');
    await mkdir(await this.#location('collections'), { recursive: true });
    await writeFile(
      await this.#location('collections', `${collection.slug}.md`),
      serializeCollection(collection),
    );
  }

  async readCollection(tenantId: string, slug: string): Promise<Collection | undefined> {
    const collection = await this.#collection(slug);
    return collection?.tenant === tenantId ? collection : undefined;
  }

  async listCollections(tenantId: string): Promise<Collection[]> {
    const collections: Collection[] = [];
    for (const name of await this.#names('collections')) {
      const collection = await this.#collection(name.slice(0, -3));
      if (collection?.tenant === tenantId) collections.push(collection);
    }
    return collections.sort(compareCollections);
  }
}
