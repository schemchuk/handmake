import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { beforeAll, expect, it, vi } from 'vitest';
import type { ShowResultStore } from '@handmake/core';
import { createShowMarkingGate, markShowMedia, verifyMarkedMedia } from '../src/marking';
import { sourceHash } from '../src/marking/label';
import { markingFixtures, receipt } from './fixtures/show-marking';
let fixtures: Awaited<ReturnType<typeof markingFixtures>>;
beforeAll(async () => {
  fixtures = await markingFixtures();
}, 30_000);

it('adds a decoded visible image footer without changing the real-work pixels and archives provider XMP', async () => {
  const { image, markedImage } = fixtures;
  const output = markedImage.result.bytes;
  await verifyMarkedMedia(output, 'image/png', markedImage.marker);
  const metadata = await sharp(output).metadata();
  expect(metadata.height).toBe(264);
  expect(metadata.xmp!.toString()).toContain('fum:SourceXmp=');
  const sourceXmp = /fum:SourceXmp="([^"]+)"/.exec(metadata.xmp!.toString())![1]!;
  expect(Buffer.from(sourceXmp, 'base64').toString()).toContain('Original fixture provenance');
  const body = await sharp(output)
    .extract({ left: 0, top: 0, width: 320, height: 240 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(body.equals(await sharp(image).removeAlpha().raw().toBuffer())).toBe(true);
  expect(markedImage.marker.machineReadable.value).toBe(`show-mark@1:${sourceHash(image)}`);
});
it('verifies every video frame and preserves duration', async () => {
  await verifyMarkedMedia(
    fixtures.markedVideo.result.bytes,
    'video/mp4',
    fixtures.markedVideo.marker,
    5,
  );
  await expect(
    verifyMarkedMedia(
      fixtures.markedVideo.result.bytes,
      'video/mp4',
      fixtures.markedVideo.marker,
      4,
    ),
  ).rejects.toThrow('marking failed');
});
it.each(['metadata', 'visible', 'truncated', 'hash', 'transparent'] as const)(
  'rejects image with %s damage',
  async (damage) => {
    const { result, marker } = fixtures.markedImage;
    let bytes: Buffer = Buffer.from(result.bytes);
    if (damage === 'metadata') bytes = await sharp(bytes).png().toBuffer();
    if (damage === 'transparent')
      bytes = await sharp(bytes).removeAlpha().ensureAlpha(0).keepMetadata().png().toBuffer();
    if (damage === 'visible') bytes = await sharp(bytes).keepMetadata().negate().png().toBuffer();
    if (damage === 'truncated') bytes = bytes.subarray(0, Math.floor(bytes.length / 2));
    const changed =
      damage === 'hash'
        ? {
            ...marker,
            machineReadable: { ...marker.machineReadable, value: 'show-mark@1:' + '0'.repeat(64) },
          }
        : marker;
    await expect(verifyMarkedMedia(bytes, 'image/png', changed)).rejects.toThrow('marking failed');
  },
);
it.each(['png', 'jpeg', 'webp'] as const)('marks real decoded %s input', async (format) => {
  const bytes = await sharp(fixtures.image).toFormat(format).toBuffer();
  const marked = await markShowMedia({ ...receipt, bytes, mimeType: `image/${format}` });
  expect(marked.result.mimeType).toBe('image/png');
  await verifyMarkedMedia(marked.result.bytes, 'image/png', marked.marker);
});
it('rejects a declared image MIME mismatch and tiny unlabelable dimensions', async () => {
  await expect(
    markShowMedia({ ...receipt, bytes: fixtures.image, mimeType: 'image/jpeg' }),
  ).rejects.toThrow('marking failed');
  const tiny = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'gray' } })
    .png()
    .toBuffer();
  await expect(markShowMedia({ ...receipt, bytes: tiny, mimeType: 'image/png' })).rejects.toThrow(
    'marking failed',
  );
});
it('rejects oversized input and post-processing media at the approval gate', async () => {
  const bytes = new Uint8Array(20_000_001);
  await expect(markShowMedia({ ...receipt, bytes, mimeType: 'image/png' })).rejects.toThrow(
    'marking failed',
  );
  await expect(verifyMarkedMedia(bytes, 'image/png', fixtures.markedImage.marker)).rejects.toThrow(
    'marking failed',
  );
});
it.each(['truncated', 'metadata', 'all-frames', 'last-frame'] as const)(
  'rejects video with %s damage',
  async (damage) => {
    const { result, marker } = fixtures.markedVideo;
    let bytes: Buffer = Buffer.from(result.bytes);
    if (damage === 'truncated') bytes = bytes.subarray(0, Math.floor(bytes.length / 2));
    else {
      const dir = await mkdtemp(path.join(tmpdir(), 'handmake-tamper-'));
      try {
        await writeFile(path.join(dir, 'input.mp4'), bytes);
        const filter =
          damage === 'metadata'
            ? []
            : [
                '-vf',
                `drawbox=x=0:y=ih-24:w=iw:h=24:color=black:t=fill${damage === 'last-frame' ? ":enable='gte(t,4.5)'" : ''}`,
              ];
        await promisify(execFile)(
          'ffmpeg',
          [
            '-v',
            'error',
            '-threads',
            '1',
            '-i',
            'input.mp4',
            ...filter,
            '-map_metadata',
            '0',
            ...(damage === 'metadata' ? ['-metadata', 'comment='] : []),
            '-c:v',
            'libx264',
            '-threads',
            '1',
            '-crf',
            '18',
            'output.mp4',
          ],
          { cwd: dir },
        );
        bytes = await readFile(path.join(dir, 'output.mp4'));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    await expect(verifyMarkedMedia(bytes, 'video/mp4', marker)).rejects.toThrow('marking failed');
  },
  15_000,
);
it('rejects an MP4 header without a playable video and sanitizes native errors', async () => {
  const bytes = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
  await expect(markShowMedia({ ...receipt, bytes, mimeType: 'video/mp4' })).rejects.toThrow(
    /^show media marking failed$/,
  );
});

function store(
  kind: 'raw' | 'marked',
  initial?: typeof fixtures.markedImage.result,
): ShowResultStore {
  let result = initial;
  return {
    get: vi.fn(
      async (tenant, show, attempt) =>
        result && { ref: `show-${kind}:v1:${tenant}:${show}:${attempt}`, result },
    ),
    put: vi.fn(async (_tenant, _show, _attempt, value) => {
      if (result && sourceHash(result.bytes) !== sourceHash(value.bytes))
        throw new Error('immutable');
      result = value;
    }),
  };
}
it('marks once, persists separately and retries using existing verified bytes', async () => {
  const raw = store('raw', { ...receipt, bytes: fixtures.image, mimeType: 'image/png' }),
    marked = store('marked');
  const gate = createShowMarkingGate(raw, marked);
  const first = await gate.prepare('tenant', 'show', 'attempt');
  expect(first.ref).toBe('show-marked:v1:tenant:show:attempt');
  expect(await gate.prepare('tenant', 'show', 'attempt')).toEqual(first);
  expect(marked.put).toHaveBeenCalledTimes(1);
  expect(raw.put).not.toHaveBeenCalled();
});
it('recovers a marked write whose acknowledgement was lost without regenerating media', async () => {
  const raw = store('raw', { ...receipt, bytes: fixtures.image, mimeType: 'image/png' }),
    marked = store('marked');
  const write = marked.put;
  marked.put = vi.fn(async (...args: Parameters<ShowResultStore['put']>) => {
    await write(...args);
    throw new Error('acknowledgement lost');
  });
  const gate = createShowMarkingGate(raw, marked);
  await expect(gate.prepare('tenant', 'show', 'attempt')).rejects.toThrow('marking failed');
  const result = await gate.prepare('tenant', 'show', 'attempt');
  expect(result.ref).toMatch(/^show-marked:/);
  expect(marked.put).toHaveBeenCalledTimes(1);
});
it.each(['raw-ref', 'callId', 'unmarked', 'different-source'] as const)(
  'blocks approval with %s',
  async (tamper) => {
    const raw = store('raw', { ...receipt, bytes: fixtures.image, mimeType: 'image/png' });
    const marked = store(tamper === 'raw-ref' ? 'raw' : 'marked', {
      ...fixtures.markedImage.result,
      ...(tamper === 'callId' ? { callId: 'other-call' } : {}),
      ...(tamper === 'unmarked' ? { bytes: fixtures.image } : {}),
    });
    if (tamper === 'different-source')
      raw.get = vi.fn(async () => ({
        ref: 'show-raw:v1:tenant:show:attempt',
        result: { ...receipt, bytes: new Uint8Array([1]), mimeType: 'image/png' as const },
      }));
    await expect(
      createShowMarkingGate(raw, marked).prepare('tenant', 'show', 'attempt'),
    ).rejects.toThrow('marking failed');
    expect(marked.put).not.toHaveBeenCalled();
  },
);
