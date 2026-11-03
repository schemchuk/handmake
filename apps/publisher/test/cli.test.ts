import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/copy-show', () => ({ runCopyShow: vi.fn() }));
vi.mock('../src/publish', () => ({ runPublish: vi.fn() }));
vi.mock('../src/dry-run', () => ({ runDryRun: vi.fn() }));
import { main } from '../src/cli';
import { runCopyShow } from '../src/copy-show';
import { runPublish } from '../src/publish';
import { runDryRun } from '../src/dry-run';

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it('routes stable tenant/show identity and checkout to the separate copy command', async () => {
  expect(await main(['copy-show', 'tenant', 'show', '--root', '/tmp/checkout'])).toBe(0);
  expect(runCopyShow).toHaveBeenCalledWith(
    'tenant',
    'show',
    expect.objectContaining({ root: '/tmp/checkout' }),
  );
  expect(runPublish).not.toHaveBeenCalled();
  expect(runDryRun).not.toHaveBeenCalled();
});
it.each([
  ['copy-show'],
  ['copy-show', 'tenant'],
  ['copy-show', 'tenant', 'show', '--root'],
  ['copy-show', 'tenant', 'show', '--bad'],
])('rejects incomplete or invalid arguments %j', async (...args) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await main(args)).toBe(2);
  expect(runCopyShow).not.toHaveBeenCalled();
});
it('returns a failure status when copying fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(runCopyShow).mockRejectedValueOnce(new Error('copy failed'));
  expect(await main(['copy-show', 'tenant', 'show'])).toBe(1);
});
