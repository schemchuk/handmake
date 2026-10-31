import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { createGitHubTenantConfigSource, tenantConfigTtlMs } from '../src/tenant-config-source';

const yaml = readFileSync(
  new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
  'utf8',
);
afterEach(() => vi.restoreAllMocks());

it('shares fresh config across source instances and refreshes after TTL', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const fetchImpl = vi.fn(async () => new Response(yaml));
  const options = { repo: 'owner/repo', ref: 'main', fetchImpl };
  const first = await createGitHubTenantConfigSource(options).load('one');
  expect(await createGitHubTenantConfigSource(options).load('one')).toBe(first);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(1000 + tenantConfigTtlMs);
  fetchImpl.mockResolvedValueOnce(
    new Response(yaml.replace('monthlyTargetEur: 20', 'monthlyTargetEur: 30')),
  );
  expect((await createGitHubTenantConfigSource(options).load('one')).ai?.monthlyTargetEur).toBe(30);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each(['http', 'network', 'invalid-yaml'])(
  'uses last-known config after %s refresh failure, then recovers',
  async (failure) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response(yaml));
    const source = createGitHubTenantConfigSource({ repo: 'owner/repo', ref: 'main', fetchImpl });
    const previous = await source.load('one');
    clock.mockReturnValue(1000 + tenantConfigTtlMs);
    if (failure === 'network') fetchImpl.mockRejectedValueOnce(new Error('network unavailable'));
    else
      fetchImpl.mockResolvedValueOnce(
        new Response(failure === 'http' ? '' : 'bad yaml', {
          status: failure === 'http' ? 503 : 200,
        }),
      );
    expect(await source.load('one')).toBe(previous);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Using cached tenant config after refresh failure',
    );
    await source.load('one');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  },
);

it('isolates cache entries by tenant, repository and ref; rejects cold fetch failures', async () => {
  const fetchImpl = vi.fn(async () => new Response(yaml));
  const options = { repo: 'owner/repo', ref: 'main', fetchImpl };
  await createGitHubTenantConfigSource(options).load('one');
  for (const [changed, tenant] of [
    [options, 'two'],
    [{ ...options, ref: 'feature' }, 'one'],
    [{ ...options, repo: 'owner/other' }, 'one'],
  ] as const) {
    fetchImpl.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(createGitHubTenantConfigSource(changed).load(tenant)).rejects.toThrow('HTTP 503');
  }
  expect(fetchImpl).toHaveBeenCalledTimes(4);
});
