import { siteVisitPath, siteVisitSource } from '@handmake/core/site-visits';

// Structural binding types keep this static site's runtime independent of the bot.
interface Database {
  prepare(sql: string): {
    bind(...values: (string | number)[]): { run(): Promise<unknown> };
  };
}
export interface VisitContext {
  request: Request & { cf?: { country?: unknown } };
  env: { DB: Database; TENANT_ID: string };
  next(): Promise<Response>;
  waitUntil(promise: Promise<unknown>): void;
}

const bots = /bot|crawl|spider|slurp|preview|facebookexternalhit|telegrambot|whatsapp/i;
const assets = /^\/(?:media|show-media|work-media|_astro|assets|fonts|textures)(?:\/|$)/;

export async function onRequest(context: VisitContext): Promise<Response> {
  const response = await context.next();
  try {
    const { request } = context;
    const url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      response.status !== 200 ||
      response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/html' ||
      assets.test(url.pathname) ||
      /\.(?!html?$)[a-z0-9]+$/i.test(url.pathname) ||
      bots.test(request.headers.get('user-agent') ?? '')
    )
      return response;
    const country =
      typeof request.cf?.country === 'string' && /^[A-Z]{2}$/.test(request.cf.country)
        ? request.cf.country
        : 'XX';
    const values = [
      context.env.TENANT_ID,
      new Date().toISOString().slice(0, 10),
      siteVisitPath(url),
      siteVisitSource(url, request.headers.get('referer')),
      country,
    ];
    // Start all database work in the background, including prepare/bind failures.
    context.waitUntil(
      Promise.resolve()
        .then(async () => {
          if (!context.env.TENANT_ID) throw new Error('Missing tenant');
          await context.env.DB.prepare(
            `
        INSERT INTO site_visits (tenant_id, day, path, source, country, views)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT (tenant_id, day, path, source, country)
        DO UPDATE SET views = site_visits.views + 1
      `,
          )
            .bind(...values)
            .run();
        })
        .catch(() => {
          console.error('Site visit counter failed');
        }),
    );
  } catch {
    // Never include errors, URLs, headers or any other request data in logs.
    console.error('Site visit counter failed');
  }
  return response;
}
