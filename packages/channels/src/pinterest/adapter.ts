import type {
  ChannelAdapter,
  DeliverContext,
  DeliverProgress,
  SendOperation,
} from '@handmake/core';

export const pinterestSecretNames = [
  'PINTEREST_APP_ID',
  'PINTEREST_APP_SECRET',
  'PINTEREST_REFRESH_TOKEN',
  'PINTEREST_BOARD_ID',
] as const;

export class PinterestAdapterError extends Error {
  override name = 'PinterestAdapterError';
}

interface Options {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  saveRefreshToken?: (token: string) => Promise<void>;
}

interface Settings {
  language: 'de';
  boardId: 'PINTEREST_BOARD_ID';
  sandbox?: boolean;
  link?: string;
}

function settingsOf(value: unknown): Settings {
  const settings = value as Settings | undefined;
  if (settings?.language !== 'de' || settings.boardId !== 'PINTEREST_BOARD_ID')
    throw new PinterestAdapterError('Pinterest requires German copy and a board secret name');
  return settings;
}

const truncate = (text: string, limit: number) => Array.from(text).slice(0, limit).join('');

export function createPinterestAdapter(options: Options = {}): ChannelAdapter {
  const request = async (url: string, step: string, init?: RequestInit): Promise<Response> => {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new PinterestAdapterError(`Pinterest ${step} request failed`);
    });
    if (!response.ok)
      throw new PinterestAdapterError(`Pinterest ${step} failed (HTTP ${response.status})`);
    return response;
  };
  const json = async (url: string, step: string, init?: RequestInit) => {
    const response = await request(url, step, init);
    const body: unknown = await response.json().catch(() => undefined);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new PinterestAdapterError(`Pinterest ${step} returned invalid JSON`);
    return body as Record<string, unknown>;
  };

  async function registerVideo(
    api: string,
    headers: Record<string, string>,
    video: Uint8Array,
  ): Promise<string> {
    const data = await json(`${api}/media`, 'media registration', {
      method: 'POST',
      headers,
      body: JSON.stringify({ media_type: 'video' }),
    });
    const { media_id: id, upload_url: url, upload_parameters: parameters } = data;
    const uploadUrl = typeof url === 'string' ? URL.parse(url) : null;
    if (
      typeof id !== 'string' ||
      !/^\d+$/.test(id) ||
      uploadUrl?.protocol !== 'https:' ||
      uploadUrl.username ||
      uploadUrl.password ||
      !parameters ||
      typeof parameters !== 'object' ||
      Array.isArray(parameters)
    )
      throw new PinterestAdapterError('Pinterest returned invalid media upload details');
    const body = new FormData();
    for (const [name, value] of Object.entries(parameters)) {
      if (typeof value !== 'string' || name === 'file')
        throw new PinterestAdapterError('Pinterest returned invalid upload parameters');
      body.append(name, value);
    }
    body.append('file', new Blob([video], { type: 'video/mp4' }), 'video.mp4');
    await request(uploadUrl.href, 'media upload', { method: 'POST', body });
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < 20; attempt++) {
      if (attempt) await sleep(3000);
      const { status } = await json(`${api}/media/${id}`, 'media status', { headers });
      if (status === 'succeeded') return id;
      if (status === 'failed') throw new PinterestAdapterError('Pinterest video processing failed');
    }
    throw new PinterestAdapterError('Pinterest timed out waiting for video processing');
  }

  return {
    key: 'pinterest',
    capabilities: {
      maxPhotos: 1,
      captionLimit: 500,
      messageLimit: 0,
      polls: false,
      pollMaxOptions: 0,
      pollQuestionLimit: 0,
      pollOptionLimit: 0,
    },
    render(post, value): SendOperation[] {
      const { language } = settingsOf(value);
      const caption = post.texts[language]?.trim();
      if (!caption || !post.photos.length)
        throw new PinterestAdapterError('Pinterest needs German copy and a cover photo');
      return [{ kind: 'mediaGroup', photoIndexes: [0], caption: truncate(caption, 500) }];
    },
    async deliver(ops: SendOperation[], ctx: DeliverContext, progress?: DeliverProgress) {
      const { sandbox, link, boardId } = settingsOf(ctx.settings);
      const start = progress?.startAt ?? 0;
      const ids = progress?.knownIds ?? [];
      if (ops.length !== 1 || (start !== 0 && start !== 1) || ids.length !== start)
        throw new PinterestAdapterError('Invalid Pinterest delivery progress');
      if (start === 1) return [...ids];
      const [op] = ops;
      const cover = ctx.photoUrls?.[0];
      if (op?.kind !== 'mediaGroup' || !op.caption || !link || !cover)
        throw new PinterestAdapterError('Pinterest needs a caption, work link and cover URL');
      const [appId, appSecret, refreshToken, board] = await Promise.all(
        [pinterestSecretNames[0], pinterestSecretNames[1], pinterestSecretNames[2], boardId].map(
          (name) => ctx.secrets.resolve(name),
        ),
      );
      if (!appId?.trim() || !appSecret?.trim() || !refreshToken?.trim() || !board?.trim())
        throw new PinterestAdapterError('Pinterest secrets are empty');
      const api = sandbox ? 'https://api-sandbox.pinterest.com/v5' : 'https://api.pinterest.com/v5';
      const token = await json(`${api}/oauth/token`, 'token refresh', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${appId}:${appSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      });
      if (
        typeof token.refresh_token === 'string' &&
        token.refresh_token &&
        token.refresh_token !== refreshToken
      ) {
        if (!options.saveRefreshToken)
          throw new PinterestAdapterError('Pinterest needs a refresh token writer');
        await options.saveRefreshToken(token.refresh_token);
      }
      if (typeof token.access_token !== 'string' || !token.access_token)
        throw new PinterestAdapterError('Pinterest returned no access token');
      const headers = {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      };
      const media_source = ctx.video?.length
        ? {
            source_type: 'video_id',
            media_id: await registerVideo(api, headers, ctx.video),
            cover_image_url: cover,
          }
        : { source_type: 'image_url', url: cover };
      // A Pin POST might have succeeded after a transport failure; never retry it here.
      const { id } = await json(`${api}/pins`, 'Pin creation', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          board_id: board,
          title: truncate(op.caption.split(/\r?\n/, 1)[0]!, 100),
          description: op.caption,
          link,
          media_source,
        }),
      });
      if (typeof id !== 'string' || !/^\d+$/.test(id))
        throw new PinterestAdapterError('Pinterest returned an invalid Pin id');
      await progress?.onDelivered(0, id);
      return [id];
    },
  };
}
