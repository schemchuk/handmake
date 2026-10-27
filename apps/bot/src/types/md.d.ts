/** Wrangler bundles *.md as text modules (rules in wrangler.toml); Vitest gets
 * the same behaviour from the plugin in vitest.config.ts. This declaration
 * covers typecheck: resolution of the real .md file fails, so TypeScript
 * falls back to this ambient wildcard module. */
declare module '*.md' {
  const content: string;
  export default content;
}
