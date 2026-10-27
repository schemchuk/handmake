import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Node-only: read `prompts/<version>.md` (e.g. "humanize-de@1"). Workers bundle the text instead. */
export function loadPrompt(version: string): Promise<string> {
  if (!/^[a-z0-9-]+@\d+$/.test(version)) {
    throw new Error(`invalid prompt version "${version}"`);
  }
  // Resolved per call, not at module load: the bot Worker imports this package
  // and has no file URL for import.meta.url, so a top-level resolve crashes it.
  const promptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
  return readFile(path.join(promptsDir, `${version}.md`), 'utf8');
}
