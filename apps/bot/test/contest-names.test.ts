import { expect, it } from 'vitest';
import { contestNamesPath, signNamesRequest } from '@handmake/core';
import { handleContestNames, readEntryNames } from '../src/contest-names';
import { createContestEntryStore } from '../src/contest-store';
import type { Env } from '../src/env';
import { makeD1 } from './helpers';
const a = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const b = '01JBCA1B2C3D4E5F6G7H8J9K0N';
const now = new Date('2026-11-11T12:00:00Z');
const secret = 'fixture-names-key';
const path = `${contestNamesPath}?tenant=fixture&ids=${a},${b}`;
async function request(
  target = path,
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
it('reads names from real D1, isolating tenants and hiding withdrawn/deleted/missing names', async () => {
  const db = await makeD1();
  const store = createContestEntryStore(db);
  const base = {
    entryId: a,
    tenantId: 'fixture',
    photoRef: 'photo',
    consent: true as const,
    consentAt: now,
    createdAt: now,
  };
  await store.submit({ ...base, displayName: 'Fixture nickname' });
  await store.submit({ ...base, tenantId: 'other', displayName: 'Other nickname' });
  const env = { DB: db, NAMES_ENDPOINT_SECRET: secret } as Env;
  const response = await handleContestNames(env, await request(), now.getTime());
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ [a]: 'Fixture nickname', [b]: null });
  await db
    .prepare("UPDATE contest_entries SET status = 'withdrawn' WHERE tenant_id = 'fixture'")
    .run();
  expect(await readEntryNames(db, 'fixture', [a])).toEqual({ [a]: null });
  await db
    .prepare(
      "UPDATE contest_entries SET status = 'submitted', display_name = NULL WHERE tenant_id = 'fixture'",
    )
    .run();
  expect(await readEntryNames(db, 'fixture', [a])).toEqual({ [a]: null });
  expect(await readEntryNames(db, 'missing', [a])).toEqual({ [a]: null });
});
it('rejects stale/future/replayed-outside-window/wrong signatures and tampered tenant or IDs', async () => {
  const env = { NAMES_ENDPOINT_SECRET: secret } as Env;
  for (const offset of [-301, 301]) {
    const req = await request(path, String(now.getTime() / 1000 + offset));
    expect((await handleContestNames(env, req, now.getTime())).status).toBe(401);
  }
  expect(
    (await handleContestNames(env, await request(path, undefined, 'wrong'), now.getTime())).status,
  ).toBe(401);
  const signed = await request();
  for (const target of [path.replace('fixture', 'other'), path.replace(b, a)]) {
    const changed = new Request(`https://fixture.test${target}`, { headers: signed.headers });
    expect((await handleContestNames(env, changed, now.getTime())).status).toBe(401);
  }
  expect((await handleContestNames({} as Env, await request(), now.getTime())).status).toBe(401);
  expect((await handleContestNames(env, await request(), now.getTime() + 301000)).status).toBe(401);
});
it.each([
  '?tenant=fixture&ids=bad',
  `?tenant=fixture&ids=${a}&tenant=other`,
  `?tenant=fixture&ids=${Array(11).fill(a).join(',')}`,
])('rejects authenticated malformed queries', async (query) => {
  const response = await handleContestNames(
    { NAMES_ENDPOINT_SECRET: secret } as Env,
    await request(contestNamesPath + query),
    now.getTime(),
  );
  expect(response.status).toBe(400);
});
it('returns generic storage errors without leaking D1 diagnostics', async () => {
  const env = {
    NAMES_ENDPOINT_SECRET: secret,
    DB: {
      prepare() {
        throw new Error('Private fixture');
      },
    },
  } as unknown as Env;
  const response = await handleContestNames(env, await request(), now.getTime());
  expect(response.status).toBe(503);
  expect(await response.text()).toBe('names unavailable');
});
