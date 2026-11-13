import type { StoredDraft } from './draft-store';
import { authenticOf } from './show-authentic';

const limit = 20_000_000;

/** Private, immutable objects keyed by input identity, never by a Telegram file id. */
export function createAuthenticShowStorage(bucket: R2Bucket, token: string) {
  return async (stored: StoredDraft) => {
    const own = authenticOf(stored);
    if (!own?.confirmed || own.editing || !own.people) throw new Error('unconfirmed media');
    const { tenantId, draftId } = stored.draft;
    if (![tenantId, draftId].every((part) => /^[A-Za-z0-9_-]{1,128}$/.test(part)))
      throw new Error('invalid media scope');
    const refs = [];
    for (const item of own.items) {
      if (
        !Number.isInteger(item.size) ||
        item.size <= 0 ||
        item.size > limit ||
        (item.kind === 'video' && (!item.duration || item.duration > 60))
      )
        throw new Error('invalid authentic media');
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(item))),
        ),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      const key = `show-authentic/v1/${tenantId}/${draftId}/${hash}`;
      const existing = await bucket.head(key);
      if (existing && existing.size !== item.size) throw new Error('authentic media mismatch');
      if (!existing) {
        // All failures stay credential-free at this boundary.
        try {
          const response = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: item.fileId }),
            redirect: 'manual',
          });
          const data = (await response.json()) as {
            ok?: boolean;
            result?: { file_path?: string; file_size?: number };
          };
          const path = data.result?.file_path;
          if (
            !response.ok ||
            !data.ok ||
            !path ||
            !/^[A-Za-z0-9_./-]+$/.test(path) ||
            path.split('/').includes('..') ||
            data.result?.file_size !== item.size ||
            item.size <= 0 ||
            item.size > limit
          )
            throw new Error();
          const download = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
            redirect: 'manual',
          });
          if (!download.ok || !download.body) throw new Error();
          const reader = download.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > item.size || size > limit) throw new Error();
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
          }
          if (size !== item.size) throw new Error();
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const saved = await bucket.put(key, bytes, {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: {
              contentType:
                item.kind === 'photo'
                  ? 'image/jpeg'
                  : download.headers.get('content-type') === 'video/quicktime'
                    ? 'video/quicktime'
                    : 'video/mp4',
            },
          });
          if (!saved && (await bucket.head(key))?.size !== size) throw new Error();
        } catch {
          throw new Error('authentic media unavailable');
        }
      }
      refs.push({
        fileName: item.fileName,
        ref: `show-authentic:v1:${tenantId}:${draftId}:${hash}`,
      });
    }
    return refs;
  };
}
