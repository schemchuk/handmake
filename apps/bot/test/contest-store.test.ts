import { expect, it, vi } from 'vitest';
import { newUlid } from '@handmake/core';
import { AuthorEntrySource, createContestEntryStore } from '../src/contest-store';
import type { NewContestEntry } from '../src/contest-store';
import { makeD1 } from './helpers';

const now = new Date('2026-11-11T12:00:00Z');
const entry = (patch: Partial<NewContestEntry> = {}): NewContestEntry => ({
  tenantId: 'fixture',
  entryId: newUlid(),
  photoRef: 'photo-fixture',
  consent: true,
  consentAt: now,
  createdAt: now,
  ...patch,
});
it('stores consent and optional names only in D1; retries cannot overwrite them', async () => {
  const db = await makeD1();
  const store = createContestEntryStore(db);
  const input = entry({ displayName: 'Fixture nickname' });
  expect(await store.submit(input)).toBe(true);
  expect(await store.submit({ ...input, displayName: 'Changed' })).toBe(false);
  const row = await db.prepare('SELECT * FROM contest_entries').first();
  expect(row).toMatchObject({
    display_name: input.displayName,
    consent_at: now.toISOString(),
    status: 'submitted',
  });
  const submissions = await new AuthorEntrySource(store).listSubmissions('fixture', '2026-11-09');
  expect(submissions).toEqual([
    {
      entryId: input.entryId,
      tenantId: 'fixture',
      photoRef: 'photo-fixture',
      week: '2026-11-09',
      createdAt: now.toISOString(),
    },
  ]);
  expect(await store.submit(entry())).toBe(true);
  expect(
    await db
      .prepare('SELECT display_name FROM contest_entries WHERE entry_id != ?')
      .bind(input.entryId)
      .first(),
  ).toEqual({ display_name: null });
});
it('isolates tenants, excludes withdrawn/other-week entries and caps stable ordering at ten', async () => {
  const db = await makeD1();
  const store = createContestEntryStore(db);
  const inputs = Array.from({ length: 12 }, () => entry()).sort((a, b) =>
    a.entryId.localeCompare(b.entryId),
  );
  for (const input of [...inputs].reverse()) await store.submit(input);
  await store.submit(entry({ ...inputs[0], tenantId: 'other' }));
  await store.submit(
    entry({
      createdAt: new Date('2026-11-02T12:00:00Z'),
      consentAt: new Date('2026-11-02T12:00:00Z'),
    }),
  );
  await db
    .prepare("UPDATE contest_entries SET status = 'withdrawn' WHERE tenant_id = ? AND entry_id = ?")
    .bind('fixture', inputs[0]!.entryId)
    .run();
  const source = new AuthorEntrySource(store);
  expect((await source.listSubmissions('fixture', '2026-11-09')).map((e) => e.entryId)).toEqual(
    inputs.slice(1, 11).map((e) => e.entryId),
  );
  expect(await source.listSubmissions('other', '2026-11-09')).toHaveLength(1);
  expect(await source.listSubmissions('missing', '2026-11-09')).toEqual([]);
});
it('rejects missing consent and invalid data before preparing SQL without echoing names', async () => {
  const prepare = vi.fn();
  const store = createContestEntryStore({ prepare } as unknown as D1Database);
  for (const patch of [
    { consent: false },
    { consent: undefined },
    { consentAt: new Date('invalid') },
    { consentAt: new Date('2026-11-12') },
    { createdAt: new Date('invalid') },
    { displayName: 'x'.repeat(31) },
    { displayName: ' ' },
    { entryId: 'invalid' },
    { tenantId: '' },
    { photoRef: '' },
  ]) {
    await expect(
      store.submit(entry({ displayName: 'private-fixture', ...patch } as Partial<NewContestEntry>)),
    ).rejects.toThrow('Invalid contest entry');
  }
  expect(prepare).not.toHaveBeenCalled();
});
it('accepts thirty Unicode characters, rejects thirty-one and enforces DB constraints', async () => {
  const db = await makeD1();
  const store = createContestEntryStore(db);
  expect(await store.submit(entry({ displayName: '🧶'.repeat(30) }))).toBe(true);
  await expect(store.submit(entry({ displayName: '🧶'.repeat(31) }))).rejects.toThrow(
    'Invalid contest entry',
  );
  await expect(
    db
      .prepare(
        "INSERT INTO contest_entries (entry_id,tenant_id,week,file_id,consent_at,created_at) VALUES ('x','x','2026-11-09','photo',NULL,'now')",
      )
      .run(),
  ).rejects.toThrow();
});
it('sanitizes D1 failures and rejects malformed or non-Monday week queries', async () => {
  const prepare = vi.fn(() => {
    throw new Error('private-fixture');
  });
  const store = createContestEntryStore({ prepare } as unknown as D1Database);
  await expect(store.submit(entry({ displayName: 'private-fixture' }))).rejects.toThrow(
    /^Contest entry storage failed$/,
  );
  await expect(store.listSubmissions('fixture', '2026-11-09')).rejects.toThrow(
    /^Contest entry lookup failed$/,
  );
  for (const week of ['2026-11-10', '2026-02-30', 'invalid']) {
    await expect(store.listSubmissions('fixture', week)).rejects.toThrow('Invalid contest query');
  }
});

it('serializes duplicate submissions and sorts creation times before ids', async () => {
  const db = await makeD1();
  const store = createContestEntryStore(db);
  const first = entry();
  const earlier = entry({
    createdAt: new Date('2026-11-10T12:00:00Z'),
    consentAt: new Date('2026-11-10T12:00:00Z'),
  });
  expect((await Promise.all([store.submit(first), store.submit(first)])).sort()).toEqual([
    false,
    true,
  ]);
  await store.submit(earlier);
  expect((await store.listSubmissions('fixture', '2026-11-09')).map((e) => e.entryId)).toEqual([
    earlier.entryId,
    first.entryId,
  ]);
});
