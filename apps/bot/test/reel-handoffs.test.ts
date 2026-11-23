import { createDraft, signNamesRequest } from '@handmake/core';
import type { Draft } from '@handmake/core';
import { describe, expect, it } from 'vitest';

import { createD1DraftStore } from '../src/draft-store';
import type { Env } from '../src/env';
import { handleReelHandoffs, reelHandoffsLimit, reelHandoffsPath } from '../src/reel-handoffs';
import { makeD1 } from './helpers';

const tenant = 'faden-und-stimmung';
const t0 = new Date('2026-11-23T09:00:00.000Z');
const secret = 'fixture-reel-key';
const now = new Date('2026-11-23T12:00:00.000Z');

function readyWork(id: string, tenantId = tenant): Draft {
  return { ...createDraft(tenantId, id, t0, { kind: 'work' }), state: 'ready' };
}

const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

async function request(
  target: string,
  timestamp = String(now.getTime() / 1000),
  key = secret,
  method = 'GET',
) {
  return new Request(`https://fixture.test${target}`, {
    method,
    headers: {
      'X-Handmake-Timestamp': timestamp,
      'X-Handmake-Signature': await signNamesRequest(key, method, target, timestamp),
    },
  });
}

const query = (since: string, extra = '') =>
  `${reelHandoffsPath}?tenant=${tenant}&since=${encodeURIComponent(since)}${extra}`;

async function handedOff(db: D1Database, id: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT handed_off_at FROM drafts WHERE id = ?')
    .bind(id)
    .first<{ handed_off_at: string | null }>();
  return row!.handed_off_at;
}

describe('handed_off_at (T80a)', () => {
  it('queueing sets it once; unschedule and re-schedule keep the first value', async () => {
    const db = await makeD1();
    const store = createD1DraftStore(db);
    await store.create(readyWork('a'), 'chat-1');
    expect(await handedOff(db, 'a')).toBeNull();

    expect(await store.schedule(tenant, 'a', at(600), at(1))).toBe('scheduled');
    expect(await handedOff(db, 'a')).toBe(at(1).toISOString());
    expect(await store.unschedule(tenant, 'a', at(2))).toBe(true);
    expect(await handedOff(db, 'a')).toBe(at(1).toISOString());
    expect(await store.schedule(tenant, 'a', at(700), at(3))).toBe('scheduled');
    expect(await handedOff(db, 'a')).toBe(at(1).toISOString());
    // The queue's own claim at the slot does not move it either.
    expect((await store.claimDue(tenant, 'a', at(700)))?.draft.state).toBe('publishing');
    expect(await handedOff(db, 'a')).toBe(at(1).toISOString());
  });

  it('an immediate dispatch sets it only when flagged, and never overwrites', async () => {
    const db = await makeD1();
    const store = createD1DraftStore(db);
    await store.create(readyWork('a'), 'chat-1');
    await store.create(readyWork('b'), 'chat-1');

    await store.claimPublishing(tenant, 'b', at(1));
    expect(await handedOff(db, 'b')).toBeNull();

    await store.claimPublishing(tenant, 'a', at(1), undefined, 'chat-1', true);
    expect(await handedOff(db, 'a')).toBe(at(1).toISOString());
    expect(await store.revertPublishing(tenant, 'a', at(2))).toBe(true);
    await store.claimPublishing(tenant, 'a', at(5), undefined, 'chat-1', true);
    expect(await handedOff(db, 'a')).toBe(at(1).toISOString());
  });

  it('handoffsSince returns newer times of the tenant, ascending, capped', async () => {
    const db = await makeD1();
    const store = createD1DraftStore(db);
    for (let i = 0; i < 3; i++) {
      await store.create(readyWork(`w${i}`), 'chat-1');
      await store.schedule(tenant, `w${i}`, at(1000 + i), at(30 - i * 10));
    }
    await store.create(readyWork('x', 'other-tenant'), 'chat-2');
    await store.schedule('other-tenant', 'x', at(1000), at(25));

    expect(await store.handoffsSince(tenant, at(10), 20)).toEqual([
      at(20).toISOString(),
      at(30).toISOString(),
    ]);
    expect(await store.handoffsSince(tenant, at(0), 2)).toEqual([
      at(10).toISOString(),
      at(20).toISOString(),
    ]);
  });
});

describe('GET /reel/handoffs (T80a)', () => {
  async function seeded(count: number) {
    const db = await makeD1();
    const store = createD1DraftStore(db);
    for (let i = 0; i < count; i++) {
      await store.create(readyWork(`w${i}`), 'chat-1');
      await store.schedule(tenant, `w${i}`, at(1000 + i), at(i + 1));
    }
    return { DB: db, REEL_HANDOFF_SECRET: secret } as Env;
  }

  it('answers newer times only, ascending, capped, with no-store', async () => {
    const env = await seeded(reelHandoffsLimit + 5);
    const response = await handleReelHandoffs(
      env,
      await request(query(at(2).toISOString())),
      now.getTime(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as { handoffs: string[] };
    expect(body.handoffs).toHaveLength(reelHandoffsLimit);
    expect(body.handoffs[0]).toBe(at(3).toISOString());
    expect(body.handoffs).toEqual([...body.handoffs].sort());

    const idle = await handleReelHandoffs(
      env,
      await request(query(at(100).toISOString())),
      now.getTime(),
    );
    expect(await idle.json()).toEqual({ handoffs: [] });
  });

  it('rejects missing secret, bad, stale or tampered signatures with 401', async () => {
    const env = await seeded(1);
    const target = query(t0.toISOString());
    const check = async (req: Request, e: Env = env) =>
      (await handleReelHandoffs(e, req, now.getTime())).status;

    expect(await check(await request(target), { ...env, REEL_HANDOFF_SECRET: undefined })).toBe(
      401,
    );
    expect(await check(await request(target, undefined, 'wrong-key'))).toBe(401);
    for (const offset of [-301, 301])
      expect(await check(await request(target, String(now.getTime() / 1000 + offset)))).toBe(401);
    const signed = await request(target);
    const tampered = new Request(`https://fixture.test${query(at(-60).toISOString())}`, {
      headers: signed.headers,
    });
    expect(await check(tampered)).toBe(401);
    expect(await check(new Request(`https://fixture.test${target}`))).toBe(401);
  });

  it('refuses extra, repeated or malformed query keys with 400 and other methods with 405', async () => {
    const env = await seeded(1);
    const since = t0.toISOString();
    const status = async (target: string, method = 'GET') =>
      (
        await handleReelHandoffs(
          env,
          await request(target, undefined, secret, method),
          now.getTime(),
        )
      ).status;

    expect(await status(query(since, '&ids=1'))).toBe(400);
    expect(await status(query(since, `&since=${since}`))).toBe(400);
    expect(await status(query(since, `&tenant=${tenant}`))).toBe(400);
    expect(await status(`${reelHandoffsPath}?tenant=${tenant}`)).toBe(400);
    expect(await status(query('2026-11-23'))).toBe(400);
    expect(await status(query('2026-11-23T12:00:00+02:00'))).toBe(400);
    expect(await status(query('2026-13-45T99:00:00Z'))).toBe(400);
    expect(await status(`${reelHandoffsPath}?tenant=Bad_Slug&since=${since}`)).toBe(400);
    expect(await status(query(since), 'POST')).toBe(405);
  });
});
