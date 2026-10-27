import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Imports *.md as a default-exported string, mirroring the Wrangler Text
 * rule for markdown files in wrangler.toml (bundle behaviour). */
function mdTextModule(): Plugin {
  return {
    name: 'md-text-module',
    enforce: 'pre',
    load(id) {
      if (id.endsWith('.md')) {
        return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
      }
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [mdTextModule()],
});
