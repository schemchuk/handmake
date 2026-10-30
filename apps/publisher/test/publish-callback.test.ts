import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { renderTelegram } from '@handmake/channels';
import {
  ChannelRegistry,
  publishedCallbackBodySchema,
  verifyCallbackSignature,
} from '@handmake/core';
import type { ChannelAdapter } from '@handmake/core';
import { FakeChannelAdapter, FakeMediaSource, FakeNotifier } from '@handmake/core/testing';

import { afterAll, describe, expect, it } from 'vitest';

import { callbackSignatureHeader, createPublishCallbackSender } from '../src/publish-callback';
import { runPublish } from '../src/publish';
import type { DispatchPayload } from '../src/payload';

const execFileAsync = promisify(execFile);

const realTenantConfig = fileURLToPath(
  new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
);
const jpegFixturePath = fileURLToPath(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));

const now = new Date('2026-10-24T10:00:00.000Z');
const draftId = '01JBCA1B2C3D4E5F6G7H8J9K0M';
const tenantId = 'faden-und-stimmung';
const callbackSecret = 'test-callback-secret';
const callbackUrl = 'https://bot.example.com/callbacks/published';

const basePayload: DispatchPayload = {
  tenantId,
  draftId,
  kind: 'post',
  type: 'free',
  texts: { uk: 'Тестовий допис (T19).', de: 'Testbeitrag (T19).' },
  fileIds: ['file-1'],
  provenance: 'human',
};

const tmpDirs: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

/** A real git repo with the tenant config committed. */
async function makeRepo(): Promise<{ repoDir: string; payloadPath: string }> {
  const repoDir = await mkdtemp(path.join(tmpdir(), 'handmake-callback-repo-'));
  tmpDirs.push(repoDir);
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

function fakeAdapter(): ChannelAdapter {
  return new FakeChannelAdapter({
    key: 'telegram',
    renderImpl: (post, _settings) =>
      renderTelegram(post, { channelId: 'TEST_CHANNEL', languages: ['uk', 'de'] }),
  });
}

function makeRegistry(adapter: ChannelAdapter): ChannelRegistry {
  const registry = new ChannelRegistry();
  registry.register(adapter);
  return registry;
}

/** Adapter whose delivery always fails, to prove no callback fires on failure. */
class FailingAdapter extends FakeChannelAdapter {
  constructor() {
    super({
      key: 'telegram',
      renderImpl: (post, _settings) =>
        renderTelegram(post, { channelId: 'TEST_CHANNEL', languages: ['uk', 'de'] }),
    });
  }

  override async deliver(): Promise<never> {
    throw new Error('simulated delivery failure');
  }
}

/** Captures the request so a test can verify body and signature exactly. */
function capturingFetch(status = 200): {
  fetchImpl: typeof fetch;
  calls: { url: string; method: string; signature: string | null; body: string }[];
} {
  const calls: { url: string; method: string; signature: string | null; body: string }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      signature:
        new Headers(init?.headers).get(callbackSignatureHeader.toLowerCase()) ??
        new Headers(init?.headers).get(callbackSignatureHeader),
      body: String(init?.body),
    });
    return new Response('ok', { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function mediaSourceWithFixture(): Promise<FakeMediaSource> {
  const source = new FakeMediaSource();
  source.photos.set('file-1', new Uint8Array(await readFile(jpegFixturePath)));
  return source;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('createPublishCallbackSender', () => {
  it('signs the exact raw body it sends, verifiable by the bot’s verifier', async () => {
    const { fetchImpl, calls } = capturingFetch();
    const sender = createPublishCallbackSender({
      url: callbackUrl,
      secret: callbackSecret,
      fetchImpl,
    });
    const body = {
      tenantId,
      postId: draftId,
      date: now.toISOString(),
      photos: ['content/posts/photo-1.jpg'],
      channels: { telegram: 'done' as const },
    };

    await sender.send(body);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(callbackUrl);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toBe(JSON.stringify(body));
    expect(
      await verifyCallbackSignature(callbackSecret, calls[0]!.body, calls[0]!.signature!),
    ).toBe(true);
    // A wrong secret must not verify (the verifier is the shared source of truth).
    expect(
      await verifyCallbackSignature('other-secret', calls[0]!.body, calls[0]!.signature!),
    ).toBe(false);
    // The body is exactly what the bot’s schema accepts.
    expect(publishedCallbackBodySchema.safeParse(JSON.parse(calls[0]!.body)).success).toBe(true);
  });

  it('rejects on a non-2xx response so the caller can alert the operator', async () => {
    const { fetchImpl } = capturingFetch(500);
    const sender = createPublishCallbackSender({
      url: callbackUrl,
      secret: callbackSecret,
      fetchImpl,
    });

    await expect(
      sender.send({
        tenantId,
        postId: draftId,
        date: now.toISOString(),
        photos: [],
        channels: { telegram: 'done' },
      }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('runPublish published callback', () => {
  const callbackEnv = {
    PUBLISH_CALLBACK_URL: callbackUrl,
    PUBLISH_CALLBACK_SECRET: callbackSecret,
  };

  it('POSTs the signed callback after a fully delivered run', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const { fetchImpl, calls } = capturingFetch();
    const notifier = new FakeNotifier();

    const result = await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: callbackEnv,
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(fakeAdapter()),
      notifier,
      fetchImpl,
      logger: () => {},
    });

    expect(calls).toHaveLength(1);
    const sent = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(sent).toEqual({
      tenantId,
      postId: draftId,
      date: result.post.date,
      photos: result.post.photos,
      channels: { telegram: 'done' },
    });
    expect(
      await verifyCallbackSignature(callbackSecret, calls[0]!.body, calls[0]!.signature!),
    ).toBe(true);
  });

  it('re-fires the callback on a re-run (the bot’s endpoint is idempotent)', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const { fetchImpl, calls } = capturingFetch();
    const deps = {
      cwd: repoDir,
      root: repoDir,
      env: callbackEnv,
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(fakeAdapter()),
      notifier: new FakeNotifier(),
      fetchImpl,
      logger: () => {},
    };

    await runPublish(payloadPath, deps);
    await runPublish(payloadPath, deps);

    expect(calls).toHaveLength(2);
  });

  it('never fails the publish when the callback is rejected; the operator is alerted', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const fetchImpl = (async () => {
      throw new Error('callback transport down');
    }) as typeof fetch;
    const notifier = new FakeNotifier();

    const result = await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: callbackEnv,
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(fakeAdapter()),
      notifier,
      fetchImpl,
      logger: () => {},
    });

    expect(result.delivered.telegram).toHaveLength(2);
    expect(
      notifier.messages.some(
        (m) => m.target === 'operator' && m.message.includes('publish callback'),
      ),
    ).toBe(true);
  });

  it('sends no callback when a channel fails', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const { fetchImpl, calls } = capturingFetch();

    await expect(
      runPublish(payloadPath, {
        cwd: repoDir,
        root: repoDir,
        env: callbackEnv,
        now,
        mediaSource: await mediaSourceWithFixture(),
        registry: makeRegistry(new FailingAdapter()),
        notifier: new FakeNotifier(),
        fetchImpl,
        logger: () => {},
      }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(0);
  });

  it('skips the callback entirely when no callback URL is configured', async () => {
    const { repoDir, payloadPath } = await makeRepo();
    const { fetchImpl, calls } = capturingFetch();

    await runPublish(payloadPath, {
      cwd: repoDir,
      root: repoDir,
      env: {},
      now,
      mediaSource: await mediaSourceWithFixture(),
      registry: makeRegistry(fakeAdapter()),
      notifier: new FakeNotifier(),
      fetchImpl,
      logger: () => {},
    });

    expect(calls).toHaveLength(0);
  });
});
