import type { MediaSource } from '@handmake/core';

export interface TelegramMediaSourceOptions {
  token: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

interface GetFileResponse {
  ok?: boolean;
  description?: string;
  result?: { file_path?: string };
}

const DEFAULT_API_BASE = 'https://api.telegram.org';

/**
 * Fetches the author's photos from Telegram by file_id (Bot API). Returns
 * the RAW downloaded bytes; the publish pipeline normalises every photo via
 * processPhoto exactly once before storage or delivery. The bot token is
 * never logged or included in error messages.
 */
export class TelegramMediaSource implements MediaSource {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #apiBase: string;

  constructor({ token, fetchImpl, apiBase }: TelegramMediaSourceOptions) {
    this.#token = token;
    this.#fetch = fetchImpl ?? fetch;
    this.#apiBase = apiBase ?? DEFAULT_API_BASE;
  }

  async fetchPhoto(ref: string): Promise<Uint8Array> {
    return this.fetchMedia(ref);
  }

  /** The same opaque file-id transport also preserves generated video and image bytes. */
  async fetchMedia(ref: string, maxBytes = Infinity): Promise<Uint8Array> {
    const filePath = await this.#resolveFilePath(ref);
    const url = `${this.#apiBase}/file/bot${this.#token}/${filePath}`;
    const response = await this.#fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(
        `Telegram file download failed: HTTP ${response.status} for file "${filePath}"`,
      );
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error('Відео має бути до 20 MB.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Telegram file download has no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('Відео має бути до 20 MB.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  async #resolveFilePath(fileId: string): Promise<string> {
    const url = new URL(`${this.#apiBase}/bot${this.#token}/getFile`);
    url.searchParams.set('file_id', fileId);
    let response: Response;
    try {
      response = await this.#fetch(url);
    } catch (cause) {
      throw new Error(`Telegram getFile request failed: ${(cause as Error).message}`);
    }
    if (!response.ok) {
      throw new Error(`Telegram getFile failed: HTTP ${response.status}`);
    }
    let body: GetFileResponse;
    try {
      body = (await response.json()) as GetFileResponse;
    } catch {
      throw new Error('Telegram getFile returned malformed JSON');
    }
    if (body.ok !== true) {
      throw new Error(`Telegram getFile failed: ${body.description ?? 'unknown error'}`);
    }
    const filePath = body.result?.file_path;
    if (!filePath) {
      throw new Error('Telegram getFile response has no result.file_path');
    }
    return filePath;
  }
}
