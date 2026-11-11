import { expect, it, vi } from 'vitest';
import { signNamesRequest } from '@handmake/core';
import { fetchEntryNames } from '../src/entry-names';
const id = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const env = {
  PUBLISH_CALLBACK_URL: 'https://fixture.test/callbacks/published',
  NAMES_ENDPOINT_SECRET: 'fixture-key',
};
it('signs the complete query and masks names before returning, escaping Actions commands', async () => {
  const logger = vi.fn();
  const fetchImpl = vi.fn(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    expect(url.pathname).toBe('/internal/contest-names');
    expect(url.searchParams.get('tenant')).toBe('fixture');
    expect(headers.get('X-Handmake-Signature')).toBe(
      await signNamesRequest(
        env.NAMES_ENDPOINT_SECRET,
        'GET',
        url.pathname + url.search,
        headers.get('X-Handmake-Timestamp')!,
      ),
    );
    expect(init?.redirect).toBe('error');
    return Response.json({ [id]: 'Fixture%\r\nName' });
  }) as typeof fetch;
  const names = await fetchEntryNames('fixture', [id], { env, logger, fetchImpl });
  expect(logger).toHaveBeenCalledExactlyOnceWith('::add-mask::Fixture%25%0D%0AName');
  expect(names[id]).toBe('Fixture%\r\nName');
});
it.each([
  new Response('private fixture', { status: 401 }),
  Response.json({ [id]: 7 }),
  Response.json({}),
  Response.json({ [id]: 'x'.repeat(31) }),
])('fails closed without leaking name-bearing response errors', async (response) => {
  await expect(
    fetchEntryNames('fixture', [id], {
      env,
      logger: vi.fn(),
      fetchImpl: vi.fn().mockResolvedValue(response),
    }),
  ).rejects.toThrow('Contest names fetch failed');
});
it('does not call the endpoint when there are no placeholders', async () => {
  const fetchImpl = vi.fn();
  expect(await fetchEntryNames('fixture', [], { env: {}, logger: vi.fn(), fetchImpl })).toEqual({});
  expect(fetchImpl).not.toHaveBeenCalled();
});
