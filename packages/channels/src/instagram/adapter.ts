import type {
  ChannelAdapter,
  ChannelComment,
  ChannelCommentsCapability,
  ChannelPostRef,
  DeliverContext,
  DeliverProgress,
  Post,
  RemoteId,
  SendOperation,
  Show,
  ShowRenderContext,
} from '@handmake/core';

import { createMetaCommentsCapability, unixSinceQuery } from '../meta/comments';
import {
  MetaGraphClient,
  MetaGraphError,
  metaPhotoUrls,
  type MetaAuthState,
  type MetaCallRetry,
  type MetaDeliverSession,
  type MetaGraphOptions,
} from '../meta/graph';
import { exchangeLongLivedToken, metaAppIdSecret, metaAppSecretSecret } from '../meta/token';
import {
  instagramCapabilities,
  parseInstagramChannelSettings,
  renderInstagram,
  renderInstagramShow,
} from './render';

export interface InstagramAdapterOptions extends MetaGraphOptions {
  /** Sleep between container-status polls; default 2000 ms. */
  statusPollIntervalMs?: number;
  /** Max container-status polls before failing the op; default 30. */
  statusPollMaxAttempts?: number;
  /** Bound on followed comment/posts pages per comments-capability op; default 5. */
  commentsMaxPages?: number;
}

const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const DEFAULT_STATUS_POLL_MAX_ATTEMPTS = 30;

/** Secret names the adapter resolves through `DeliverContext.secrets`. */
export const instagramUserIdSecret = 'INSTAGRAM_USER_ID';
export const instagramAccessTokenSecret = 'INSTAGRAM_ACCESS_TOKEN';
// metaAppIdSecret/metaAppSecretSecret (META_APP_ID/META_APP_SECRET) feed
// `exchangeLongLivedToken` for the once-per-deliver expired-token retry;
// they live in ../meta/token and are re-exported by the package index.

export class InstagramAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramAdapterError';
  }
}

type MediaGroupOp = Extract<SendOperation, { kind: 'mediaGroup' }>;

/**
 * Instagram ChannelAdapter (T26a2, F33): `render` delegates to
 * renderInstagram; `deliver` talks to the Graph API content-publishing
 * flow — media container(s) → status polling → media_publish. A 1-photo
 * op becomes a single image container; 2-10 photos become carousel
 * children plus one carousel container (video/Reels stays a later task;
 * only `mediaGroup` ops are deliverable). Instagram has no native
 * idempotency keys, so the ledger-driven resume (`progress.startAt` /
 * `progress.knownIds`, persisted by the caller between ops via
 * `onDelivered`) IS the idempotency mechanism, exactly like Telegram:
 * a remote id is recorded only after media_publish accepted the op, and
 * a re-run resumes after the recorded prefix.
 *
 * Meta pulls the photos from public URLs (`DeliverContext.photoUrls`,
 * aligned with `photoIndexes`), so no bytes are uploaded here; the
 * publisher builds raw-GitHub URLs in T26a3. Secrets are resolved by the
 * fixed names INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN; on an
 * expired-token error (code 190) the adapter exchanges the token via the
 * shared `exchangeLongLivedToken` (META_APP_ID / META_APP_SECRET) at most
 * once per deliver and retries the failed call. That in-flight refresh is
 * only a last resort: Meta's fb_exchange_token refuses an already-expired
 * token, so the reliable rotation is external — exchange the still-valid
 * stored token before its ~60-day expiry and update the
 * INSTAGRAM_ACCESS_TOKEN secret (operator runbook:
 * docs/instagram-runbook.md). The refreshed token is never persisted back
 * into the secrets store. A 429 burns one attempt per retry, at the level
 * of the individual call, like Telegram; nothing else is retried
 * in-process (the ledger re-run covers it). Tokens never appear in logs
 * or error messages: the request URL carries the access_token, so errors
 * name the endpoint only.
 *
 * Transport behaviour (auth, per-call 429 retry, the once-per-deliver
 * 190 refresh, error mapping, the no-token-logging rule) lives in the
 * shared `MetaGraphClient` (T26b); this class keeps the Instagram
 * endpoints, payload shapes and the container-status polling.
 */
export class InstagramAdapter implements ChannelAdapter {
  readonly key = 'instagram';
  readonly capabilities = instagramCapabilities;
  readonly comments: ChannelCommentsCapability;

  readonly #graph: MetaGraphClient;
  readonly #graphOptions: MetaGraphOptions;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #statusPollIntervalMs: number;
  readonly #statusPollMaxAttempts: number;

  constructor({
    commentsMaxPages,
    statusPollIntervalMs,
    statusPollMaxAttempts,
    ...graphOptions
  }: InstagramAdapterOptions = {}) {
    this.#graph = new MetaGraphClient('Instagram', graphOptions);
    this.#graphOptions = graphOptions;
    this.#sleep = graphOptions.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.#statusPollIntervalMs = statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS;
    this.#statusPollMaxAttempts = statusPollMaxAttempts ?? DEFAULT_STATUS_POLL_MAX_ATTEMPTS;
    this.comments = createMetaCommentsCapability({
      network: 'Instagram',
      error: (message) => new InstagramAdapterError(message),
      graph: this.#graph,
      ownerIdSecret: instagramUserIdSecret,
      accessTokenSecret: instagramAccessTokenSecret,
      refreshToken: (auth, ctx) => this.#refreshToken(auth, ctx),
      postsPath: (ownerId, pageLimit) => `/${ownerId}/media?fields=id,timestamp&limit=${pageLimit}`,
      commentsPath: (postId, since, pageLimit) =>
        `/${postId}/comments?fields=id,text,username,timestamp,from&limit=${pageLimit}${unixSinceQuery(since)}`,
      replyPath: (commentId) => `/${commentId}/replies`,
      mapPost: instagramPostRef,
      mapComment: instagramComment,
      maxPages: commentsMaxPages,
    });
  }

  render(post: Post, settings: unknown): SendOperation[] {
    return renderInstagram(post, settings);
  }

  renderShow(show: Show, context: ShowRenderContext): SendOperation[] {
    return renderInstagramShow(show, context);
  }

  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    parseInstagramChannelSettings(ctx.settings);
    const userId = await ctx.secrets.resolve(instagramUserIdSecret);
    if (userId.length === 0) {
      throw new InstagramAdapterError(
        `secret "${instagramUserIdSecret}" resolved to an empty user id`,
      );
    }
    const token = await ctx.secrets.resolve(instagramAccessTokenSecret);
    if (token.length === 0) {
      throw new InstagramAdapterError(
        `secret "${instagramAccessTokenSecret}" resolved to an empty access token`,
      );
    }
    const auth: MetaAuthState = { token };

    const start = progress?.startAt ?? 0;
    const known = progress?.knownIds ?? [];
    // Ledger invariant: knownIds is the exact delivered prefix.
    if (!Number.isInteger(start) || start < 0 || start > ops.length || known.length !== start) {
      throw new InstagramAdapterError(
        `invalid progress: startAt ${start} with ${known.length} known ids for ${ops.length} ops`,
      );
    }

    const ids: RemoteId[] = [...known];
    const session: MetaDeliverSession = this.#graph.newSession();
    try {
      // Check every remaining op AND build its photo URLs before creating any
      // container, so a bad op fails the deliver without orphan containers;
      // the validated pairs are reused for sending (each op is checked once).
      const pending: Array<{ op: MediaGroupOp; urls: string[] }> = [];
      for (let index = start; index < ops.length; index++) {
        const op = ops[index]!;
        this.#assertOp(op);
        pending.push({ op, urls: metaPhotoUrls('Instagram', op, ctx) });
      }

      for (const [i, { op, urls }] of pending.entries()) {
        const remoteId = await this.#sendWithRetry(op, urls, userId, auth, ctx, session);
        ids.push(remoteId);
        // Awaited BEFORE the next send, so the caller persists the ledger
        // between ops and the at-least-once window is a single op.
        await progress?.onDelivered(start + i, remoteId);
      }
    } catch (error) {
      // Transport failures surface under this adapter's public error class;
      // validation and persistence errors pass through unchanged.
      if (error instanceof MetaGraphError) throw new InstagramAdapterError(error.message);
      throw error;
    }
    return ids;
  }

  #assertOp(op: SendOperation): asserts op is MediaGroupOp {
    if (op.kind !== 'mediaGroup') {
      throw new InstagramAdapterError(`Instagram supports only mediaGroup ops, got "${op.kind}"`);
    }
    if (op.replyToOp !== undefined) {
      throw new InstagramAdapterError('replyToOp is not supported by Instagram');
    }
    if (op.photoIndexes.length === 0) {
      throw new InstagramAdapterError('mediaGroup op has no photos to send');
    }
    if (op.photoIndexes.length > 10) {
      throw new InstagramAdapterError('mediaGroup op has more than 10 photos to send');
    }
  }

  /**
   * One op, with every Graph API call retried AT THE CALL LEVEL: a 429 (or
   * the first expired-token 190) on one call re-sends only that call, so a
   * carousel hit late keeps the child containers it already created instead
   * of recreating the whole op (PR #94 review note). Deliberately ONLY 429
   * and the first 190 are retried: a network error after Meta accepted a
   * container is NOT retried (the ledger-driven re-run covers it; orphan
   * containers expire unused).
   */
  async #sendWithRetry(
    op: MediaGroupOp,
    urls: string[],
    userId: string,
    auth: MetaAuthState,
    ctx: DeliverContext,
    session: MetaDeliverSession,
  ): Promise<RemoteId> {
    const call: MetaCallRetry = this.#graph.opRetry(auth, session, () =>
      this.#refreshToken(auth, ctx),
    );

    let containerId: string;
    if (urls.length === 1) {
      containerId = await call(() =>
        this.#createContainer(userId, auth, {
          image_url: urls[0]!,
          ...(op.caption !== undefined && { caption: op.caption }),
        }),
      );
    } else {
      const children: string[] = [];
      for (const imageUrl of urls) {
        children.push(
          await call(() =>
            this.#createContainer(userId, auth, { image_url: imageUrl, is_carousel_item: true }),
          ),
        );
      }
      containerId = await call(() =>
        this.#createContainer(userId, auth, {
          // Meta's docs describe a comma-separated string; the JSON array is
          // what the pre-live mocks exercise. Verify on the first live
          // carousel and switch to `children.join(',')` if Meta rejects it
          // (PR #94 review note; docs/instagram-runbook.md).
          children,
          ...(op.caption !== undefined && { caption: op.caption }),
        }),
      );
    }
    await this.#awaitContainer(auth, containerId, call);
    const published = (await call(() =>
      this.#graph.call(auth, 'POST', `/${userId}/media_publish`, {
        creation_id: containerId,
      }),
    )) as { id?: unknown };
    if (typeof published.id !== 'string' || !published.id) {
      throw new InstagramAdapterError('Instagram media_publish returned a malformed result');
    }
    return published.id;
  }

  async #createContainer(
    userId: string,
    auth: MetaAuthState,
    params: Record<string, unknown>,
  ): Promise<string> {
    const result = (await this.#graph.call(auth, 'POST', `/${userId}/media`, params)) as {
      id?: unknown;
    };
    if (typeof result.id !== 'string' || !result.id) {
      throw new InstagramAdapterError(
        'Instagram media container creation returned a malformed result',
      );
    }
    return result.id;
  }

  /**
   * Instagram processes a container asynchronously; media_publish requires
   * status FINISHED. EXPIRED/ERROR fail the op; anything else polls until
   * `statusPollMaxAttempts`. Each status poll is retried like any call.
   */
  async #awaitContainer(
    auth: MetaAuthState,
    containerId: string,
    call: MetaCallRetry,
  ): Promise<void> {
    for (let poll = 0; ; poll++) {
      const result = (await call(() =>
        this.#graph.call(auth, 'GET', `/${containerId}?fields=status_code`),
      )) as { status_code?: unknown };
      const status = result.status_code;
      if (status === 'FINISHED') return;
      if (status === 'EXPIRED' || status === 'ERROR') {
        throw new InstagramAdapterError(`Instagram media container ${status.toLowerCase()}`);
      }
      if (poll + 1 >= this.#statusPollMaxAttempts) {
        throw new InstagramAdapterError(
          `Instagram media container did not finish after ${this.#statusPollMaxAttempts} status polls`,
        );
      }
      await this.#sleep(this.#statusPollIntervalMs);
    }
  }

  /**
   * One token exchange attempt. fb_exchange_token refuses an already-expired
   * token, so this is a mid-deliver last resort, not the rotation path — the
   * operator refreshes the stored token before expiry (docs/instagram-runbook.md).
   * Takes only the secret resolver: the comments capability passes its lighter
   * context through the same path.
   */
  async #refreshToken(auth: MetaAuthState, ctx: Pick<DeliverContext, 'secrets'>): Promise<string> {
    const appId = await ctx.secrets.resolve(metaAppIdSecret);
    const appSecret = await ctx.secrets.resolve(metaAppSecretSecret);
    if (!appId || !appSecret) {
      throw new InstagramAdapterError(
        'Instagram token expired and META_APP_ID/META_APP_SECRET are not configured',
      );
    }
    try {
      return await exchangeLongLivedToken({
        appId,
        appSecret,
        accessToken: auth.token,
        fetchImpl: this.#graphOptions.fetchImpl,
        apiBase: this.#graphOptions.apiBase,
      });
    } catch (cause) {
      throw new InstagramAdapterError(
        `Instagram token refresh failed: ${(cause as Error).message}`,
      );
    }
  }
}

export function createInstagramAdapter(options: InstagramAdapterOptions = {}): InstagramAdapter {
  return new InstagramAdapter(options);
}

/**
 * Comments-capability mappers for the Instagram edges (T49b). Field-level
 * gaps degrade to empty strings (a comment is still answerable); an entry
 * without an id is skipped, never invented. Handles/text stay reader data:
 * they flow into results, never into errors or logs.
 */
function instagramPostRef(raw: Record<string, unknown>): ChannelPostRef | undefined {
  if (typeof raw.id !== 'string' || !raw.id) return undefined;
  return {
    id: raw.id,
    createdAt: typeof raw.timestamp === 'string' ? raw.timestamp : undefined,
  };
}

function instagramComment(
  raw: Record<string, unknown>,
  ownerId: string,
  excludeOwner = false,
): ChannelComment | undefined {
  const from = raw.from as { id?: unknown } | undefined;
  if (excludeOwner && from?.id === ownerId) return undefined;
  if (typeof raw.id !== 'string' || !raw.id) return undefined;
  return {
    id: raw.id,
    handle: typeof raw.username === 'string' ? raw.username : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    createdAt: typeof raw.timestamp === 'string' ? raw.timestamp : '',
  };
}
