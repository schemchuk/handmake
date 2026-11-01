import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createTelegramAdapter } from '@handmake/channels';
import {
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
  TenantConfig,
  Work,
} from '@handmake/core';
import { GitRepoContentStore, postFolderName } from '@handmake/stores';

import { buildPostFromPayload } from './build-post';
import { createGitCommitter } from './git';
import type { GitCommitter } from './git';
import { fetchAndProcessPhotos } from './photos';
import { createPublishCallbackSender } from './publish-callback';
import type { PublishCallbackSender } from './publish-callback';
import { parseDispatchPayload } from './payload';
import { requiredEnv } from './required-env';
import { loadTenantConfig } from './tenant-config';
import { prepareWorkPublication } from './work-publication';

export interface PublishDeps {
  cwd?: string;
  root?: string;
  env?: NodeJS.ProcessEnv;
  logger?: (line: string) => void;
  now?: Date;
  mediaSource?: MediaSource;
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
  /** Channel projection for works; only ordinary posts are saved under content/posts. */
  post: Post;
  work?: Work;
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

function defaultRegistry(
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
  const publication =
    payload.kind === 'work' ? await prepareWorkPublication(payload, tenant, store) : undefined;
  const post = publication?.post ?? buildPostFromPayload(payload, tenant, { now });
  const photos = await fetchAndProcessPhotos(payload.fileIds, deps.mediaSource, env);
  if (publication) {
    if (publication.collection) await store.saveCollection(publication.collection);
    await store.saveWork(publication.work, photos);
  } else {
    // Re-running on another day reuses the original post folder.
    const existing = await store.readPost(post.tenant, post.id);
    if (existing) post.date = existing.date;
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
  const notifier: Notifier =
    deps.notifier ??
    ({ notify: async (target, message) => log(`notify ${target}: ${message}`) } satisfies Notifier);
  // An alert must never change the publish outcome.
  const notify = async (target: NotifyTarget, message: string): Promise<void> => {
    try {
      await notifier.notify(target, message);
    } catch (error) {
      log(`notify ${target} failed: ${safeErrorMessage(error)}`);
    }
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

  for (const channel of post.channels) {
    const entry = ledger.channels[channel];
    if (entry?.status === 'done') {
      skipped.push(channel);
      log(`channel ${channel}: already done, skipping`);
      continue;
    }
    const adapter = registry.get(channel);
    const settings = (tenant.channels as Record<string, unknown>)[channel];
    const ops = adapter.render(post, settings);
    const startAt = nextOpIndex(ledger, channel);
    log(`channel ${channel}: ${ops.length} op(s), resuming at op ${startAt}`);
    try {
      await adapter.deliver(
        ops,
        {
          secrets,
          idempotencyBase: idempotencyBase(post.tenant, post.id, channel),
          settings,
          // DeliverContext wants the processed bytes, aligned with post.photos.
          photos: photos.map((photo) => photo.data),
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
      ledger = markDone(ledger, channel, now);
      delivered[channel] = ledger.channels[channel]!.remoteIds;
      log(`channel ${channel}: delivered ${delivered[channel]!.length} remote id(s)`);
    } catch (error) {
      const message = safeErrorMessage(error);
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

  await notify(
    'author',
    publication && !post.channels.length
      ? `published work ${post.id}`
      : `published ${post.id} to ${Object.keys(delivered).join(', ')}`,
  );

  // T19: report the delivery to the bot so it moves the draft out of
  // `publishing` and indexes the post. The bot's endpoint is idempotent, so
  // re-runs of this pipeline re-notify harmlessly. Only a fully delivered
  // run reports success — any channel failure has already thrown above.
  const callbackUrl = env['PUBLISH_CALLBACK_URL'];
  const callbackSecret = env['PUBLISH_CALLBACK_SECRET'];
  const ledgerEntries = Object.entries(ledger.channels);
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
      ledgerEntries.map(([channel]) => [channel, 'done' as const]),
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
        ...(publication ? { kind: 'work' as const } : {}),
        tenantId: post.tenant,
        postId: post.id,
        date: post.date,
        photos: post.photos,
        channels,
      });
      log(`published callback sent for ${post.id}`);
    } catch (error) {
      // A lost callback must never fail an already-published post; the
      // operator re-fires it by re-running the publish workflow (runbook).
      await notify(
        'operator',
        `publish callback for ${post.tenant}/${post.id} failed: ${safeErrorMessage(error)}`,
      );
    }
  }
  return { post, ...(publication ? { work: publication.work } : {}), ledger, delivered, skipped };
}
