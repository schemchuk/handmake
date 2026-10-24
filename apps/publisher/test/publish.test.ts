import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { renderTelegram } from '@handmake/channels';
import { ChannelRegistry } from '@handmake/core';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  DeliverContext,
  DeliverProgress,
  Post,
  RemoteId,
  SendOperation,
} from '@handmake/core';
import { FakeChannelAdapter, FakeMediaSource, FakeNotifier } from '@handmake/core/testing';
import { GitRepoContentStore } from '@handmake/stores';
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { runPublish, PublishError } from '../src/publish';
import type { DispatchPayload } from '../src/payload';

const execFileAsync = promisify(execFile);

const realTenantConfig = fileURLToPath(
  new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
);
const jpegFixturePath = fileURLToPath(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));

const now = new Date('2026-10-24T10:00:00.000Z');
const draftId = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const tenantId = 'faden-und-stimmung';

const basePayload: DispatchPayload = {
  tenantId,
  draftId,
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
  await mkdir(path.join(repoDir, 'config', 'tenants'), { recursive: true });
  await copyFile(
    realTenantConfig,
    path.join(repoDir, 'config', 'tenants', path.basename(realTenantConfig)),
  );
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
      env: {},
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
    expect(notifier.messages.some((m) => m.target === 'author')).toBe(true);
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
    expect(adapter.deliveries).toHaveLength(1);
    expect(rerun.ledger.channels.telegram?.remoteIds).toEqual([
      'telegram-msg-1-0',
      'telegram-msg-1-1',
    ]);
  });

  it('marks the channel failed mid-delivery and resumes only the missing op on re-run', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const notifier = new FakeNotifier();

    class FlakyAdapter implements ChannelAdapter {
      readonly key = 'telegram';
      readonly capabilities: ChannelCapabilities = {
        maxPhotos: 10,
        captionLimit: 1024,
        messageLimit: 4096,
        polls: false,
      };
      failOnOp: number | null = 1;
      readonly progressReports: number[] = [];

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
        }
        return ids;
      }
    }

    const adapter = new FlakyAdapter();

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
});
