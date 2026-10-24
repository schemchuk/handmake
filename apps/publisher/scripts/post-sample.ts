/**
 * Manual check (T07): posts a small sample to the private TEST channel.
 *
 *   pnpm --filter @handmake/publisher post:sample
 *
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_TEST_CHANNEL_ID in the
 * environment (see .env.example). Secret values are never printed.
 */
import { createTelegramAdapter, renderTelegram } from '@handmake/channels';
import type { Post } from '@handmake/core';
import sharp from 'sharp';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`post-sample: missing environment variable ${name} (see .env.example)`);
  }
  return value;
}

const token = requiredEnv('TELEGRAM_BOT_TOKEN');
// Plain env var, not a secret name: this script IS the secret resolver.
const testChannelId = requiredEnv('TELEGRAM_TEST_CHANNEL_ID');

const post: Post = {
  id: 'sample-manual-check',
  tenant: 'manual-check',
  date: new Date().toISOString(),
  publishAt: 'now',
  type: 'free',
  photos: ['sample-1.jpg'],
  channels: ['telegram'],
  versions: { uk: { provenance: 'human' }, de: { provenance: 'human' } },
  texts: {
    uk: 'Ручна перевірка доставки (T07): тестовий допис.',
    de: 'Manueller Delivery-Check (T07): Testbeitrag.',
  },
};

const photo = async (rgb: [number, number, number]) =>
  sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .jpeg()
    .toBuffer();

const settings = { channelId: 'TELEGRAM_TEST_CHANNEL_ID', languages: ['uk', 'de'] };
const ops = renderTelegram(post, settings);
const photos = [new Uint8Array(await photo([180, 120, 160]))];

const adapter = createTelegramAdapter({ token });

console.log(`post-sample: delivering ${ops.length} op(s) to the test channel`);
const remoteIds = await adapter.deliver(
  ops,
  {
    secrets: {
      resolve: async (name) => (name === 'TELEGRAM_TEST_CHANNEL_ID' ? testChannelId : ''),
    },
    idempotencyBase: `${post.tenant}:${post.id}:telegram`,
    settings,
    photos,
  },
  {
    startAt: 0,
    knownIds: [],
    onDelivered: (opIndex, remoteId) => {
      console.log(`op ${opIndex} delivered -> message_id ${remoteId}`);
    },
  },
);

console.log('post-sample: remote ids:', remoteIds);
