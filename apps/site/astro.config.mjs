import { defineConfig } from 'astro/config';

// Static output; the tenant's base URL comes from the tenant config at build time
// (see src/lib/site-data.ts), so only the trailing-slash policy is fixed here.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
