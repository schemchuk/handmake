import { compareNewestFirst, contentSlugSchema, parseWork, workIdSchema } from '@handmake/core';
import type { WorkReader } from '@handmake/core';

/** Reads approved Git works without importing the filesystem adapter into the Worker. */
export function createGitHubWorkReader(options: {
  repo: string;
  ref: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): WorkReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const root = `https://raw.githubusercontent.com/${options.repo}/${options.ref}/content/works`;
  const readWork: WorkReader['readWork'] = async (tenantId, workId) => {
    contentSlugSchema.parse(tenantId);
    workIdSchema.parse(workId);
    const response = await fetchImpl(`${root}/${workId}/index.md`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`work read failed: HTTP ${response.status}`);
    const work = parseWork(await response.text());
    if (work.id !== workId) throw new Error('work identity mismatch');
    return work.tenant === tenantId ? work : undefined;
  };
  return {
    readWork,
    async listWorks(tenantId) {
      contentSlugSchema.parse(tenantId);
      const response = await fetchImpl(
        `https://api.github.com/repos/${options.repo}/contents/content/works?ref=${encodeURIComponent(options.ref)}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'handmake-bot',
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          },
        },
      );
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`work listing failed: HTTP ${response.status}`);
      const entries: unknown = await response.json();
      if (!Array.isArray(entries) || entries.length >= 1000)
        throw new Error('invalid or oversized work listing');
      const works = [];
      const ids = (entries as { type?: string; name?: string }[])
        .filter((entry) => entry.type === 'dir')
        .map((entry) => workIdSchema.parse(entry.name))
        .sort()
        .reverse()
        .slice(0, 20);
      for (const id of ids) {
        const work = await readWork(tenantId, id);
        if (work) works.push(work);
      }
      return works.sort(compareNewestFirst);
    },
  };
}
