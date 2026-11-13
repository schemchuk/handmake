import { afterEach, expect, it, vi } from 'vitest';
import { createAuthenticShowStorage } from '../src/show-authentic-storage';
import type { StoredDraft } from '../src/draft-store';

const stored = {
  draft: {
    tenantId: 'tenant',
    draftId: 'show',
    extras: {
      showAuthentic: {
        confirmed: true,
        editing: false,
        people: 'both',
        items: [
          { fileId: 'private-photo', fileName: 'authentic-photo-1.jpg', kind: 'photo', size: 3 },
          {
            fileId: 'private-video',
            fileName: 'authentic-video-1.mp4',
            kind: 'video',
            size: 3,
            duration: 10,
          },
        ],
      },
    },
  },
} as unknown as StoredDraft;
afterEach(() => vi.unstubAllGlobals());
function fixture(failVideo = false) {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    head: vi.fn(async (key: string) => (objects.has(key) ? { size: 3 } : null)),
    put: vi.fn(async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
      return {};
    }),
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/getFile')) {
      const id = JSON.parse(String(init?.body)).file_id;
      if (failVideo && id === 'private-video') return new Response('{}', { status: 500 });
      return Response.json({ ok: true, result: { file_path: `media/${id}`, file_size: 3 } });
    }
    return new Response(new Uint8Array([1, 2, 3]));
  });
  vi.stubGlobal('fetch', fetcher);
  return {
    objects,
    bucket,
    fetcher,
    save: createAuthenticShowStorage(bucket as unknown as R2Bucket, 'TEST'),
  };
}
it('stores private bytes once and retries without another Telegram request', async () => {
  const f = fixture();
  const refs = await f.save(stored);
  expect(await f.save(stored)).toEqual(refs);
  expect(f.fetcher).toHaveBeenCalledTimes(4);
  expect(f.bucket.put).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(refs)).not.toContain('private-');
  expect(refs[0]!.ref).toMatch(/^show-authentic:v1:tenant:show:[a-f0-9]{64}$/);
  expect([...f.objects.values()]).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])]);
});
it('retains a completed photo when video download fails and resumes only the missing file', async () => {
  const f = fixture(true);
  await expect(f.save(stored)).rejects.toThrow('authentic media unavailable');
  expect(f.objects.size).toBe(1);
  await expect(f.save(stored)).rejects.toThrow('authentic media unavailable');
  expect(f.fetcher).toHaveBeenCalledTimes(4);
});
it('rejects unconfirmed inputs and wrong response sizes without writing objects', async () => {
  const f = fixture();
  const input = structuredClone(stored);
  (input.draft.extras['showAuthentic'] as { confirmed: boolean }).confirmed = false;
  await expect(f.save(input)).rejects.toThrow('unconfirmed');
  expect(f.fetcher).not.toHaveBeenCalled();
  f.fetcher.mockImplementation(async () =>
    Response.json({ ok: true, result: { file_path: 'media/file', file_size: 21_000_000 } }),
  );
  await expect(f.save(stored)).rejects.toThrow('authentic media unavailable');
  expect(f.bucket.put).not.toHaveBeenCalled();
});

it('rejects a download exceeding the declared byte count', async () => {
  const f = fixture();
  f.fetcher.mockImplementation(async (url) =>
    url.endsWith('/getFile')
      ? Response.json({ ok: true, result: { file_path: 'media/file', file_size: 3 } })
      : new Response(new Uint8Array([1, 2, 3, 4])),
  );
  await expect(f.save(stored)).rejects.toThrow('authentic media unavailable');
  expect(f.bucket.put).not.toHaveBeenCalled();
});
it('scopes stored identities to the tenant and show', async () => {
  const f = fixture();
  const first = await f.save(stored);
  const other = structuredClone(stored);
  other.draft.tenantId = 'other';
  const second = await f.save(other);
  expect(second[0]!.ref).not.toEqual(first[0]!.ref);
  expect(f.objects.size).toBe(4);
});
