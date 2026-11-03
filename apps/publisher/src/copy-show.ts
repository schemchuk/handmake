import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  idempotencyBase,
  initLedger,
  isUlid,
  markDone,
  markFailed,
  markOpDelivered,
  renderChannelShow,
  showCopyPlanSchema,
} from '@handmake/core';
import { GitRepoContentStore } from '@handmake/stores';
import { createGitCommitter } from './git';
import { defaultRegistry } from './publish';
import type { PublishDeps } from './publish';
import { requiredEnv } from './required-env';
import { loadTenantConfig } from './tenant-config';
import { verifyMarkedMedia } from './marking';

/** Copy only published immutable content. Never calls draft media or publication callbacks. */
export async function runCopyShow(tenantId: string, showId: string, deps: PublishDeps = {}) {
  try {
    return await copyShow(tenantId, showId, deps);
  } catch (error) {
    try {
      await deps.notifier?.notify(
        'operator',
        `show copy failed for ${tenantId}/${showId}; retry copies`,
      );
    } catch {
      (deps.logger ?? console.log)('show copy operator notification failed');
    }
    throw error;
  }
}

async function copyShow(tenantId: string, showId: string, deps: PublishDeps) {
  if (!isUlid(showId)) throw new Error('show id must be a ULID');
  const root = deps.root ?? deps.cwd ?? process.cwd();
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const store = new GitRepoContentStore({ rootDir: root });
  const show = await store.readShow(tenantId, showId);
  if (!show) throw new Error('published show unavailable for tenant');
  const tenant = await loadTenantConfig(tenantId, root);
  const media = [];
  for (const declared of [...show.images, show.video]) {
    const bytes = await store.readShowMedia(tenantId, showId, declared.fileName);
    if (!bytes?.length) throw new Error('published show media is missing');
    await verifyMarkedMedia(
      bytes,
      declared === show.video ? 'video/mp4' : 'image/png',
      declared.marker,
      show.video.durationSeconds,
    );
    media.push(bytes);
  }
  const hashes = media.map((bytes) => createHash('sha256').update(bytes).digest('hex'));
  let ledger = (await store.readLedger(tenantId, showId)) ?? initLedger(tenantId, showId, [], now);
  const registry =
    deps.registry ??
    defaultRegistry(tenant, env, Object.keys(ledger.showCopyPlan?.channels ?? tenant.channels));
  if (!ledger.showCopyPlan) {
    if (Object.keys(ledger.channels).length) throw new Error('copy progress has no stable plan');
    if (!tenant.site) throw new Error('show copies require a site');
    // Fail the entire batch before sending if any configured channel lacks show support.
    // Silently skipping it would report an incomplete copy as successful.
    for (const key of Object.keys(tenant.channels)) {
      if (!registry.get(key).renderShow) throw new Error(`channel "${key}" does not support shows`);
    }
    const channels = Object.fromEntries(
      Object.entries(tenant.channels).map(([key, settings]) => [
        key,
        {
          operations: renderChannelShow(registry.get(key), show, {
            site: tenant.site!,
            languages: tenant.languages,
          }),
          settings,
        },
      ]),
    );
    ledger = {
      ...initLedger(tenantId, showId, Object.keys(channels), now),
      showCopyPlan: showCopyPlanSchema.parse({ version: 1, mediaHashes: hashes, channels }),
    };
  }
  const plan = showCopyPlanSchema.parse(ledger.showCopyPlan);
  if (!isDeepStrictEqual(hashes, plan.mediaHashes)) throw new Error('copy media changed');
  if (!isDeepStrictEqual(Object.keys(ledger.channels).sort(), Object.keys(plan.channels).sort()))
    throw new Error('copy progress channels do not match plan');
  // Validate the entire batch before any network side effect, including completed channels.
  for (const [channel, { operations }] of Object.entries(plan.channels)) {
    registry.get(channel);
    const entry = ledger.channels[channel]!;
    if (
      entry.remoteIds.length > operations.length ||
      (entry.status === 'done' && entry.remoteIds.length !== operations.length)
    )
      throw new Error('invalid copy progress');
    for (const [index, op] of operations.entries()) {
      if (op.replyToOp !== undefined && op.replyToOp >= index)
        throw new Error('invalid copy reply target');
      if (op.kind === 'mediaGroup' && op.photoIndexes.some((i) => i >= show.images.length))
        throw new Error('invalid copy image index');
    }
  }
  const git = deps.git ?? createGitCommitter({ repoDir: root, env });
  const persist = async () => {
    await store.writeLedger(ledger);
    await git.commit([`content/ledger/${showId}.json`], `content: update show copies ${showId}`);
  };
  const skipped: string[] = [];
  // Also commits progress left on disk by a previous interrupted commit before resuming.
  await persist();
  for (const [channel, snapshot] of Object.entries(plan.channels)) {
    const entry = ledger.channels[channel]!;
    if (entry.status === 'done') {
      skipped.push(channel);
      continue;
    }
    try {
      await registry.get(channel).deliver(
        snapshot.operations,
        {
          secrets: deps.secrets ?? { resolve: async (name) => requiredEnv(name, env) },
          settings: snapshot.settings,
          idempotencyBase: idempotencyBase(tenantId, showId, channel),
          photos: media.slice(0, -1),
          video: media.at(-1),
        },
        {
          startAt: entry.remoteIds.length,
          knownIds: entry.remoteIds,
          onDelivered: async (index, id) => {
            ledger = markOpDelivered(ledger, channel, index, id, now);
            await persist();
          },
        },
      );
      if (ledger.channels[channel]!.remoteIds.length !== snapshot.operations.length)
        throw new Error('adapter did not record all copy operations');
      ledger = markDone(ledger, channel, now);
      await persist();
    } catch (error) {
      ledger = markFailed(ledger, channel, 'show copy delivery or persistence failed', now);
      await persist();
      throw error;
    }
  }
  return { show, ledger, skipped };
}
