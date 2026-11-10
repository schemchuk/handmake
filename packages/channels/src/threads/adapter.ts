import type {
  ChannelAdapter,
  DeliverContext,
  DeliverProgress,
  RemoteId,
  SendOperation,
} from '@handmake/core';
import {
  MetaGraphClient,
  metaPhotoUrls,
  type MetaAuthState,
  type MetaCallRetry,
  type MetaGraphOptions,
} from '../meta/graph';
import {
  assertThreadsText,
  parseThreadsSettings,
  renderThreads,
  renderThreadsShow,
  threadsCapabilities,
} from './render';

export const threadsUserIdSecret = 'THREADS_USER_ID';
export const threadsAccessTokenSecret = 'THREADS_ACCESS_TOKEN';
export class ThreadsAdapterError extends Error {}
export interface ThreadsAdapterOptions extends MetaGraphOptions {
  statusPollIntervalMs?: number;
  statusPollMaxAttempts?: number;
}
/** Ledger prefix skips delivered ops. Ambiguous writes are never retried in-process. */
export class ThreadsAdapter implements ChannelAdapter {
  readonly key = 'threads';
  readonly capabilities = threadsCapabilities;
  readonly #graph: MetaGraphClient;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #options: ThreadsAdapterOptions;
  constructor(options: ThreadsAdapterOptions = {}) {
    this.#options = options;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const fetchImpl = options.fetchImpl ?? fetch;
    this.#graph = new MetaGraphClient('Threads', {
      ...options,
      apiBase: options.apiBase ?? 'https://graph.threads.com/v1.0',
      fetchImpl: (input, init) => {
        if (init?.method === 'POST') {
          const params = JSON.parse(String(init.body)) as Record<string, unknown>;
          init = {
            ...init,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(
              Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]),
            ),
          };
        }
        return fetchImpl(input, init);
      },
    });
  }
  readonly render = renderThreads;
  readonly renderShow = renderThreadsShow;
  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    parseThreadsSettings(ctx.settings);
    const start = progress?.startAt ?? 0;
    const ids = [...(progress?.knownIds ?? [])];
    if (!Number.isInteger(start) || start < 0 || start > ops.length || ids.length !== start)
      throw new ThreadsAdapterError('invalid Threads delivery progress');
    // Validate the entire pending batch before any side effect.
    const pending = ops.slice(start).map((op) => {
      if ((op.kind !== 'message' && op.kind !== 'mediaGroup') || op.replyToOp !== undefined)
        throw new ThreadsAdapterError('Threads supports only independent text/image ops');
      assertThreadsText(op.kind === 'message' ? op.text : (op.caption ?? ''));
      if (op.kind === 'mediaGroup' && (!op.photoIndexes.length || op.photoIndexes.length > 20))
        throw new ThreadsAdapterError('Threads image ops need 1–20 photos');
      return {
        text: op.kind === 'message' ? op.text : op.caption!,
        urls: op.kind === 'message' ? [] : metaPhotoUrls('Threads', op, ctx),
      };
    });
    if (!pending.length) return ids;
    const userId = await ctx.secrets.resolve(threadsUserIdSecret);
    const auth: MetaAuthState = { token: await ctx.secrets.resolve(threadsAccessTokenSecret) };
    if (!/^\d+$/.test(userId) || !auth.token.trim())
      throw new ThreadsAdapterError(
        'Threads requires a numeric user id and non-empty access token',
      );
    const call = this.#graph.opRetry(auth, this.#graph.newSession(), async () => {
      // Threads cannot refresh an expired token; rotation must precede expiry.
      throw new ThreadsAdapterError('Threads token expired; rotate THREADS_ACCESS_TOKEN');
    });
    for (const [index, { text, urls }] of pending.entries()) {
      let remoteId: string;
      try {
        const create = (params: Record<string, unknown>) =>
          call(async () =>
            this.#id(await this.#graph.call(auth, 'POST', `/${userId}/threads`, params)),
          );
        const children: string[] = [];
        if (urls.length > 1) {
          for (const url of urls) {
            const child = await create({
              media_type: 'IMAGE',
              image_url: url,
              is_carousel_item: true,
            });
            await this.#awaitContainer(child, auth, call);
            children.push(child);
          }
        }
        const container = await create({
          text,
          ...(urls.length > 1
            ? { media_type: 'CAROUSEL', children: children.join(',') }
            : urls.length
              ? { media_type: 'IMAGE', image_url: urls[0] }
              : { media_type: 'TEXT' }),
        });
        await this.#awaitContainer(container, auth, call);
        remoteId = await call(async () =>
          this.#id(
            await this.#graph.call(auth, 'POST', `/${userId}/threads_publish`, {
              creation_id: container,
            }),
          ),
        );
      } catch (error) {
        if (error instanceof ThreadsAdapterError) throw error;
        // Upstream errors may echo request text, URLs or tokens.
        throw new ThreadsAdapterError('Threads delivery failed; check token, quota and media');
      }
      ids.push(remoteId);
      await progress?.onDelivered(start + index, remoteId);
    }
    return ids;
  }
  #id(value: unknown): string {
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !/^\d+$/.test(id))
      throw new ThreadsAdapterError('Threads returned a malformed id');
    return id;
  }
  async #awaitContainer(id: string, auth: MetaAuthState, call: MetaCallRetry): Promise<void> {
    const attempts = this.#options.statusPollMaxAttempts ?? 6;
    for (let poll = 0; poll < attempts; poll++) {
      const result = (await call(() => this.#graph.call(auth, 'GET', `/${id}?fields=status`))) as {
        status?: unknown;
      } | null;
      if (result?.status === 'FINISHED') return;
      if (result?.status !== 'IN_PROGRESS')
        throw new ThreadsAdapterError('Threads container failed or returned an unknown status');
      if (poll + 1 < attempts) await this.#sleep(this.#options.statusPollIntervalMs ?? 60000);
    }
    throw new ThreadsAdapterError('Threads container processing timed out');
  }
}
export const createThreadsAdapter = (options: ThreadsAdapterOptions = {}): ThreadsAdapter =>
  new ThreadsAdapter(options);
