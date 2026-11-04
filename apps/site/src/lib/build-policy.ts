import { readFile, readdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

/** Inspect parsed HTML, including CSS in attributes and style elements. Never echo input. */
export function checkResources(html: string, baseUrl: string): void {
  const own = new URL(baseUrl).origin;
  const check = (value: string) => {
    const url = new URL(value.trim(), baseUrl);
    if (url.origin === own && ['https:', 'http:'].includes(url.protocol)) return;
    throw new Error('Disallowed external resource in generated site');
  };
  const css = (value: string) => {
    // Escapes and comments can hide URL tokens: reject rather than guess at browser parsing.
    if (/\\|\/\*|@import|image-set\s*\(/i.test(value))
      throw new Error('Unsupported CSS resource syntax');
    for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) check(match[2]!);
  };
  const walk = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node) {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (['base', 'object', 'embed'].includes(node.tagName))
        throw new Error('Unsupported embedded resource');
      for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith('on') || key === 'srcdoc') throw new Error('Unsupported active content');
        if (key === 'style') css(value);
        if (['src', 'poster', 'background', 'action'].includes(key)) check(value);
        if (key === 'srcset')
          for (const entry of value.split(',')) check(entry.trim().split(/\s+/)[0]!);
        if (
          (node.tagName === 'link' || node.tagName === 'image' || node.tagName === 'use') &&
          ['href', 'xlink:href'].includes(key)
        )
          check(value);
      }
      if (node.tagName === 'meta' && attrs['http-equiv'])
        throw new Error('Unsupported HTTP-equivalent metadata');
      if (node.tagName === 'script' && !attrs.src) throw new Error('Unsupported inline script');
      if (node.tagName === 'style')
        css(node.childNodes.map((n) => ('value' in n ? n.value : '')).join(''));
      if ('content' in node) walk(node.content);
    }
    if ('childNodes' in node) node.childNodes.forEach(walk);
  };
  walk(parse(html));
}

export async function finalizeSite(
  directory: string,
  baseUrl: string,
  indexable: boolean,
): Promise<void> {
  const pages: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.(html|css)$/.test(entry.name)) {
        const source = await readFile(file, 'utf8');
        try {
          checkResources(
            entry.name.endsWith('.css') ? `<style>${source}</style>` : source,
            baseUrl,
          );
        } catch (error) {
          throw new Error(`${path.relative(directory, file)}: ${(error as Error).message}`);
        }
        if (entry.name.endsWith('.html'))
          pages.push(path.relative(directory, file).split(path.sep).join('/'));
      }
    }
  }
  await visit(directory);
  // A top-level 404.html makes Pages return HTTP 404 rather than enabling its SPA fallback.
  await copyFile(path.join(directory, '404/index.html'), path.join(directory, '404.html'));
  await writeFile(
    path.join(directory, 'robots.txt'),
    indexable
      ? `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n',
  );
  if (!indexable) await rm(path.join(directory, 'sitemap.xml'), { force: true });
  if (indexable) {
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const urls = pages
      .filter((p) => !/(^|\/)404\//.test(p))
      .map(
        (p) =>
          `<url><loc>${escape(new URL(p.replace(/index\.html$/, ''), `${baseUrl}/`).href)}</loc></url>`,
      );
    await writeFile(
      path.join(directory, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
    );
  }
}
