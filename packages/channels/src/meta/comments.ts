/**
 * Shared Meta comments reader/reply capability (T49b, spec F34). Each Meta
 * network adapter builds one over its shared `MetaGraphClient`: the adapter
 * config owns only endpoint paths and payload-shape mappers; this module
 * owns auth resolution, the bounded paging collector and the retry wiring,
 * mirroring the publishing path exactly (per-call 429 retry, the
 * once-per-run expired-token 190 refresh, transport errors surfaced under
 * the adapter's public error class, never-log-tokens).
 *
 * Reader-data rule: comment text and handles never appear in thrown errors
 * or logs — error messages name endpoints and secret names only. The
 * capability is stateless: watermarks, dedupe and the at-most-once reply
 * guarantee live in the caller (T49c, D1).
 */

import type {
  ChannelComment,
  ChannelCommentsCapability,
  ChannelCommentsContext,
  ChannelPostRef,
  RemoteId,
} from '@handmake/core';

import {
  MetaGraphError,
  type MetaAuthState,
  type MetaCallRetry,
  type MetaGraphClient,
} from './graph';

/** Bound on followed pages per operation when the caller does not override it. */
export const DEFAULT_COMMENTS_MAX_PAGES = 5;
/** Per-page size for comments edges. */
const COMMENTS_PAGE_LIMIT = 50;
/** Per-page size for posts edges never exceeds the Graph API maximum. */
const POSTS_PAGE_LIMIT_CAP = 100;

export interface MetaCommentsConfig {
  /** Network label for error messages, e.g. "Instagram" / "Facebook". */
  network: string;
  /** Builds the adapter's public error; messages must carry no reader data. */
  error: (message: string) => Error;
  /** The adapter's shared Graph client (auth, 429/190 retry, error mapping). */
  graph: MetaGraphClient;
  /** Secret names resolved through `ChannelCommentsContext.secrets`. */
  ownerIdSecret: string;
  accessTokenSecret: string;
  /** Swaps an expired token mid-run (META_APP_ID/META_APP_SECRET exchange). */
  refreshToken: (auth: MetaAuthState, ctx: ChannelCommentsContext) => Promise<string>;
  /** Builds this network's posts-edge path; the argument is the per-page size. */
  postsPath: (ownerId: string, pageLimit: number) => string;
  /** Builds this network's comments-edge path; `since` is the caller's watermark. */
  commentsPath: (postId: string, since: Date | undefined, pageLimit: number) => string;
  /** Builds this network's reply path for one comment. */
  replyPath: (commentId: string) => string;
  /**
   * Maps a posts-edge entry; returning undefined skips it (e.g. a foreign
   * post on a Page feed).
   */
  mapPost: (raw: Record<string, unknown>, ownerId: string) => ChannelPostRef | undefined;
  /**
   * Maps a comments-edge entry; returning undefined skips it (e.g. one of
   * our own replies on a Page post or an unattributable entry).
   */
  mapComment: (raw: Record<string, unknown>, ownerId: string) => ChannelComment | undefined;
  /** Bound on followed pages per operation; default DEFAULT_COMMENTS_MAX_PAGES. */
  maxPages?: number;
}

/**
 * `since` as a Graph API query fragment. The network filter is inclusive,
 * so the caller may see the watermark entry again and must dedupe by id.
 */
export function unixSinceQuery(since: Date | undefined): string {
  if (since === undefined) return '';
  return `&since=${Math.floor(since.getTime() / 1000)}`;
}

export function createMetaCommentsCapability(
  config: MetaCommentsConfig,
): ChannelCommentsCapability {
  return new MetaCommentsCapability(config);
}

class MetaCommentsCapability implements ChannelCommentsCapability {
  readonly #maxPages: number;

  constructor(private readonly config: MetaCommentsConfig) {
    this.#maxPages = config.maxPages ?? DEFAULT_COMMENTS_MAX_PAGES;
  }

  listPosts(limit: number, ctx: ChannelCommentsContext): Promise<ChannelPostRef[]> {
    // MetaGraphError surfaces under the adapter's public error class, like
    // the deliver path; exhausted 429s and the second 190 keep their own
    // error classes, also exactly like deliver.
    return this.#guard(() => this.#listPosts(limit, ctx));
  }

  listComments(
    postId: RemoteId,
    since: Date | undefined,
    ctx: ChannelCommentsContext,
  ): Promise<ChannelComment[]> {
    return this.#guard(() => this.#listComments(postId, since, ctx));
  }

  replyToComment(
    commentId: RemoteId,
    text: string,
    ctx: ChannelCommentsContext,
  ): Promise<RemoteId> {
    return this.#guard(() => this.#replyToComment(commentId, text, ctx));
  }

  async #listPosts(limit: number, ctx: ChannelCommentsContext): Promise<ChannelPostRef[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw this.config.error('comments listPosts limit must be a positive integer');
    }
    const ownerId = await this.#resolveSecret(ctx, this.config.ownerIdSecret);
    const { auth, call } = await this.#authorized(ctx);
    const posts: ChannelPostRef[] = [];
    await this.#collectPages(
      auth,
      call,
      this.config.postsPath(ownerId, Math.min(limit, POSTS_PAGE_LIMIT_CAP)),
      (items) => {
        for (const raw of items) {
          if (posts.length >= limit) return false;
          const mapped = this.config.mapPost(raw, ownerId);
          if (mapped) posts.push(mapped);
        }
        return true;
      },
    );
    return posts;
  }

  async #listComments(
    postId: RemoteId,
    since: Date | undefined,
    ctx: ChannelCommentsContext,
  ): Promise<ChannelComment[]> {
    const id = this.#requireId('post id', postId);
    const ownerId = await this.#resolveSecret(ctx, this.config.ownerIdSecret);
    const { auth, call } = await this.#authorized(ctx);
    const comments: ChannelComment[] = [];
    await this.#collectPages(
      auth,
      call,
      this.config.commentsPath(id, since, COMMENTS_PAGE_LIMIT),
      (items) => {
        for (const raw of items) {
          const mapped = this.config.mapComment(raw, ownerId);
          if (mapped) comments.push(mapped);
        }
        // No total bound: the page count bounds one operation.
        return true;
      },
    );
    return comments;
  }

  async #replyToComment(
    commentId: RemoteId,
    text: string,
    ctx: ChannelCommentsContext,
  ): Promise<RemoteId> {
    const id = this.#requireId('comment id', commentId);
    if (typeof text !== 'string' || text.length === 0) {
      throw this.config.error('comments reply text must be a non-empty string');
    }
    const { auth, call } = await this.#authorized(ctx);
    const result = (await call(() =>
      this.config.graph.call(auth, 'POST', this.config.replyPath(id), { message: text }),
    )) as { id?: unknown };
    if (typeof result.id !== 'string' || !result.id) {
      throw this.config.error(`${this.config.network} comment reply returned a malformed result`);
    }
    return result.id;
  }

  async #guard<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof MetaGraphError) throw this.config.error(error.message);
      throw error;
    }
  }

  async #resolveSecret(ctx: ChannelCommentsContext, name: string): Promise<string> {
    const value = await ctx.secrets.resolve(name);
    if (value.length === 0) {
      throw this.config.error(`${this.config.network} secret "${name}" resolved to an empty value`);
    }
    return value;
  }

  /** Per-operation auth + retry closure, exactly like one delivered op. */
  async #authorized(
    ctx: ChannelCommentsContext,
  ): Promise<{ auth: MetaAuthState; call: MetaCallRetry }> {
    const token = await this.#resolveSecret(ctx, this.config.accessTokenSecret);
    const auth: MetaAuthState = { token };
    const session = this.config.graph.newSession();
    const call: MetaCallRetry = this.config.graph.opRetry(auth, session, () =>
      this.config.refreshToken(auth, ctx),
    );
    return { auth, call };
  }

  #requireId(kind: string, value: RemoteId): string {
    const id = String(value).trim();
    if (id.length === 0) {
      throw this.config.error(`comments ${kind} must be a non-empty value`);
    }
    return id;
  }

  /**
   * Follows Graph API cursor paging for at most `#maxPages` pages; `onPage`
   * returns false to stop early (enough posts collected). Malformed pages
   * fail closed. `paging.next` URLs are followed by path+query only, so the
   * configured apiBase is preserved and no token ever reaches an error
   * message (tokens are not logged at all).
   */
  async #collectPages(
    auth: MetaAuthState,
    call: MetaCallRetry,
    firstPath: string,
    onPage: (items: Record<string, unknown>[]) => boolean,
  ): Promise<void> {
    let path: string | undefined = firstPath;
    for (let page = 0; path !== undefined && page < this.#maxPages; page += 1) {
      const currentPath = path;
      const result = (await call(() => this.config.graph.call(auth, 'GET', currentPath))) as Record<
        string,
        unknown
      >;
      const data = result.data;
      if (!Array.isArray(data)) {
        throw this.config.error(
          `${this.config.network} ${currentPath} returned a malformed result`,
        );
      }
      const items: Record<string, unknown>[] = [];
      for (const entry of data) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          throw this.config.error(
            `${this.config.network} ${currentPath} returned a malformed result`,
          );
        }
        items.push(entry as Record<string, unknown>);
      }
      if (!onPage(items)) return;
      const paging = result.paging;
      const next =
        typeof paging === 'object' && paging !== null
          ? (paging as Record<string, unknown>).next
          : undefined;
      if (next === undefined) {
        path = undefined;
        continue;
      }
      if (typeof next !== 'string') {
        throw this.config.error(
          `${this.config.network} ${currentPath} returned a malformed result`,
        );
      }
      let parsed: URL;
      try {
        parsed = new URL(next);
      } catch {
        throw this.config.error(
          `${this.config.network} ${currentPath} returned a malformed result`,
        );
      }
      path = `${parsed.pathname}${parsed.search}`;
    }
  }
}
