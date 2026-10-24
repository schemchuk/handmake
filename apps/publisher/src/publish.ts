import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createTelegramAdapter } from '@handmake/channels';
import {
  ChannelRegistry,
  idempotencyBase,
  initLedger,
  markDone,
  markFailed,
  markOpDelivered,
  nextOpIndex,
} from '@handmake/core';
import type {
  MediaSource,
  Notifier,
  Post,
  PublishLedger,
  SecretResolver,
  TenantConfig,
} from '@handmake/core';
import { GitRepoContentStore, postFolderName } from '@handmake/stores';

import { buildPostFromPayload } from './build-post';
import { createGitCommitter } from './git';
import type { GitCommitter } from './git';
import { fetchAndProcessPhotos } from './photos';
import { parseDispatchPayload } from './payload';
import { requiredEnv } from './required-env';
import { loadTenantConfig } from './tenant-config';

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
}

export interface PublishResult {
  post: Post;
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

function defaultRegistry(tenant: TenantConfig, env: NodeJS.ProcessEnv): ChannelRegistry {
  const registry = new ChannelRegistry();
  for (const key of Object.keys(tenant.channels)) {
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
  const tenant = await loadTenantConfig(payload.tenantId, root);

  const photos = await fetchAndProcessPhotos(payload.fileIds, deps.mediaSource, env);
  const post = buildPostFromPayload(payload, tenant, { now });

  const store = new GitRepoContentStore({ rootDir: root });
  await store.savePost(post, photos);

  const git = deps.git ?? createGitCommitter({ repoDir: root, env });
  const postFolder = path.join('content', 'posts', postFolderName(post));
  const committedPost = await git.commit([postFolder], `content: add post ${post.id}`);
  log(committedPost ? `committed ${postFolder}` : `${postFolder} unchanged (already committed)`);

  const registry = deps.registry ?? defaultRegistry(tenant, env);
  const secrets: SecretResolver = deps.secrets ?? {
    resolve: async (name) => requiredEnv(name, env),
  };
  const notifier: Notifier =
    deps.notifier ??
    ({ notify: async (target, message) => log(`notify ${target}: ${message}`) } satisfies Notifier);

  let ledger =
    (await store.readLedger(post.tenant, post.id)) ??
    initLedger(post.tenant, post.id, post.channels, now);
  const delivered: Record<string, (number | string)[]> = {};
  const skipped: string[] = [];

  const persistLedger = async (): Promise<void> => {
    await store.writeLedger(ledger);
    await git.commit(
      [path.join('content', 'ledger', `${post.id}.json`)],
      `content: update ledger ${post.id}`,
    );
  };

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
          onDelivered: (opIndex, remoteId) => {
            ledger = markOpDelivered(ledger, channel, opIndex, remoteId, now);
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
      await notifier.notify(
        'operator',
        `publish failed for ${post.tenant}/${post.id} on ${channel}: ${message}`,
      );
      throw new PublishError(`channel "${channel}" delivery failed: ${message}`);
    }
    await persistLedger();
  }

  await notifier.notify('author', `published ${post.id} to ${Object.keys(delivered).join(', ')}`);
  return { post, ledger, delivered, skipped };
}
