import { contestNamesPath, isUlid, verifyCallbackSignature } from '@handmake/core';
import type { EntryNames } from '@handmake/core';
import type { Env } from './env';

/** Direct D1 lookup shared with author previews. Missing/withdrawn entries remain anonymous. */
export async function readEntryNames(
  db: D1Database,
  tenant: string,
  ids: string[],
): Promise<EntryNames> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tenant) || ids.length > 10 || !ids.every(isUlid))
    throw new Error('Invalid names query');
  if (!ids.length) return {};
  try {
    const rows = await db
      .prepare(
        `SELECT entry_id, display_name FROM contest_entries
      WHERE tenant_id = ? AND status = 'submitted' AND entry_id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(tenant, ...ids)
      .all<{ entry_id: string; display_name: string | null }>();
    const names: EntryNames = Object.fromEntries(ids.map((id) => [id, null]));
    for (const row of rows.results) names[row.entry_id] = row.display_name;
    return names;
  } catch {
    throw new Error('Contest names lookup failed');
  }
}

export async function handleContestNames(
  env: Env,
  request: Request,
  now = Date.now(),
): Promise<Response> {
  const url = new URL(request.url);
  const timestamp = request.headers.get('X-Handmake-Timestamp') ?? '';
  const signature = request.headers.get('X-Handmake-Signature') ?? '';
  if (
    !env.NAMES_ENDPOINT_SECRET ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !(await verifyCallbackSignature(
      env.NAMES_ENDPOINT_SECRET,
      `${request.method}\n${url.pathname}${url.search}\n${timestamp}`,
      signature,
    ))
  )
    return new Response('unauthorized', { status: 401 });
  if (request.method !== 'GET' || url.pathname !== contestNamesPath)
    return new Response('method not allowed', { status: 405 });
  const tenant = url.searchParams.get('tenant') ?? '';
  const ids = (url.searchParams.get('ids') ?? '').split(',');
  if (
    [...url.searchParams.keys()].some((k) => !['tenant', 'ids'].includes(k)) ||
    url.searchParams.getAll('tenant').length !== 1 ||
    url.searchParams.getAll('ids').length !== 1 ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tenant) ||
    ids.length > 10 ||
    !ids.every(isUlid)
  )
    return new Response('invalid query', { status: 400 });
  try {
    return Response.json(await readEntryNames(env.DB, tenant, ids), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response('names unavailable', { status: 503 });
  }
}
