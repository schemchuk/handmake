import { idempotencyBase, initLedger, markDone, markFailed, markOpDelivered } from '@handmake/core';
import type {
  ChannelAdapter,
  DeliverContext,
  PublishLedger,
  ShowMediaSource,
  Work,
} from '@handmake/core';
import type { GitRepoContentStore } from '@handmake/stores';
import { stripAuthenticVideo } from './authentic-media';
import { TelegramMediaSource } from './photos/telegram-media-source';
import { requiredEnv } from './required-env';

export class MissingWorkVideoError extends Error {
  constructor() {
    super('Published work video is missing');
  }
}

export async function prepareWorkVideo(
  work: Work,
  fileId: string | undefined,
  store: GitRepoContentStore,
  source: ShowMediaSource | undefined,
  env: NodeJS.ProcessEnv,
): Promise<Uint8Array | undefined> {
  if (!work.video || !fileId) return undefined;
  if (await store.readWork(work.tenant, work.id)) {
    const saved = await store.readWorkVideo(work.tenant, work.id).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MissingWorkVideoError();
      throw error;
    });
    if (!saved?.length) throw new MissingWorkVideoError();
    return saved;
  }
  const raw = source
    ? await source.fetchMedia(fileId)
    : await new TelegramMediaSource({
        token: requiredEnv('TELEGRAM_BOT_TOKEN', env),
      }).fetchMedia(fileId, 20_000_000);
  return stripAuthenticVideo(raw);
}

/** Separate ledger; only Telegram needs the album prefix to resolve its reply. */
export async function deliverWorkVideo(
  work: Work,
  video: Uint8Array,
  photosLedger: PublishLedger,
  adapter: ChannelAdapter,
  context: DeliverContext,
  store: GitRepoContentStore,
  persist: (ledger: PublishLedger) => Promise<void>,
  now: Date,
  caption?: string,
) {
  const id = `${work.id}-video`;
  let ledger =
    (await store.readLedger(work.tenant, id)) ?? initLedger(work.tenant, id, [adapter.key], now);
  if (!ledger.channels[adapter.key]) {
    ledger = {
      ...ledger,
      channels: {
        ...ledger.channels,
        ...initLedger(work.tenant, id, [adapter.key], now).channels,
      },
    };
  }
  const entry = ledger.channels[adapter.key]!;
  if (entry.status === 'done') return;
  const album = photosLedger.channels[adapter.key]?.remoteIds[0];
  if (album === undefined) throw new Error('Work video requires a delivered photo album');
  const telegram = adapter.key === 'telegram';
  const prefix = telegram ? [album] : [];
  try {
    await adapter.deliver(
      telegram
        ? [
            { kind: 'mediaGroup', photoIndexes: [0] },
            { kind: 'video', replyToOp: 0 },
          ]
        : [{ kind: 'video', ...(caption !== undefined && { caption }) }],
      { ...context, video, idempotencyBase: idempotencyBase(work.tenant, id, adapter.key) },
      {
        startAt: prefix.length + entry.remoteIds.length,
        knownIds: [...prefix, ...entry.remoteIds],
        onDelivered: async (index, remoteId) => {
          ledger = markOpDelivered(ledger, adapter.key, index - prefix.length, remoteId, now);
          await store.writeLedger(ledger);
        },
      },
    );
    ledger = markDone(ledger, adapter.key, now);
  } catch {
    ledger = markFailed(
      ledger,
      adapter.key,
      'Не вдалося опублікувати відео роботи. Повторіть публікацію.',
      now,
    );
    await persist(ledger);
    throw new Error(ledger.channels[adapter.key]!.error);
  }
  await persist(ledger);
}
