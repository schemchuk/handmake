import type { MediaSource, PhotoFile } from '@handmake/core';

import { processPhoto } from './photos/process';
import { TelegramMediaSource } from './photos/telegram-media-source';
import { requiredEnv } from './required-env';

/**
 * Shared photo pipeline (T10): fetch the raw bytes from the media source and
 * normalise each photo via processPhoto exactly once, before the bytes reach
 * the content store or a channel adapter. With no fileIds no media source
 * (and no bot token) is needed at all.
 */
export async function fetchAndProcessPhotos(
  fileIds: string[],
  mediaSource: MediaSource | undefined,
  env: NodeJS.ProcessEnv,
): Promise<PhotoFile[]> {
  if (fileIds.length === 0) return [];
  const source =
    mediaSource ?? new TelegramMediaSource({ token: requiredEnv('TELEGRAM_BOT_TOKEN', env) });
  const photos: PhotoFile[] = [];
  for (const [i, fileId] of fileIds.entries()) {
    const raw = await source.fetchPhoto(fileId);
    const processed = await processPhoto(raw);
    photos.push({ fileName: `photo-${i + 1}.jpg`, data: processed.data });
  }
  return photos;
}
