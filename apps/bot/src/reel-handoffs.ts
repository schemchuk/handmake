import { createD1DraftStore } from './draft-store';
import type { Env } from './env';
import { verifySignedRequest } from './signed-request';

/** T80a (F41): the PC reel cleanup asks when works left the author. */
export const reelHandoffsPath = '/reel/handoffs';

/** At most this many times per answer; the PC asks again from the last one. */
export const reelHandoffsLimit = 20;

const utcIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * `GET /reel/handoffs?tenant=<slug>&since=<UTC ISO>` → `{"handoffs":[...]}`:
 * hand-off times newer than `since`, ascending. Signed like the contest-names
 * endpoint with its own secret; answers with times only.
 */
export async function handleReelHandoffs(
  env: Env,
  request: Request,
  now = Date.now(),
): Promise<Response> {
  const url = new URL(request.url);
  if (!(await verifySignedRequest(env.REEL_HANDOFF_SECRET, request, now)))
    return new Response('unauthorized', { status: 401 });
  if (request.method !== 'GET' || url.pathname !== reelHandoffsPath)
    return new Response('method not allowed', { status: 405 });
  const tenant = url.searchParams.get('tenant') ?? '';
  const since = url.searchParams.get('since') ?? '';
  const sinceDate = new Date(since);
  if (
    [...url.searchParams.keys()].some((k) => !['tenant', 'since'].includes(k)) ||
    url.searchParams.getAll('tenant').length !== 1 ||
    url.searchParams.getAll('since').length !== 1 ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tenant) ||
    !utcIso.test(since) ||
    Number.isNaN(sinceDate.getTime()) ||
    // Date rolls impossible days over (02-30 → 03-02); refuse them.
    sinceDate.toISOString().slice(0, 19) !== since.slice(0, 19)
  )
    return new Response('invalid query', { status: 400 });
  try {
    const handoffs = await createD1DraftStore(env.DB).handoffsSince(
      tenant,
      sinceDate,
      reelHandoffsLimit,
    );
    return Response.json({ handoffs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('handoffs unavailable', { status: 503 });
  }
}
