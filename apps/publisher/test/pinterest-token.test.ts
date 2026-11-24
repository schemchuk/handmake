import { spawnSync } from 'node:child_process';

import { afterEach, expect, it, vi } from 'vitest';

import { savePinterestRefreshToken } from '../src/pinterest-token';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it('masks the replacement and writes it only via stdin using the secret writer', async () => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
  await savePinterestRefreshToken('replacement', {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'owner/repo',
    SECRETS_WRITE_TOKEN: 'writer',
    PATH: '/bin',
  });
  expect(write).toHaveBeenCalledWith('::add-mask::replacement\n');
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(spawnSync).mock.invocationCallOrder[0]!,
  );
  expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
    'gh',
    ['secret', 'set', 'PINTEREST_REFRESH_TOKEN', '--repo', 'owner/repo'],
    {
      input: 'replacement',
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 30_000,
      env: { PATH: '/bin', GH_TOKEN: 'writer' },
    },
  );
});
