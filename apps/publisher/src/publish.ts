import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createFacebookAdapter,
  createInstagramAdapter,
  createTelegramAdapter,
  createThreadsAdapter,
} from '@handmake/channels';
import {
  anonymousEditPlanSchema,
  resolveEditPlan,
  postEntryReferences,
  resolvePostEntryNames,
  entryNamesAllowed,
  postPollLanguage,
  canonicalLinkSettings,
  ChannelRegistry,
  idempotencyBase,
  initLedger,
  isUlid,
  markDone,
  markFailed,
  markOpDelivered,
  nextOpIndex,
} from '@handmake/core';
import type {
  MediaSource,
  Notifier,
  NotifyTarget,
  Post,
  PublishLedger,
  SecretResolver,
  SendOperation,
  TenantConfig,
  Work,
  Show,
  ShowMediaSource,
} from '@handmake/core';
import { GitRepoContentStore, postFolderName } from '@handmake/stores';

import { fetchEntryNames } from './entry-names';
import { buildPostFromPayload } from './build-post';
import { createGitCommitter } from './git';
import type { GitCommitter } from './git';
import { prepareMetaPhotoDelivery } from './facebook-delivery';
import {
  contentRawBaseUrl,
  contentRawPhotoUrl,
  prepareInstagramDelivery,
} from './instagram-delivery';
import { fetchAndProcessPhotos } from './photos';
import { createPublishCallbackSender } from './publish-callback';
import type { PublishCallbackSender } from './publish-callback';
import { parseDispatchPayload } from './payload';
import { requiredEnv } from './required-env';
import { loadTenantConfig } from './tenant-config';
import { prepareWorkPublication } from './work-publication';
import { prepareWorkVideo, deliverWorkVideo, MissingWorkVideoError } from './work-video';
import { prepareShowPublication } from './show-publication';
import { createPublicationMediaSource } from './show-media-source';

export interface PublishDeps {
  cwd?: string;
  root?: string;
  env?: NodeJS.ProcessEnv;
  logger?: (line: string) => void;
  now?: Date;
  mediaSource?: MediaSource;
  showMediaSource?: ShowMediaSource;
  /** Default: one adapter per enabled tenant channel (telegram now). */
  registry?: ChannelRegistry;
  /** Default: resolves secret names from the environment. */
  secrets?: SecretResolver;
  /** Default: logs "notify <target>: <message>" lines. */
  notifier?: Notifier;
  /** Default: commits under root as the publisher identity. */
  git?: GitCommitter;
  /** Default: one created from PUBLISH_CALLBACK_URL/SECRET in env. */
  callback?: PublishCallbackSender;
  /** Default: global fetch; injectable in tests. */
  fetchImpl?: typeof fetch;
}

export interface PublishResult {
  /** Transient projection for works/shows; only ordinary posts are saved under content/posts. */
  post: Post;
  work?: Work;
  show?: Show;
  ledger: PublishLedger;
  delivered: Record<string, (number | string)[]>;
  skipped: string[];
}

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

export function defaultRegistry(
  tenant: TenantConfig,
  env: NodeJS.ProcessEnv,
  channels = Object.keys(tenant.channels),
): ChannelRegistry {
  const registry = new ChannelRegistry();
  for (const key of channels) {
    if (key === 'telegram') {
      // A missing token surfaces as a delivery failure, so the ledger
      // records the failed channel instead of the run dying early.
      registry.register(createTelegramAdapter({ token: env['TELEGRAM_BOT_TOKEN'] ?? '' }));
    } else if (key === 'instagram') {
      // Secrets resolve per delivery through the context by fixed name;
      // Meta pulls the photos from the public URLs the publisher prepares
      // (T26a3) — nothing to wire here.
      registry.register(createInstagramAdapter());
    } else if (key === 'threads') {
      registry.register(createThreadsAdapter());
    } else if (key === 'facebook') {
      // Same Meta Graph pattern as Instagram (T26b): fixed-name secrets,
      // publisher-prepared public photo URLs — nothing to wire here.
      registry.register(createFacebookAdapter());
    } else {
      throw new PublishError(
        `tenant "${tenant.id}" enables channel "${key}" but no adapter is registered for it`,
      );
    }
  }
  return registry;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publish (T10): payload -> post -> content store (git commit) -> deliver
 * every pending channel through the registry, updating the ledger after
 * each channel (git commit). Re-running with the same payload resumes from
 * the ledger: done channels are skipped, failed ones redeliver only the
 * missing operations.
 */
export async function runPublish(
  payloadPath: string,
  deps: PublishDeps = {},
): Promise<PublishResult> {
  const cwd = deps.cwd ?? process.cwd();
  const root = deps.root ?? cwd;
  const env = deps.env ?? process.env;
  const log = deps.logger ?? console.log;
  const now = deps.now ?? new Date();

  const payload = parseDispatchPayload(await readFile(path.resolve(cwd, payloadPath), 'utf8'));
  if (!isUlid(payload.draftId)) {
    // The post id IS the idempotency key; a re-run must find the same post.
    throw new PublishError(
      `draftId "${payload.draftId}" is not a ULID; refusing to publish without a stable id`,
    );
  }
  const tenant = await loadTenantConfig(payload.tenantId, root);

  const store = new GitRepoContentStore({ rootDir: root });
  const workPublication =
    payload.kind === 'work'
      ? await prepareWorkPublication(payload, tenant, store, env.SITE_EXCLUDE_POST === 'true')
      : undefined;
  let showPublication;
  try {
    showPublication =
      payload.kind === 'show'
        ? await prepareShowPublication(
            payload,
            tenant,
            store,
            deps.showMediaSource ??
              createPublicationMediaSource(tenant.id, payload.draftId, env, deps.fetchImpl),
            env.SITE_EXCLUDE_POST === 'true',
          )
        : undefined;
  } catch (error) {
    await deps.notifier
      ?.notify('author', `Не вдалося опублікувати показ: ${safeErrorMessage(error)}`)
      .catch(() => undefined);
    throw error;
  }
  const publication = workPublication ?? showPublication;
  const post = publication?.post ?? buildPostFromPayload(payload, tenant, { now });
  const entryIds = postEntryReferences(post);
  const entryNames = await fetchEntryNames(post.tenant, entryIds, {
    env,
    logger: log,
    fetchImpl: deps.fetchImpl,
    now,
  });
  const errorMessage = (error: unknown) =>
    entryIds.length ? 'Contest publication failed' : safeErrorMessage(error);
  const notifier: Notifier =
    deps.notifier ??
    ({ notify: async (target, message) => log(`notify ${target}: ${message}`) } satisfies Notifier);
  // An alert must never change the publish outcome.
  const notify = async (target: NotifyTarget, message: string): Promise<void> => {
    try {
      await notifier.notify(target, message);
    } catch (error) {
      log(`notify ${target} failed: ${errorMessage(error)}`);
    }
  };

  let workVideo: Uint8Array | undefined;
  try {
    workVideo = workPublication
      ? await prepareWorkVideo(
          workPublication.work,
          payload.work?.videoFileId,
          store,
          deps.showMediaSource,
          env,
        )
      : undefined;
  } catch (error) {
    await notify(
      'author',
      error instanceof MissingWorkVideoError
        ? 'Не вдалося знайти відео для повторної публікації.'
        : 'Не вдалося підготувати відео. Надішліть справне MP4/MOV до 60 секунд і 20 MB.',
    );
    throw error;
  }
  const photos = await fetchAndProcessPhotos(payload.fileIds, deps.mediaSource, env);
  if (showPublication) {
    await store.saveShow(showPublication.show, showPublication.media);
  } else if (workPublication) {
    if (workPublication.collection) await store.saveCollection(workPublication.collection);
    await store.saveWork(workPublication.work, photos, workVideo);
  } else {
    // Re-running on another day reuses the original post folder.
    const existing = await store.readPost(post.tenant, post.id);
    if (existing) post.date = existing.date;
    if (env.SITE_EXCLUDE_POST === 'true' || existing?.siteExcluded) post.siteExcluded = true;
    await store.savePost(post, photos);
  }
  const git = deps.git ?? createGitCommitter({ repoDir: root, env });
  const paths = publication?.paths ?? [path.join('content', 'posts', postFolderName(post))];
  const committedPost = await git.commit(paths, `content: add ${payload.kind} ${post.id}`);
  log(committedPost ? `committed ${paths.join(', ')}` : 'content unchanged (already committed)');

  const registry = deps.registry ?? defaultRegistry(tenant, env, post.channels);
  const secrets: SecretResolver = deps.secrets ?? {
    resolve: async (name) => requiredEnv(name, env),
  };
  const previousLedger = await store.readLedger(post.tenant, post.id);
  let ledger = previousLedger ?? initLedger(post.tenant, post.id, post.channels, now);
  const delivered: Record<string, (number | string)[]> = {};
  const skipped: string[] = [];

  const persistLedger = async (): Promise<void> => {
    await store.writeLedger(ledger);
    await git.commit(
      [path.join('content', 'ledger', `${post.id}.json`)],
      `content: update ledger ${post.id}`,
    );
  };

  // Persist even an empty ledger: site-only work completion is also retryable.
  if (publication && !previousLedger) await persistLedger();

  const photoBytes = photos.map((photo) => photo.data);
  // T26a3: repo-relative photo directory behind post.photos (works store
  // photos in a photos/ subdir), used for the public raw-GitHub URLs
  // Instagram pulls carousel copies from. Show publications carry no
  // channels — the copy runner prepares their URLs per show.
  const photoRepoDir = workPublication
    ? path.join('content', 'works', workPublication.work.id, 'photos')
    : path.join('content', 'posts', postFolderName(post));

  // One content push per run covers every Meta channel (the tenant order
  // puts Instagram before Facebook): the first opted-in preparation pushes,
  // later ones skip the no-op second push (PR #96 review note 4).
  let contentPushed = false;
  const channelOperations = new Map<string, SendOperation[]>();
  for (const channel of post.channels) {
    let entry = ledger.channels[channel];
    const adapter = registry.get(channel);
    let settings = (tenant.channels as Record<string, unknown>)[channel];
    // T40: the canonical footer rides the render settings; delivery keeps the
    // raw tenant section (adapters read channelId only).
    const canonical = canonicalLinkSettings(tenant, payload.kind === 'work' ? 'works' : 'posts');
    let ops: SendOperation[];
    try {
      const renderSettings = canonical
        ? { ...(settings as Record<string, unknown>), canonical }
        : settings;
      // Freeze anonymous layout before the first send. Never retrofit a legacy partial run:
      // its original operation mapping cannot be reconstructed safely.
      if (
        !entry?.editPlan &&
        !entry?.remoteIds.length &&
        entry?.status !== 'done' &&
        adapter.editMessage &&
        entryIds.length &&
        (post.type === 'wotw-poll' || post.type === 'wotw-result')
      ) {
        const editPlan = anonymousEditPlanSchema.parse({
          version: 1,
          type: post.type,
          entryRefs: entryIds,
          allowNames: entryNamesAllowed(tenant, channel),
          pollLanguage: postPollLanguage(post),
          settings: renderSettings,
          operations: adapter.render(post, renderSettings),
        });
        ledger = {
          ...ledger,
          channels: {
            ...ledger.channels,
            [channel]: {
              status: 'pending',
              remoteIds: [],
              updatedAt: now.toISOString(),
              editPlan,
            },
          },
        };
        await persistLedger();
        entry = ledger.channels[channel];
      }
      if (entry?.editPlan) {
        settings = entry.editPlan.settings;
        ops = resolveEditPlan(entry.editPlan, entryNames);
        // Name expansion may exceed the fixed layout; never silently reshape delivered IDs.
        for (const op of ops) {
          if (
            (op.kind === 'message' && op.text.length > adapter.capabilities.messageLimit) ||
            (op.kind === 'mediaGroup' &&
              (op.caption?.length ?? 0) > adapter.capabilities.captionLimit) ||
            (op.kind === 'poll' &&
              (op.question.length > adapter.capabilities.pollQuestionLimit ||
                op.options.some((value) => value.length > adapter.capabilities.pollOptionLimit)))
          ) {
            throw new Error('Contest publication exceeds fixed layout limits');
          }
        }
      } else {
        ops = adapter.render(
          resolvePostEntryNames(post, entryNames, entryNamesAllowed(tenant, channel)),
          renderSettings,
        );
      }
    } catch (error) {
      throw new Error(errorMessage(error));
    }
    if (channel === 'threads' && workVideo) {
      ops = ops.map((op) => (op.kind === 'mediaGroup' ? { ...op, includeVideo: true } : op));
    }
    channelOperations.set(channel, ops);
    if (entry?.status === 'done') {
      skipped.push(channel);
      log(`channel ${channel}: already done, skipping`);
      continue;
    }
    const startAt = nextOpIndex(ledger, channel);
    log(`channel ${channel}: ${ops.length} op(s), resuming at op ${startAt}`);
    try {
      let photoUrls: string[] | undefined;
      let videoUrl: string | undefined;
      if (channel === 'instagram') {
        // Frame the 4:5 carousel copies, commit them and (when the workflow
        // opted in and no earlier channel pushed) push, all before Meta
        // fetches the URLs; a failure here lands in the catch below and
        // never blocks earlier channels.
        const prepared = await prepareInstagramDelivery({
          root,
          env,
          git,
          repoDir: photoRepoDir,
          fileNames: post.photos,
          photoBytes,
          ops,
          startAt,
          itemId: post.id,
          contentAlreadyPushed: contentPushed,
          logger: log,
        });
        contentPushed = contentPushed || prepared.pushed;
        photoUrls = prepared.photoUrls;
      } else if (channel === 'facebook' || channel === 'threads') {
        // Meta fetches the item's own committed photos by raw-GitHub URL;
        // the opted-in push (skipped when Instagram already pushed) makes
        // fresh URLs resolve. A failure here lands in the catch below and
        // never blocks earlier channels.
        const prepared = await prepareMetaPhotoDelivery({
          network: channel === 'threads' ? 'Threads' : 'Facebook',
          env,
          git,
          repoDir: photoRepoDir,
          fileNames: post.photos,
          ops,
          startAt,
          contentAlreadyPushed: contentPushed,
          logger: log,
        });
        contentPushed = contentPushed || prepared.pushed;
        photoUrls = prepared.photoUrls;
        if (channel === 'threads' && workVideo && workPublication?.work.video) {
          videoUrl = contentRawPhotoUrl(
            contentRawBaseUrl(env)!,
            path.join('content', 'works', workPublication.work.id),
            workPublication.work.video.fileName,
          );
        }
      }
      await adapter.deliver(
        ops,
        {
          secrets,
          idempotencyBase: idempotencyBase(post.tenant, post.id, channel),
          settings,
          // DeliverContext wants the processed bytes, aligned with post.photos.
          photos: photoBytes,
          ...(photoUrls !== undefined && { photoUrls }),
          ...(videoUrl !== undefined && { videoUrl }),
        },
        {
          startAt,
          knownIds: entry?.remoteIds ?? [],
          onDelivered: async (opIndex, remoteId) => {
            ledger = markOpDelivered(ledger, channel, opIndex, remoteId, now);
            // Write the file after every op so a kill mid-channel cannot lose
            // delivered ops; the git commit stays per channel.
            await store.writeLedger(ledger);
          },
        },
      );
      ledger = markDone(ledger, channel, deps.now ?? new Date());
      delivered[channel] = ledger.channels[channel]!.remoteIds;
      log(`channel ${channel}: delivered ${delivered[channel]!.length} remote id(s)`);
    } catch (error) {
      const message = errorMessage(error);
      ledger = markFailed(ledger, channel, message, now);
      await persistLedger();
      await notify(
        'operator',
        `publish failed for ${post.tenant}/${post.id} on ${channel}: ${message}`,
      );
      throw new PublishError(`channel "${channel}" delivery failed: ${message}`);
    }
    await persistLedger();
  }

  if (workPublication && workVideo) {
    for (const channel of post.channels.filter(
      (key) => key === 'telegram' || key === 'instagram' || key === 'facebook',
    )) {
      try {
        await deliverWorkVideo(
          workPublication.work,
          workVideo,
          ledger,
          registry.get(channel),
          {
            secrets,
            settings: tenant.channels[channel],
            photos: photoBytes,
            idempotencyBase: '',
          },
          store,
          async (videoLedger) => {
            await store.writeLedger(videoLedger);
            await git.commit(
              [path.join('content', 'ledger', `${videoLedger.postId}.json`)],
              `content: update ledger ${videoLedger.postId}`,
            );
          },
          now,
          channelOperations.get(channel)?.find((op) => op.kind === 'mediaGroup')?.caption,
        );
      } catch (error) {
        await notify('author', safeErrorMessage(error));
        throw error;
      }
    }
  }

  await notify(
    'author',
    publication && !post.channels.length
      ? `${payload.kind === 'work' ? 'Роботу' : 'Показ'} опубліковано.`
      : `Опубліковано. Канали: ${Object.keys(delivered).join(', ')}.`,
  );

  // T19: report the delivery to the bot so it moves the draft out of
  // `publishing` and indexes the post. The bot's endpoint is idempotent, so
  // re-runs of this pipeline re-notify harmlessly. Only a fully delivered
  // run reports success — any channel failure has already thrown above.
  const callbackUrl = env['PUBLISH_CALLBACK_URL'];
  const callbackSecret = env['PUBLISH_CALLBACK_SECRET'];
  // Site publication is complete independently of later copy delivery.
  const ledgerEntries = showPublication ? [] : Object.entries(ledger.channels);
  if (callbackUrl && !callbackSecret) {
    log('PUBLISH_CALLBACK_SECRET missing; published callback not sent');
    await notify(
      'operator',
      `publish callback for ${post.tenant}/${post.id} not sent: PUBLISH_CALLBACK_SECRET missing`,
    );
  } else if (callbackUrl && !ledgerEntries.every(([, entry]) => entry.status === 'done')) {
    log('published callback skipped: not every channel is done');
  } else if (callbackUrl) {
    const channels = Object.fromEntries(
      ledgerEntries.map(([channel, entry]) => {
        const ops = channelOperations.get(channel) ?? [];
        const mainIndex = ops.findIndex((op) => op.kind === 'mediaGroup' || op.kind === 'message');
        const pollIndex = ops.findIndex((op) => op.kind === 'poll');
        const main = entry.remoteIds[mainIndex];
        const poll = entry.remoteIds[pollIndex];
        return [
          channel,
          {
            status: 'done' as const,
            completedAt: entry.updatedAt,
            ...(entry.editPlan
              ? {
                  editReceipt: {
                    plan: entry.editPlan,
                    remoteIds: entry.remoteIds,
                    publishedAt: entry.updatedAt,
                  },
                }
              : {}),
            messageIds: {
              ...(main !== undefined ? { main } : {}),
              ...(poll !== undefined ? { poll } : {}),
            },
          },
        ];
      }),
    );
    const sender =
      deps.callback ??
      createPublishCallbackSender({
        url: callbackUrl,
        secret: callbackSecret as string,
        fetchImpl: deps.fetchImpl,
      });
    try {
      await sender.send({
        ...(payload.kind !== 'post' ? { kind: payload.kind } : {}),
        tenantId: post.tenant,
        postId: post.id,
        date: post.date,
        photos: post.photos,
        ...(post.siteExcluded ? { siteExcluded: true } : {}),
        channels,
      });
      log(`published callback sent for ${post.id}`);
    } catch (error) {
      // A lost callback must never fail an already-published post; the
      // operator re-fires it by re-running the publish workflow (runbook).
      await notify(
        'operator',
        `publish callback for ${post.tenant}/${post.id} failed: ${errorMessage(error)}`,
      );
    }
  }
  return {
    post,
    ...(workPublication ? { work: workPublication.work } : {}),
    ...(showPublication ? { show: showPublication.show } : {}),
    ledger,
    delivered,
    skipped,
  };
}
