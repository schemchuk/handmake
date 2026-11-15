import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest, type VisitContext } from '../functions/_middleware';

function fixture(
  path = '/uk/?s=tg&private=value',
  init: RequestInit = {},
  status = 200,
  type = 'text/html; charset=utf-8',
) {
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  const response = new Response('unchanged', { status, headers: { 'content-type': type } });
  const request = new Request(`https://example.invalid${path}`, init);
  const pending: Promise<unknown>[] = [];
  const context: VisitContext = {
    request,
    env: { DB: { prepare }, TENANT_ID: 'tenant-fixture' },
    next: async () => response,
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
  return { context, response, pending, prepare, bind, run };
}
afterEach(() => vi.restoreAllMocks());
describe('Pages visit middleware', () => {
  it('returns the same response before D1 finishes and writes only aggregate dimensions', async () => {
    const f = fixture();
    f.context.request.cf = { country: 'DE' };
    let finish!: () => void;
    f.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    expect(await onRequest(f.context)).toBe(f.response);
    expect(f.pending).toHaveLength(1);
    expect(f.bind).toHaveBeenCalledWith(
      'tenant-fixture',
      new Date().toISOString().slice(0, 10),
      '/uk/',
      'tg',
      'DE',
    );
    expect(f.prepare).toHaveBeenCalledWith(
      expect.stringContaining('DO UPDATE SET views = site_visits.views + 1'),
    );
    finish();
    await Promise.all(f.pending);
    expect(await f.response.text()).toBe('unchanged');
  });
  it.each([
    ['/', { method: 'POST' }, 200, 'text/html'],
    ['/', { method: 'HEAD' }, 200, 'text/html'],
    ['/', {}, 404, 'text/html'],
    ['/', {}, 500, 'text/html'],
    ['/technik/og.jpg', {}, 200, 'text/html'],
    ['/praesentation/de.pdf', {}, 200, 'text/html'],
    ['/', {}, 200, 'application/json'],
    ['/', {}, 200, 'text/html-invalid'],
    ...['media', 'show-media', 'work-media', '_astro', 'assets', 'fonts', 'textures'].map((dir) => [
      `/${dir}/file`,
      {},
      200,
      'text/html',
    ]),
  ] as [string, RequestInit, number, string][])(
    'skips %s %j %s %s',
    async (path, init, status, type) => {
      const f = fixture(path, init, status, type);
      expect(await onRequest(f.context)).toBe(f.response);
      expect(f.pending).toHaveLength(0);
      expect(f.prepare).not.toHaveBeenCalled();
    },
  );
  it.each([
    'Googlebot',
    'crawler',
    'Spider',
    'Slurp',
    'preview',
    'facebookexternalhit',
    'TelegramBot',
    'WhatsApp',
  ])('skips %s', async (agent) => {
    const f = fixture('/', { headers: { 'user-agent': agent } });
    await onRequest(f.context);
    expect(f.pending).toHaveLength(0);
  });
  it.each([undefined, 'invalid', 'de', 123])(
    'uses XX for absent/invalid country %s',
    async (country) => {
      const f = fixture('/');
      f.context.request.cf = { country };
      await onRequest(f.context);
      await Promise.all(f.pending);
      expect(f.bind).toHaveBeenCalledWith(
        'tenant-fixture',
        expect.any(String),
        '/',
        'direct',
        'XX',
      );
    },
  );
  it.each(['prepare', 'bind', 'run', 'tenant'] as const)(
    'swallows %s failure with a fixed data-free log',
    async (stage) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const f = fixture();
      if (stage === 'tenant') f.context.env.TENANT_ID = '';
      else
        f[stage].mockImplementation(() => {
          throw new Error('private-request-data');
        });
      expect(await onRequest(f.context)).toBe(f.response);
      await expect(Promise.all(f.pending)).resolves.toBeDefined();
      expect(log).toHaveBeenCalledExactlyOnceWith('Site visit counter failed');
    },
  );
  it('swallows asynchronous D1 rejection', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fixture();
    f.run.mockRejectedValue(new Error('private-request-data'));
    expect(await onRequest(f.context)).toBe(f.response);
    await Promise.all(f.pending);
    expect(log).toHaveBeenCalledExactlyOnceWith('Site visit counter failed');
  });
});

it('applies migration 0023 and increments only the matching aggregate and tenant', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      readFileSync(new URL('../../bot/migrations/0023_site_visits.sql', import.meta.url), 'utf8'),
    );
    for (const tenant of ['first', 'first', 'second']) {
      const f = fixture('/?s=qr');
      f.context.env.TENANT_ID = tenant;
      f.context.env.DB = {
        prepare: (sql) => ({
          bind: (...values) => ({ run: async () => db.prepare(sql).run(...values) }),
        }),
      };
      await onRequest(f.context);
      await Promise.all(f.pending);
    }
    const rows = db
      .prepare('SELECT tenant_id, path, source, country, views FROM site_visits ORDER BY tenant_id')
      .all();
    expect(rows).toEqual([
      { tenant_id: 'first', path: '/', source: 'qr', country: 'XX', views: 2 },
      { tenant_id: 'second', path: '/', source: 'qr', country: 'XX', views: 1 },
    ]);
  } finally {
    db.close();
  }
});
