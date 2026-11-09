import type {
  ChannelAdapter,
  DeliverContext,
  DeliverProgress,
  Post,
  RemoteId,
  SendOperation,
  Show,
  ShowRenderContext,
} from '@handmake/core';

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
  facebookCapabilities,
  parseFacebookChannelSettings,
  renderFacebook,
  renderFacebookShow,
} from './render';

export type FacebookAdapterOptions = MetaGraphOptions;

/** Secret names the adapter resolves through `DeliverContext.secrets`. */
export const facebookPageIdSecret = 'FACEBOOK_PAGE_ID';
export const facebookPageAccessTokenSecret = 'FACEBOOK_PAGE_ACCESS_TOKEN';
// metaAppIdSecret/metaAppSecretSecret (META_APP_ID/META_APP_SECRET) feed
// `exchangeLongLivedToken` for the once-per-deliver expired-token retry;
// they live in ../meta/token and are re-exported by the package index.

export class FacebookAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacebookAdapterError';
  }
}

type MediaGroupOp = Extract<SendOperation, { kind: 'mediaGroup' }>;

/**
 * Facebook Page ChannelAdapter (T26b, F33): `render` delegates to
 * renderFacebook; `deliver` talks to the Pages API — one photo goes out as
 * a single published photo post, 2-10 photos as unpublished uploads plus
 * one feed post attaching them (`attached_media`). Only `mediaGroup` ops
 * are deliverable; video is a later task.
 *
 * Like Instagram, Facebook has no native idempotency keys for posts, so
 * the ledger-driven resume (`progress.startAt` / `progress.knownIds`,
 * persisted by the caller between ops via `onDelivered`) IS the
 * idempotency mechanism: a remote id is recorded only after the feed post
 * (or the single photo post) was accepted, and a re-run resumes after the
 * recorded prefix. A failure mid-op leaves unpublished photo uploads
 * behind; they are never published on their own and expire unused, like
 * orphaned Instagram containers.
 *
 * Meta pulls the photos from public URLs (`DeliverContext.photoUrls`,
 * aligned with `photoIndexes`), so no bytes are uploaded here; the
 * publisher builds raw-GitHub URLs and (opted-in) pushes before delivery
 * so the URLs resolve when Meta fetches them. Secrets are resolved by the
 * fixed names FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN (the
 * non-expiring Page token, H8); on an expired-token error (code 190) the
 * adapter exchanges the token via the shared `exchangeLongLivedToken`
 * (META_APP_ID / META_APP_SECRET) at most once per deliver and retries
 * the failed call — a last resort only, since fb_exchange_token refuses
 * an already-expired token; the reliable rotation is external (operator
 * runbook: docs/facebook-runbook.md). Tokens never appear in logs or
 * error messages: the request URL carries the access_token, so errors
 * name the endpoint only.
 *
 * Transport behaviour (auth, per-call 429 retry, the once-per-deliver
 * 190 refresh, error mapping, the no-token-logging rule) lives in the
 * shared `MetaGraphClient` (T26b); this class keeps the Facebook
 * endpoints and payload shapes.
 */
export class FacebookAdapter implements ChannelAdapter {
  readonly key = 'facebook';
  readonly capabilities = facebookCapabilities;

  readonly #graph: MetaGraphClient;
  readonly #graphOptions: MetaGraphOptions;

  constructor(graphOptions: FacebookAdapterOptions = {}) {
    this.#graph = new MetaGraphClient('Facebook', graphOptions);
    this.#graphOptions = graphOptions;
  }

  render(post: Post, settings: unknown): SendOperation[] {
    return renderFacebook(post, settings);
  }

  renderShow(show: Show, context: ShowRenderContext): SendOperation[] {
    return renderFacebookShow(show, context);
  }

  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    parseFacebookChannelSettings(ctx.settings);
    const pageId = await ctx.secrets.resolve(facebookPageIdSecret);
    if (pageId.length === 0) {
      throw new FacebookAdapterError(
        `secret "${facebookPageIdSecret}" resolved to an empty page id`,
      );
    }
    const token = await ctx.secrets.resolve(facebookPageAccessTokenSecret);
    if (token.length === 0) {
      throw new FacebookAdapterError(
        `secret "${facebookPageAccessTokenSecret}" resolved to an empty access token`,
      );
    }
    const auth: MetaAuthState = { token };

    const start = progress?.startAt ?? 0;
    const known = progress?.knownIds ?? [];
    // Ledger invariant: knownIds is the exact delivered prefix.
    if (!Number.isInteger(start) || start < 0 || start > ops.length || known.length !== start) {
      throw new FacebookAdapterError(
        `invalid progress: startAt ${start} with ${known.length} known ids for ${ops.length} ops`,
      );
    }

    const ids: RemoteId[] = [...known];
    const session: MetaDeliverSession = this.#graph.newSession();
    try {
      // Check every remaining op AND build its photo URLs before creating
      // anything at the network, so a bad op fails the deliver without
      // orphan unpublished photos; the validated pairs are reused for
      // sending (each op is checked once).
      const pending: Array<{ op: MediaGroupOp; urls: string[] }> = [];
      for (let index = start; index < ops.length; index++) {
        const op = ops[index]!;
        this.#assertOp(op);
        pending.push({ op, urls: metaPhotoUrls('Facebook', op, ctx) });
      }

      for (const [i, { op, urls }] of pending.entries()) {
        const remoteId = await this.#sendWithRetry(op, urls, pageId, auth, ctx, session);
        ids.push(remoteId);
        // Awaited BEFORE the next send, so the caller persists the ledger
        // between ops and the at-least-once window is a single op.
        await progress?.onDelivered(start + i, remoteId);
      }
    } catch (error) {
      // Transport failures surface under this adapter's public error class;
      // validation and persistence errors pass through unchanged.
      if (error instanceof MetaGraphError) throw new FacebookAdapterError(error.message);
      throw error;
    }
    return ids;
  }

  #assertOp(op: SendOperation): asserts op is MediaGroupOp {
    if (op.kind !== 'mediaGroup') {
      throw new FacebookAdapterError(`Facebook supports only mediaGroup ops, got "${op.kind}"`);
    }
    if (op.replyToOp !== undefined) {
      throw new FacebookAdapterError('replyToOp is not supported by Facebook');
    }
    if (op.photoIndexes.length === 0) {
      throw new FacebookAdapterError('mediaGroup op has no photos to send');
    }
    if (op.photoIndexes.length > this.capabilities.maxPhotos) {
      throw new FacebookAdapterError(
        `mediaGroup op has more than ${this.capabilities.maxPhotos} photos to send`,
      );
    }
  }

  /**
   * One op, with every Graph API call retried AT THE CALL LEVEL (see
   * MetaGraphClient.opRetry): a 429 (or the first expired-token 190) on
   * one call re-sends only that call, so a feed post hit late keeps the
   * unpublished uploads it already created instead of re-uploading them.
   */
  async #sendWithRetry(
    op: MediaGroupOp,
    urls: string[],
    pageId: string,
    auth: MetaAuthState,
    ctx: DeliverContext,
    session: MetaDeliverSession,
  ): Promise<RemoteId> {
    const call: MetaCallRetry = this.#graph.opRetry(auth, session, () =>
      this.#refreshToken(auth, ctx),
    );

    if (urls.length === 1) {
      const published = (await call(() =>
        this.#createPhoto(pageId, auth, {
          url: urls[0]!,
          ...(op.caption !== undefined && { caption: op.caption }),
        }),
      )) as { id?: unknown };
      if (typeof published.id !== 'string' || !published.id) {
        throw new FacebookAdapterError('Facebook photo post returned a malformed result');
      }
      return published.id;
    }

    // Multi-photo: upload every photo unpublished, then attach the ids to
    // one feed post (the Pages API has no carousel container like
    // Instagram; attached_media is the documented flow).
    const attached: Array<{ media_fbid: string }> = [];
    for (const url of urls) {
      const uploaded = (await call(() =>
        this.#createPhoto(pageId, auth, { url, published: false }),
      )) as { id?: unknown };
      if (typeof uploaded.id !== 'string' || !uploaded.id) {
        throw new FacebookAdapterError('Facebook photo upload returned a malformed result');
      }
      attached.push({ media_fbid: uploaded.id });
    }
    const feed = (await call(() =>
      this.#graph.call(auth, 'POST', `/${pageId}/feed`, {
        ...(op.caption !== undefined && { message: op.caption }),
        attached_media: attached,
      }),
    )) as { id?: unknown };
    if (typeof feed.id !== 'string' || !feed.id) {
      throw new FacebookAdapterError('Facebook feed post returned a malformed result');
    }
    return feed.id;
  }

  async #createPhoto(
    pageId: string,
    auth: MetaAuthState,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.#graph.call(auth, 'POST', `/${pageId}/photos`, params);
  }

  /**
   * One token exchange attempt. fb_exchange_token refuses an already-expired
   * token, so this is a mid-deliver last resort, not the rotation path — the
   * operator rotates the stored token before expiry (docs/facebook-runbook.md).
   */
  async #refreshToken(auth: MetaAuthState, ctx: DeliverContext): Promise<string> {
    const appId = await ctx.secrets.resolve(metaAppIdSecret);
    const appSecret = await ctx.secrets.resolve(metaAppSecretSecret);
    if (!appId || !appSecret) {
      throw new FacebookAdapterError(
        'Facebook token expired and META_APP_ID/META_APP_SECRET are not configured',
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
      throw new FacebookAdapterError(`Facebook token refresh failed: ${(cause as Error).message}`);
    }
  }
}

export function createFacebookAdapter(options: FacebookAdapterOptions = {}): FacebookAdapter {
  return new FacebookAdapter(options);
}
