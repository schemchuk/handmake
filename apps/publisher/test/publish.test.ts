import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { renderTelegram, TelegramAdapter } from '@handmake/channels';
import { ChannelRegistry, parseLedger } from '@handmake/core';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  DeliverContext,
  DeliverProgress,
  Notifier,
  NotifyTarget,
  Post,
  PublishLedger,
  RemoteId,
  SendOperation,
} from '@handmake/core';
import { FakeChannelAdapter, FakeMediaSource, FakeNotifier } from '@handmake/core/testing';
import { GitRepoContentStore } from '@handmake/stores';
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { runPublish, PublishError } from '../src/publish';
import type { DispatchPayload } from '../src/payload';
import { writeTelegramOnlyTenantConfig } from './helpers/tenant-config';

const execFileAsync = promisify(execFile);
const jpegFixturePath = fileURLToPath(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));

const now = new Date('2026-10-24T10:00:00.000Z');
const draftId = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const tenantId = 'faden-und-stimmung';

const basePayload: DispatchPayload = {
  tenantId,
  draftId,
  kind: 'post',
  type: 'free',
  texts: { uk: 'Тестовий допис (T10).', de: 'Testbeitrag (T10).' },
  fileIds: ['file-1'],
  provenance: 'human',
};

const tmpDirs: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A real git repo with the tenant config committed. */
async function makeRepo(): Promise<{ repoDir: string; payloadPath: string }> {
  const repoDir = await freshDir('handmake-publish-repo-');
  await git(repoDir, ['init', '-q']);
  await git(repoDir, ['config', 'user.name', 'Test']);
  await git(repoDir, ['config', 'user.email', 'test@example.com']);
  await writeTelegramOnlyTenantConfig(path.join(repoDir, 'config', 'tenants'));
  await git(repoDir, ['add', 'config']);
  await git(repoDir, ['commit', '-q', '-m', 'test: tenant config']);
  const payloadPath = path.join(repoDir, 'payload.json');
  await writeFile(payloadPath, JSON.stringify(basePayload));
  return { repoDir, payloadPath };
}

function makeRegistry(adapter: ChannelAdapter): ChannelRegistry {
  const registry = new ChannelRegistry();
  registry.register(adapter);
  return registry;
}

const renderImpl = (post: Post, _settings: unknown): SendOperation[] =>
  renderTelegram(post, { channelId: 'TEST_CHANNEL', languages: ['uk', 'de'] });

function fakeAdapter(): FakeChannelAdapter {
  return new FakeChannelAdapter({ key: 'telegram', renderImpl });
}

/**
 * Telegram stand-in that fails on `failOnOp` and records what it reported.
 * After op 0 it reads the ledger file from disk, proving the publish loop
 * persisted the delivery mid-channel (B2: a kill must not lose delivered ops).
 */
class FlakyAdapter implements ChannelAdapter {
  readonly key = 'telegram';
  readonly capabilities: ChannelCapabilities = {
    maxPhotos: 10,
    captionLimit: 1024,
    messageLimit: 4096,
    polls: false,
    pollMaxOptions: 0,
    pollQuestionLimit: 0,
    pollOptionLimit: 0,
  };
  failOnOp: number | null = 1;
  readonly progressReports: number[] = [];
  ledgerOnDiskAfterOp0: PublishLedger | undefined;

  constructor(private readonly repoDir: string) {}

  render(post: Post, _settings: unknown): SendOperation[] {
    return renderImpl(post, _settings);
  }

  async deliver(
    ops: SendOperation[],
    _ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    const ids: RemoteId[] = [...(progress?.knownIds ?? [])];
    for (let i = progress?.startAt ?? 0; i < ops.length; i++) {
      if (i === this.failOnOp) throw new Error(`simulated failure on op ${i}`);
      const remoteId = `remote-${i}`;
      ids.push(remoteId);
      this.progressReports.push(i);
      await progress?.onDelivered(i, remoteId);
      if (i === 0) {
        const raw = await readFile(
          path.join(this.repoDir, 'content', 'ledger', `${draftId}.json`),
          'utf8',
        );
        this.ledgerOnDiskAfterOp0 = parseLedger(raw);
      }
    }
    return ids;
  }
}

async function mediaSourceWithFixture(): Promise<FakeMediaSource> {
  const source = new FakeMediaSource();
  source.photos.set('file-1', new Uint8Array(await readFile(jpegFixturePath)));
  return source;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runPublish', () => {
  it('delivers every pending channel, commits post and ledger, and skips done channels on re-run', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const adapter = fakeAdapter();
    const notifier = new FakeNotifier();
    const lines: string[] = [];

    const result = await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: { SITE_EXCLUDE_POST: 'true' },
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(adapter),
      notifier,
      logger: (line) => lines.push(line),
    });

    expect(result.post.id).toBe(draftId);
    expect(result.delivered.telegram).toEqual(['telegram-msg-1-0', 'telegram-msg-1-1']);
    expect(result.skipped).toEqual([]);

    // Ledger on disk is done and carries the remote ids.
    const store = new GitRepoContentStore({ rootDir: repoDir });
    expect((await store.readPost(tenantId, draftId))?.siteExcluded).toBe(true);
    const ledger = await store.readLedger(tenantId, draftId);
    expect(ledger?.channels.telegram).toEqual({
      status: 'done',
      remoteIds: ['telegram-msg-1-0', 'telegram-msg-1-1'],
      updatedAt: now.toISOString(),
    });

    // The photo landed in the committed post folder, EXIF stripped.
    const photoPath = path.join(
      repoDir,
      'content',
      'posts',
      `2026-10-24-${draftId.toLowerCase()}`,
      'photo-1.jpg',
    );
    const photoMeta = await sharp(await readFile(photoPath)).metadata();
    expect(photoMeta.format).toBe('jpeg');
    expect(photoMeta.exif).toBeUndefined();

    // Both commits exist.
    const log = await git(repoDir, ['log', '--format=%s']);
    expect(log).toContain(`content: add post ${draftId}`);
    expect(log).toContain(`content: update ledger ${draftId}`);

    // Author was notified; the log records the commit without message bodies.
    expect(notifier.messages.find((m) => m.target === 'author')?.message).toBe(
      'Опубліковано. Канали: telegram.',
    );
    expect(lines.join('\n')).toContain(
      `committed content/posts/2026-10-24-${draftId.toLowerCase()}`,
    );

    // Re-run with the SAME payload: nothing is delivered again.
    const rerun = await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: {},
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(adapter),
      notifier,
      logger: () => {},
    });
    expect(rerun.skipped).toEqual(['telegram']);
    expect(rerun.post.siteExcluded).toBe(true);
    expect(adapter.deliveries).toHaveLength(1);
    expect(rerun.ledger.channels.telegram?.remoteIds).toEqual([
      'telegram-msg-1-0',
      'telegram-msg-1-1',
    ]);
  });

  it('marks the channel failed mid-delivery and resumes only the missing op on re-run', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const notifier = new FakeNotifier();

    const adapter = new FlakyAdapter(repoDir);

    await expect(
      runPublish(payloadPath, {
        cwd: repoDir,
        root: repoDir,
        env: {},
        now,
        mediaSource: await mediaSourceWithFixture(),
        registry: makeRegistry(adapter),
        notifier,
        logger: () => {},
      }),
    ).rejects.toThrow(PublishError);

    // Op 0 was already on disk before the failure surfaced (mid-channel write).
    expect(adapter.ledgerOnDiskAfterOp0?.channels.telegram?.remoteIds).toEqual(['remote-0']);
    expect(adapter.ledgerOnDiskAfterOp0?.channels.telegram?.status).toBe('pending');

    // The failed ledger was persisted and committed.
    const store = new GitRepoContentStore({ rootDir: repoDir });
    const failed = await store.readLedger(tenantId, draftId);
    expect(failed?.channels.telegram?.status).toBe('failed');
    expect(failed?.channels.telegram?.remoteIds).toEqual(['remote-0']);
    expect(failed?.channels.telegram?.error).toContain('simulated failure on op 1');
    const log = await git(repoDir, ['log', '--format=%s']);
    expect(log).toContain(`content: update ledger ${draftId}`);

    // The operator was notified about the failure.
    expect(
      notifier.messages.some((m) => m.target === 'operator' && m.message.includes(`on telegram`)),
    ).toBe(true);

    // Fix the adapter and re-run: only op 1 is delivered.
    adapter.failOnOp = null;
    const rerun = await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: {},
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(adapter),
      notifier,
      logger: () => {},
    });
    // First run reported op 0 before failing; the re-run reports only op 1.
    expect(adapter.progressReports).toEqual([0, 1]);
    expect(rerun.delivered.telegram).toEqual(['remote-0', 'remote-1']);
    expect(rerun.ledger.channels.telegram?.status).toBe('done');
    expect(notifier.messages.some((m) => m.target === 'author')).toBe(true);
  });

  it('publishes without photos and without a bot token', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    await writeFile(payloadPath, JSON.stringify({ ...basePayload, fileIds: [] }));

    const result = await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: {},
      now,
      registry: makeRegistry(fakeAdapter()),
      notifier: new FakeNotifier(),
      logger: () => {},
    });

    expect(result.post.photos).toEqual([]);
    expect(result.delivered.telegram).toEqual(['telegram-msg-1-0', 'telegram-msg-1-1']);
    const postDir = path.join(repoDir, 'content', 'posts', `2026-10-24-${draftId.toLowerCase()}`);
    expect(await readdir(postDir)).toEqual(['index.md']);
  });

  it('rejects a payload whose draftId is not a ULID', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    await writeFile(
      payloadPath,
      JSON.stringify({ ...basePayload, draftId: '01JDRYRUNSAMPLE000000000000' }),
    );

    await expect(
      runPublish(payloadPath, {
        cwd: repoDir,
        root: repoDir,
        env: {},
        now,
        registry: makeRegistry(fakeAdapter()),
        notifier: new FakeNotifier(),
        logger: () => {},
      }),
    ).rejects.toThrow(/not a ULID/);
    // Nothing was written before the rejection.
    expect(await readdir(repoDir)).not.toContain('content');
  });

  it('re-run on the next day reuses the same folder and sends only the missing op', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const adapter = new FlakyAdapter(repoDir);
    const notifier = new FakeNotifier();
    const deps = {
      cwd: repoDir,
      root: repoDir,
      env: {},
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(adapter),
      notifier,
      logger: () => {},
    };

    await expect(runPublish(payloadPath, { ...deps, now })).rejects.toThrow(PublishError);
    adapter.failOnOp = null;

    const nextDay = new Date('2026-10-25T10:00:00.000Z');
    const rerun = await runPublish(payloadPath, { ...deps, now: nextDay });

    expect(adapter.progressReports).toEqual([0, 1]);
    expect(rerun.post.date).toBe(now.toISOString());
    expect(rerun.ledger.channels.telegram?.status).toBe('done');
    const postsDir = path.join(repoDir, 'content', 'posts');
    expect(await readdir(postsDir)).toEqual([`2026-10-24-${draftId.toLowerCase()}`]);
  });

  it('wotw-poll: resumes between album and poll, and a re-run never sends a second poll (T21)', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    await writeFile(
      payloadPath,
      JSON.stringify({
        ...basePayload,
        type: 'wotw-poll',
        texts: { uk: 'Голосуйте!', de: 'Stimmt ab!' },
        fileIds: ['file-1', 'file-2'],
        poll: { question: 'Яка робота тижня?', options: ['1. Ваза', '2. Шаль'] },
      }),
    );
    const mediaSource = await mediaSourceWithFixture();
    mediaSource.photos.set('file-2', new Uint8Array(await readFile(jpegFixturePath)));

    // Real TelegramAdapter against a fake Bot API: album ok, poll fails once.
    let pollAttempts = 0;
    const requests: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/sendMediaGroup')) {
        return new Response(JSON.stringify({ ok: true, result: [{ message_id: 100 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/sendPoll')) {
        pollAttempts += 1;
        if (pollAttempts === 1) {
          return new Response(
            JSON.stringify({ ok: false, error_code: 500, description: 'exploded' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 200 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 300 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new TelegramAdapter({ token: 'TEST', fetchImpl, sleep: async () => {} });
    const notifier = new FakeNotifier();
    const deps = {
      cwd: repoDir,
      root: repoDir,
      env: {},
      now,
      mediaSource,
      registry: makeRegistry(adapter),
      secrets: { resolve: async () => 'chat-1' },
      notifier,
      logger: () => {},
    };

    await expect(runPublish(payloadPath, deps)).rejects.toThrow(PublishError);

    // The album landed and its message id is in the ledger; the poll did not.
    const store = new GitRepoContentStore({ rootDir: repoDir });
    const failed = await store.readLedger(tenantId, draftId);
    expect(failed?.channels.telegram?.remoteIds).toEqual([100]);
    expect(requests.filter((u) => u.endsWith('/sendPoll'))).toHaveLength(1);

    // Re-run: only the poll (and the DE reply after it) is delivered — no
    // second album, and once done, no second poll either.
    const rerun = await runPublish(payloadPath, deps);
    expect(rerun.ledger.channels.telegram?.remoteIds).toEqual([100, 200, 300]);
    expect(rerun.ledger.channels.telegram?.status).toBe('done');
    expect(requests.filter((u) => u.endsWith('/sendMediaGroup'))).toHaveLength(1);
    expect(requests.filter((u) => u.endsWith('/sendPoll'))).toHaveLength(2);

    const second = await runPublish(payloadPath, deps);
    expect(second.skipped).toEqual(['telegram']);
    expect(requests.filter((u) => u.endsWith('/sendMediaGroup'))).toHaveLength(1);
    expect(requests.filter((u) => u.endsWith('/sendPoll'))).toHaveLength(2);
  });

  it('never lets a failing notifier change the publish outcome', async () => {
    const failing = {
      notify: async (_target: NotifyTarget, _message: string): Promise<void> => {
        throw new Error('notify transport down');
      },
    } satisfies Notifier;

    // Success path still succeeds when the author alert fails.
    const okRepo = await makeRepo();
    const okResult = await runPublish(okRepo.payloadPath, {
      cwd: okRepo.repoDir,
      root: okRepo.repoDir,
      env: {},
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(fakeAdapter()),
      notifier: failing,
      logger: () => {},
    });
    expect(okResult.delivered.telegram).toHaveLength(2);

    // Failure path still surfaces PublishError, not the notify error.
    const badRepo = await makeRepo();
    await expect(
      runPublish(badRepo.payloadPath, {
        cwd: badRepo.repoDir,
        root: badRepo.repoDir,
        env: {},
        now,
        mediaSource: await mediaSourceWithFixture(),
        registry: makeRegistry(new FlakyAdapter(badRepo.repoDir)),
        notifier: failing,
        logger: () => {},
      }),
    ).rejects.toThrow(PublishError);
  });

  it('renders the canonical footer only when featureFlags.canonicalLinks is on (T40)', async () => {
    // Render through the real renderer with the settings runPublish passes,
    // so the test pins what actually reaches the channel.
    const renderWithPassedSettings = (post: Post, settings: unknown): SendOperation[] =>
      renderTelegram(post, settings);
    const publish = async (
      repoDir: string,
      payloadPath: string,
      adapter: FakeChannelAdapter,
    ): Promise<void> => {
      await runPublish(payloadPath, {
        cwd: repoDir,
        root: repoDir,
        env: {},
        now,
        mediaSource: await mediaSourceWithFixture(),
        registry: makeRegistry(adapter),
        notifier: new FakeNotifier(),
        logger: () => {},
      });
    };

    // Flag on (the committed tenant config): both language copies link to the post page.
    const onRepo = await makeRepo();
    const onAdapter = new FakeChannelAdapter({
      key: 'telegram',
      renderImpl: renderWithPassedSettings,
    });
    await publish(onRepo.repoDir, onRepo.payloadPath, onAdapter);
    const lowerId = draftId.toLowerCase();
    expect(onAdapter.deliveries[0]!.ops[0]).toMatchObject({
      caption:
        'Тестовий допис (T10).\n\n' +
        `Більше на сайті: https://fadenundstimmung.de/uk/posts/${lowerId}/`,
    });
    expect(onAdapter.deliveries[0]!.ops[1]).toMatchObject({
      text:
        `Testbeitrag (T10).\n\nMehr auf der Website: https://fadenundstimmung.de/posts/${lowerId}/\n` +
        'Kanal abonnieren: https://t.me/Faden_und_Stimmung',
    });

    // Flag off: the channel copy stays unchanged.
    const offRepo = await makeRepo();
    const configPath = path.join(offRepo.repoDir, 'config', 'tenants', 'faden-und-stimmung.yaml');
    await writeFile(
      configPath,
      (await readFile(configPath, 'utf8')).replace('canonicalLinks: true', 'canonicalLinks: false'),
    );
    const offAdapter = new FakeChannelAdapter({
      key: 'telegram',
      renderImpl: renderWithPassedSettings,
    });
    await publish(offRepo.repoDir, offRepo.payloadPath, offAdapter);
    expect(offAdapter.deliveries[0]!.ops[0]).toMatchObject({ caption: 'Тестовий допис (T10).' });
    expect(offAdapter.deliveries[0]!.ops[1]).toMatchObject({
      text: 'Testbeitrag (T10).\n\nKanal abonnieren: https://t.me/Faden_und_Stimmung',
    });
  });

  it('links a work announcement to the work page, never to a post page (T40)', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const versions = Object.fromEntries(
      Object.entries(basePayload.texts).map(([lang, description]) => [
        lang,
        { description, provenance: 'human' as const },
      ]),
    );
    await writeFile(
      payloadPath,
      JSON.stringify({
        ...basePayload,
        kind: 'work',
        work: {
          kind: 'interior',
          date: now.toISOString(),
          collection: 'canonical-fixture',
          channels: ['telegram'],
          versions,
          newCollection: {
            order: 1,
            versions: Object.fromEntries(
              Object.entries(versions).map(([lang, version]) => [
                lang,
                { ...version, title: 'Canonical fixture' },
              ]),
            ),
          },
        },
      }),
    );
    const adapter = new FakeChannelAdapter({
      key: 'telegram',
      renderImpl: (post, settings) => renderTelegram(post, settings),
    });
    await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: {},
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(adapter),
      notifier: new FakeNotifier(),
      logger: () => {},
    });

    const lowerId = draftId.toLowerCase();
    const ops = adapter.deliveries[0]!.ops;
    expect(ops[0]).toMatchObject({
      caption:
        'Тестовий допис (T10).\n\n' +
        `Більше на сайті: https://fadenundstimmung.de/uk/works/${lowerId}/`,
    });
    expect(ops[1]).toMatchObject({
      text:
        `Testbeitrag (T10).\n\nMehr auf der Website: https://fadenundstimmung.de/works/${lowerId}/\n` +
        'Kanal abonnieren: https://t.me/Faden_und_Stimmung',
    });
  });
});

it('resolves private names only for delivery while committed content and reruns keep placeholders', async () => {
  const { repoDir, payloadPath } = await makeRepo();
  const id = '01JBCA1B2C3D4E5F6G7H8J9K0N';
  const text = `Contest {entry:${id}}`;
  await writeFile(
    payloadPath,
    JSON.stringify({ ...basePayload, fileIds: [], texts: { uk: text, de: text } }),
  );
  const seen: Post[] = [];
  const adapter = new FakeChannelAdapter({
    key: 'telegram',
    renderImpl: (post) => {
      seen.push(post);
      return renderImpl(post, {});
    },
  });
  const lines: string[] = [];
  const deps = {
    root: repoDir,
    now,
    registry: makeRegistry(adapter),
    env: {
      PUBLISH_CALLBACK_URL: 'https://fixture.test/callbacks/published',
      NAMES_ENDPOINT_SECRET: 'fixture-key',
    },
    logger: (line: string) => lines.push(line),
    fetchImpl: (async () => Response.json({ [id]: 'Private fixture' })) as typeof fetch,
  };
  const result = await runPublish(payloadPath, deps);
  expect(result.post.texts.uk).toBe(text);
  expect(seen[0]!.texts.uk).toBe('Contest Private fixture');
  const store = new GitRepoContentStore({ rootDir: repoDir });
  expect((await store.readPost(tenantId, draftId))!.texts.uk).toBe(text);
  expect(lines.filter((line) => line.includes('Private fixture'))).toEqual([
    '::add-mask::Private fixture',
  ]);
  const rerun = await runPublish(payloadPath, deps);
  expect(rerun.skipped).toEqual(['telegram']);
  expect((await git(repoDir, ['show', 'HEAD'])).includes('Private fixture')).toBe(false);
});

it.each(['wotw-result', 'wotw-poll'] as const)(
  'persists %s anonymous sources and stable completion time across config drift',
  async (type) => {
    const { repoDir, payloadPath } = await makeRepo();
    const id = '01JBCA1B2C3D4E5F6G7H8J9K0N';
    await writeFile(
      payloadPath,
      JSON.stringify({
        ...basePayload,
        type,
        ...(type === 'wotw-poll'
          ? {
              poll: { question: 'Vote', options: ['Work 1', 'Work 2'] },
              fileIds: ['file-1', 'file-2'],
            }
          : {}),
        texts: { uk: `Winner {entry:${id}}`, de: `Werk {entry:${id}}` },
      }),
    );
    const callbacks: unknown[] = [];
    const sent: unknown[] = [];
    const adapter = new TelegramAdapter({
      token: 'fixture',
      fetchImpl: (async (input, init) => {
        sent.push(init?.body);
        const result = { message_id: 100 + sent.length };
        return Response.json({
          ok: true,
          result: String(input).endsWith('/sendMediaGroup')
            ? [result, { message_id: 200 + sent.length }]
            : result,
        });
      }) as typeof fetch,
    });
    const mediaSource = await mediaSourceWithFixture();
    mediaSource.photos.set('file-2', new Uint8Array(await readFile(jpegFixturePath)));
    const deps = {
      root: repoDir,
      now,
      registry: makeRegistry(adapter),
      mediaSource,
      env: {
        PUBLISH_CALLBACK_URL: 'https://fixture.test/callbacks/published',
        PUBLISH_CALLBACK_SECRET: 'fixture',
        NAMES_ENDPOINT_SECRET: 'fixture',
      },
      secrets: { resolve: async () => 'destination' },
      logger: () => {},
      fetchImpl: (async () => Response.json({ [id]: 'Private fixture' })) as typeof fetch,
      callback: {
        send: async (body: unknown) => {
          callbacks.push(body);
        },
      },
    };
    await runPublish(payloadPath, deps);
    const first = callbacks[0] as {
      channels: {
        telegram: {
          editReceipt: {
            plan: { operations: SendOperation[] };
            remoteIds: number[];
            publishedAt: string;
          };
        };
      };
    };
    const receipt = first.channels.telegram.editReceipt;
    expect(receipt.remoteIds).toEqual(type === 'wotw-poll' ? [101, 102, 103] : [101, 102]);
    expect(receipt.plan.operations.map((op) => op.kind)).toEqual(
      type === 'wotw-poll' ? ['mediaGroup', 'poll', 'message'] : ['mediaGroup', 'message'],
    );
    expect(JSON.stringify(receipt)).toContain(`{entry:${id}}`);
    expect(JSON.stringify(receipt)).not.toContain('Private fixture');
    expect(receipt.publishedAt).toBe(now.toISOString());
    expect(
      type === 'wotw-poll'
        ? (sent[0] as FormData).get('media')
        : (sent[0] as FormData).get('caption'),
    ).toContain('Private fixture');
    const configPath = path.join(repoDir, 'config/tenants', `${tenantId}.yaml`);
    await writeFile(
      configPath,
      (await readFile(configPath, 'utf8'))
        .replace('Kanal', 'Changed')
        .replaceAll('Faden_und_Stimmung', 'changed_fixture'),
    );
    await runPublish(payloadPath, { ...deps, now: new Date('2026-11-12T12:00:00Z') });
    expect(callbacks[1]).toEqual(callbacks[0]);
    expect(sent).toHaveLength(type === 'wotw-poll' ? 3 : 2);
    const ledger = await new GitRepoContentStore({ rootDir: repoDir }).readLedger(
      tenantId,
      draftId,
    );
    expect(JSON.stringify(ledger)).not.toContain('Private fixture');
    expect(await git(repoDir, ['log', '-p', '--all'])).not.toContain('Private fixture');
  },
);
