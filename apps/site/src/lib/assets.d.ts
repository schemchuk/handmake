// Vite `?url` imports, declared here so `tsc` does not need astro/client (its DOM types
// clash with the Node-only libs the shared packages are checked against).
declare module '*?url' {
  const url: string;
  export default url;
}
