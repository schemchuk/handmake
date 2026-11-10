import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

const initialExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = initialExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['success', 'http', 'json', 'short', 'github', 'worker', 'worker-throw', 'network'])(
  'refresh script handles %s without logging provider data',
  async (scenario) => {
    vi.resetModules();
    vi.stubEnv('THREADS_ACCESS_TOKEN', 'old-fixture-token');
    vi.stubEnv('GH_TOKEN', 'github-fixture-token');
    vi.stubEnv('GH_REPO', 'fixture/repo');
    vi.stubEnv('CLOUDFLARE_WORKERS_TOKEN', 'worker-fixture-token');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    const mask = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => {
      if (scenario === 'network') throw new Error('old-fixture-token');
      return new Response(
        scenario === 'json'
          ? 'private-response-body'
          : JSON.stringify({
              access_token: 'new-fixture-token',
              expires_in: scenario === 'short' ? 10 : 60 * 86400,
              provider_detail: 'private-response-body',
            }),
        { status: scenario === 'http' ? 400 : 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(spawnSync).mockReset();
    vi.mocked(spawnSync).mockImplementation((command) => {
      expect(mask).toHaveBeenCalledWith('::add-mask::new-fixture-token\n');
      if (scenario === 'worker-throw' && command === 'pnpm')
        throw new Error('worker-fixture-token');
      return {
        status:
          (scenario === 'github' && command === 'gh') ||
          ((scenario === 'worker' || scenario === 'worker-throw') && command === 'pnpm')
            ? 1
            : 0,
      } as ReturnType<typeof spawnSync>;
    });
    await import('../scripts/refresh-threads-token');
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://graph.threads.com/refresh_access_token');
    expect(url.searchParams.get('grant_type')).toBe('th_refresh_token');
    expect(url.searchParams.get('access_token')).toBe('old-fixture-token');
    expect(options.redirect).toBe('error');
    if (
      scenario === 'success' ||
      scenario === 'github' ||
      scenario === 'worker' ||
      scenario === 'worker-throw'
    ) {
      expect(spawnSync).toHaveBeenCalledWith('gh', ['secret', 'set', 'THREADS_ACCESS_TOKEN'], {
        input: 'new-fixture-token',
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: 30000,
      });
    } else {
      expect(spawnSync).not.toHaveBeenCalled();
    }
    if (scenario === 'success' || scenario === 'worker' || scenario === 'worker-throw') {
      expect(spawnSync).toHaveBeenCalledTimes(2);
      expect(spawnSync).toHaveBeenNthCalledWith(
        2,
        'pnpm',
        ['--filter', '@handmake/bot', 'exec', 'wrangler', 'secret', 'put', 'THREADS_ACCESS_TOKEN'],
        expect.objectContaining({
          input: 'new-fixture-token',
          stdio: ['pipe', 'ignore', 'ignore'],
          env: expect.objectContaining({
            CLOUDFLARE_API_TOKEN: 'worker-fixture-token',
            CLOUDFLARE_ACCOUNT_ID: 'account',
          }),
        }),
      );
    }
    if (scenario === 'worker' || scenario === 'worker-throw')
      expect(error).toHaveBeenCalledWith(expect.stringContaining('copies differ'));
    if (scenario === 'success') expect(error).not.toHaveBeenCalled();
    else {
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledOnce();
    }
    const ordinaryOutput = JSON.stringify([log.mock.calls, error.mock.calls]);
    expect(ordinaryOutput).not.toMatch(/fixture-token|private-response-body/);
    expect(JSON.stringify(mask.mock.calls)).not.toContain('private-response-body');
  },
);
