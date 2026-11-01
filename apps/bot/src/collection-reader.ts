import { compareCollections, contentSlugSchema, parseCollection } from '@handmake/core';
import type { CollectionReader } from '@handmake/core';

/** Public Git content via HTTP; the Worker never imports the filesystem store. */
export function createGitHubCollectionReader(options: {
  repo: string;
  ref: string;
  /** Authenticates the directory listing: GitHub rate-limits anonymous calls per shared Worker IP. */
  token?: string;
  fetchImpl?: typeof fetch;
}): CollectionReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const directory = `https://api.github.com/repos/${options.repo}/contents/content/collections?ref=${encodeURIComponent(options.ref)}`;
  return {
    async listCollections(tenantId) {
      contentSlugSchema.parse(tenantId);
      const response = await fetchImpl(directory, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'handmake-bot',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`collection listing failed: HTTP ${response.status}`);
      const entries: unknown = await response.json();
      // The Contents API caps directory listings at 1000: never silently truncate a menu.
      if (!Array.isArray(entries) || entries.length >= 1000)
        throw new Error('invalid or oversized collection listing');
      const collections = [];
      for (const entry of entries as { type?: string; name?: string }[]) {
        if (entry.type !== 'file' || !entry.name?.endsWith('.md')) continue;
        const slug = entry.name.slice(0, -3);
        contentSlugSchema.parse(slug);
        const file = await fetchImpl(
          `https://raw.githubusercontent.com/${options.repo}/${options.ref}/content/collections/${slug}.md`,
        );
        if (!file.ok) throw new Error(`collection ${slug} failed: HTTP ${file.status}`);
        try {
          const collection = parseCollection(await file.text());
          if (collection.slug !== slug) throw new Error('slug mismatch');
          if (collection.tenant === tenantId) collections.push(collection);
        } catch (error) {
          throw new Error(`content/collections/${slug}.md: ${(error as Error).message}`);
        }
      }
      return collections.sort(compareCollections);
    },
  };
}
