import type { ShowImage, ShowResultStore, ShowSourceImage, ShowCallResult } from '@handmake/core';
import { markImage, verifyImage } from './image';
import { markVideo, verifyVideo } from './video';
import { bounded, label, sourceHash, version } from './label';
type Mime = ShowSourceImage['mimeType'] | 'video/mp4';
type Result = ShowCallResult<Mime>;
const safe = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch {
    throw new Error('show media marking failed');
  }
};
export function markerFor(hash: string, mime: Mime): ShowImage['marker'] {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('show source hash');
  return {
    visible: label,
    machineReadable: {
      format: mime === 'video/mp4' ? 'MP4/comment' : 'XMP',
      value: `${version}:${hash}`,
    },
  };
}
export const verifyMarkedMedia = (
  bytes: Uint8Array,
  mime: Mime,
  marker: ShowImage['marker'],
  duration = 5,
) =>
  safe(async () => {
    bounded(bytes);
    const hash = marker.machineReadable.value.slice(`${version}:`.length);
    const expected = markerFor(hash, mime);
    if (
      marker.visible !== expected.visible ||
      marker.machineReadable.format !== expected.machineReadable.format ||
      marker.machineReadable.value !== expected.machineReadable.value
    )
      throw new Error('show marker mismatch');
    if (mime === 'video/mp4') await verifyVideo(bytes, hash, duration);
    else if (mime === 'image/png') await verifyImage(bytes, hash);
    else throw new Error('marked images must be PNG');
  });
export const markShowMedia = (raw: Result, duration = 5) =>
  safe(async () => {
    bounded(raw.bytes);
    const hash = sourceHash(raw.bytes),
      mimeType = raw.mimeType === 'video/mp4' ? 'video/mp4' : 'image/png';
    const bytes =
      raw.mimeType === 'video/mp4'
        ? await markVideo(raw.bytes, hash, duration)
        : await markImage(raw.bytes, hash, raw.mimeType);
    const marker = markerFor(hash, mimeType);
    await verifyMarkedMedia(bytes, mimeType, marker, duration);
    return { result: { ...raw, bytes, mimeType } as Result, marker };
  });
/** Node-only gate T44e MUST call before preview/approval. Stores must be private and separate.
 * Transport adapters are supplied later; no generator or paid-call dependency exists here.
 */
export function createShowMarkingGate(raw: ShowResultStore, marked: ShowResultStore) {
  return {
    prepare: (tenant: string, show: string, attempt: string) =>
      safe(async () => {
        const original = await raw.get(tenant, show, attempt);
        const expectedRef = (kind: string) => `show-${kind}:v1:${tenant}:${show}:${attempt}`;
        if (!original || original.ref !== expectedRef('raw'))
          throw new Error('raw show result missing');
        let output = await marked.get(tenant, show, attempt);
        if (!output) {
          const processed = await markShowMedia(original.result);
          await marked.put(tenant, show, attempt, processed.result);
          output = await marked.get(tenant, show, attempt);
        }
        if (
          !output ||
          output.ref !== expectedRef('marked') ||
          output.result.mimeType !==
            (original.result.mimeType === 'video/mp4' ? 'video/mp4' : 'image/png') ||
          ['callId', 'model', 'promptVersion', 'costEur'].some(
            (key) => original.result[key as keyof Result] !== output!.result[key as keyof Result],
          )
        )
          throw new Error('marked receipt mismatch');
        const marker = markerFor(sourceHash(original.result.bytes), output.result.mimeType);
        await verifyMarkedMedia(output.result.bytes, output.result.mimeType, marker);
        return { ...output, marker };
      }),
  };
}
