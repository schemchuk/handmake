/** Raw generated media only. Full decoding and marker verification belong to T44d3. */
export const maxFalMediaBytes = 20_000_000;
export const falQueueOrigin = 'https://queue.fal.run';

export class FalShowError extends Error {
  constructor(
    readonly code:
      'invalid-input' | 'disabled' | 'reconcile' | 'provider' | 'timeout' | 'invalid-media',
    readonly requestId?: string,
  ) {
    // Deliberately exclude upstream errors, URLs, credentials, payloads and causes.
    super(`fal show: ${code}`);
    this.name = 'FalShowError';
  }
}

export function mediaUrl(value: string): string {
  const url = new URL(value);
  const allowed =
    url.hostname === 'fal.media' ||
    url.hostname.endsWith('.fal.media') ||
    (url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/falserverless/'));
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('invalid media URL');
  return url.href;
}

export async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error('invalid response');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('response too large');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('response too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function hasMediaHeader(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  if (mime === 'image/png')
    return (
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
      ascii(12, 16) === 'IHDR'
    );
  if (mime === 'image/jpeg')
    return (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[bytes.length - 2] === 255 &&
      bytes[bytes.length - 1] === 217
    );
  if (mime === 'image/webp')
    return bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  return mime === 'video/mp4' && bytes.length >= 24 && ascii(4, 8) === 'ftyp';
}
