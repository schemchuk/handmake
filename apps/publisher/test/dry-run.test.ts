import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderTelegram } from '@handmake/channels';
import { parsePost, TenantConfigError } from '@handmake/core';
import { FakeMediaSource } from '@handmake/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { runDryRun } from '../src/dry-run';
import type { DispatchPayload } from '../src/payload';

const realTenantConfig = fileURLToPath(
  new URL('../../../config/tenants/faden-und-stimmung.yaml', import.meta.url),
);
const jpegFixturePath = fileURLToPath(new URL('./fixtures/with-gps-exif.jpg', import.meta.url));

const now = new Date('2026-10-24T10:00:00.000Z');
const postId = '01JDRYRNT000000000000000BC';

const basePayload: DispatchPayload = {
  tenantId: 'faden-und-stimmung',
  draftId: 'draft-1',
  type: 'free',
  texts: { uk: 'Тестовий допис (T09).', de: 'Testbeitrag (T09).' },
  fileIds: ['file-1', 'file-2'],
  provenance: 'human',
};

const tmpDirs: string[] = [];
async function freshDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A throwaway repo: only config/tenants copied from the real repo. */
async function makeRepoDir(): Promise<string> {
  const repoDir = await freshDir('handmake-dry-run-repo-');
  await mkdir(path.join(repoDir, 'config', 'tenants'), { recursive: true });
  await copyFile(
    realTenantConfig,
    path.join(repoDir, 'config', 'tenants', path.basename(realTenantConfig)),
  );
  return repoDir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runDryRun', () => {
  it('builds the post folder, renders the ops and writes nothing outside the temp dir', async () => {
    const repoDir = await makeRepoDir();
    const cwd = await freshDir('handmake-dry-run-cwd-');
    const tempDir = await freshDir('handmake-dry-run-store-');
    const payloadDir = await freshDir('handmake-dry-run-payload-');
    const payloadPath = path.join(payloadDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(basePayload));

    const jpegFixture = new Uint8Array(await readFile(jpegFixturePath));
    const mediaSource = new FakeMediaSource();
    mediaSource.photos.set('file-1', jpegFixture);
    mediaSource.photos.set('file-2', jpegFixture);
    const lines: string[] = [];

    const result = await runDryRun(payloadPath, {
      cwd,
      root: repoDir,
      tempDir,
      mediaSource,
      env: {},
      now,
      newId: () => postId,
      logger: (line) => lines.push(line),
    });

    const expectedPost = {
      id: postId,
      date: '2026-10-24T10:00:00.000Z',
      publishAt: 'now' as const,
      type: 'free' as const,
      tenant: 'faden-und-stimmung',
      channels: ['telegram'],
      photos: ['photo-1.jpg', 'photo-2.jpg'],
      versions: { uk: { provenance: 'human' as const }, de: { provenance: 'human' as const } },
      texts: basePayload.texts,
    };
    const expectedOps = renderTelegram(expectedPost, {
      channelId: 'TELEGRAM_CHANNEL_ID',
      languages: ['uk', 'de'],
    });

    expect(result.post).toEqual(expectedPost);
    expect(result.ops).toEqual(expectedOps);
    expect(result.photoCount).toBe(2);
    expect(result.postDir).toBe(
      path.join(tempDir, 'content', 'posts', `2026-10-24-${postId.toLowerCase()}`),
    );

    // The saved folder validates with parsePost and holds both photos,
    // normalised by processPhoto: valid JPEGs with EXIF stripped.
    const markdown = await readFile(path.join(result.postDir, 'index.md'), 'utf8');
    expect(parsePost(markdown)).toEqual(expectedPost);
    for (const name of ['photo-1.jpg', 'photo-2.jpg']) {
      const data = await readFile(path.join(result.postDir, name));
      const meta = await sharp(data).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
    }

    // Nothing was written to the cwd (payload lives outside it).
    expect(await readdir(cwd)).toEqual([]);

    // The log mentions the planned ops.
    const output = lines.join('\n');
    for (const op of expectedOps) {
      expect(output).toContain(JSON.stringify(op));
    }
    expect(output).toContain('dry-run: nothing was delivered');
  });

  it('needs no media source or bot token when there are no fileIds', async () => {
    const repoDir = await makeRepoDir();
    const cwd = await freshDir('handmake-dry-run-cwd-');
    const tempDir = await freshDir('handmake-dry-run-store-');
    const payloadDir = await freshDir('handmake-dry-run-payload-');
    const payloadPath = path.join(payloadDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify({ ...basePayload, fileIds: [] }));

    const lines: string[] = [];
    const result = await runDryRun(payloadPath, {
      cwd,
      root: repoDir,
      tempDir,
      env: {},
      now,
      newId: () => postId,
      logger: (line) => lines.push(line),
    });

    expect(result.photoCount).toBe(0);
    expect(result.post.photos).toEqual([]);
    expect(result.ops).toEqual(
      renderTelegram(
        {
          id: postId,
          date: '2026-10-24T10:00:00.000Z',
          publishAt: 'now',
          type: 'free',
          tenant: 'faden-und-stimmung',
          channels: ['telegram'],
          photos: [],
          versions: { uk: { provenance: 'human' }, de: { provenance: 'human' } },
          texts: basePayload.texts,
        },
        { channelId: 'TELEGRAM_CHANNEL_ID', languages: ['uk', 'de'] },
      ),
    );
    expect(lines.join('\n')).toContain('photos: 0');
    expect(await readdir(cwd)).toEqual([]);
  });

  it('rejects an unknown tenant id', async () => {
    const repoDir = await makeRepoDir();
    const cwd = await freshDir('handmake-dry-run-cwd-');
    const payloadDir = await freshDir('handmake-dry-run-payload-');
    const payloadPath = path.join(payloadDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify({ ...basePayload, tenantId: 'no-such-tenant' }));

    await expect(
      runDryRun(payloadPath, { cwd, root: repoDir, env: {}, logger: () => {} }),
    ).rejects.toThrow(TenantConfigError);
  });
});
