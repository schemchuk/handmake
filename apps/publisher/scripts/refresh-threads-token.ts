import { spawnSync } from 'node:child_process';
import { parseThreadsRefresh } from '../src/threads-token';

try {
  const current = process.env['THREADS_ACCESS_TOKEN'];
  if (!current || !process.env['GH_TOKEN'] || !process.env['GH_REPO']) {
    throw new Error('Missing configuration');
  }
  const url = new URL('https://graph.threads.com/refresh_access_token');
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', current);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error('HTTP failure');
  const data: unknown = await response.json();
  // Mask before validation or any subsequent operation can fail.
  const candidate = (data as { access_token?: unknown } | null)?.access_token;
  if (typeof candidate === 'string') {
    const escaped = candidate
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A');
    process.stdout.write(`::add-mask::${escaped}\n`);
  }
  const token = parseThreadsRefresh(data);
  const result = spawnSync('gh', ['secret', 'set', 'THREADS_ACCESS_TOKEN'], {
    input: token,
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 30000,
  });
  if (result.error || result.status !== 0) throw new Error('Secret update failed');
  console.log('Threads token refreshed and repository secret updated.');
} catch {
  console.error('Threads token refresh failed; inspect configuration and token validity.');
  process.exitCode = 1;
}
