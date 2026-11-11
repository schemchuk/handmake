import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { finalizeSite } from './src/lib/build-policy';
import { loadSiteData } from './src/lib/site-data';

// Static output; the tenant's base URL comes from the tenant config at build time
// (see src/lib/site-data.ts), so only the trailing-slash policy is fixed here.
export default defineConfig({
  output: 'static',
  integrations: [
    {
      name: 'site-publication-policy',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const data = await loadSiteData();
          await finalizeSite(
            fileURLToPath(dir),
            data.site.baseUrl,
            data.indexable,
            data.site.newsletter?.formAction,
          );
        },
      },
    },
  ],
  trailingSlash: 'always',
  build: { format: 'directory' },
});
