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

it.each(['success', 'http', 'json', 'short', 'github', 'network'])(
  'refresh script handles %s without logging provider data',
  async (scenario) => {
    vi.resetModules();
    vi.stubEnv('THREADS_ACCESS_TOKEN', 'old-fixture-token');
    vi.stubEnv('GH_TOKEN', 'github-fixture-token');
    vi.stubEnv('GH_REPO', 'fixture/repo');
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
    vi.mocked(spawnSync).mockImplementation(() => {
      expect(mask).toHaveBeenCalledWith('::add-mask::new-fixture-token\n');
      return { status: scenario === 'github' ? 1 : 0 } as ReturnType<typeof spawnSync>;
    });
    await import('../scripts/refresh-threads-token');
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://graph.threads.com/refresh_access_token');
    expect(url.searchParams.get('grant_type')).toBe('th_refresh_token');
    expect(url.searchParams.get('access_token')).toBe('old-fixture-token');
    expect(options.redirect).toBe('error');
    if (scenario === 'success' || scenario === 'github') {
      expect(spawnSync).toHaveBeenCalledWith('gh', ['secret', 'set', 'THREADS_ACCESS_TOKEN'], {
        input: 'new-fixture-token',
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: 30000,
      });
    } else {
      expect(spawnSync).not.toHaveBeenCalled();
    }
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
