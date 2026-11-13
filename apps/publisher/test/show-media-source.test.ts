import { expect, it, vi } from 'vitest';
import { createPublicationMediaSource } from '../src/show-media-source';
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'fixture-token' };
it('resolves scoped authentic and marked objects with bounded private requests', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('media'));
  const source = createPublicationMediaSource('tenant', 'show', env, fetcher);
  for (const ref of [
    `show-authentic:v1:tenant:show:${'b'.repeat(64)}`,
    'show-marked:v1:tenant:show:attempt',
  ]) {
    expect(await source.fetchMedia(ref)).toEqual(Buffer.from('media'));
  }
  expect(String(fetcher.mock.calls[1]?.[0])).toContain('/show-marked/v1/tenant/show/attempt');
  await expect(source.fetchMedia('show-marked:v1:other:show:attempt')).rejects.toThrow('scope');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects missing, oversized and failed responses without exposing credentials', async () => {
  const ref = 'show-marked:v1:tenant:show:attempt';
  for (const response of [
    new Response('', { status: 404 }),
    new Response(new Uint8Array(20_000_001)),
  ]) {
    const source = createPublicationMediaSource('tenant', 'show', env, async () => response);
    await expect(source.fetchMedia(ref)).rejects.toThrow('Private show media unavailable');
  }
});
