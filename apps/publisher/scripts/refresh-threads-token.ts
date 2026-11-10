import { spawnSync } from 'node:child_process';
import { parseThreadsRefresh } from '../src/threads-token';

let repositoryUpdated = false;
try {
  const current = process.env['THREADS_ACCESS_TOKEN'];
  if (
    !current ||
    !process.env['GH_TOKEN'] ||
    !process.env['GH_REPO'] ||
    !process.env['CLOUDFLARE_WORKERS_TOKEN'] ||
    !process.env['CLOUDFLARE_ACCOUNT_ID']
  ) {
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
  repositoryUpdated = true;
  const worker = spawnSync(
    'pnpm',
    ['--filter', '@handmake/bot', 'exec', 'wrangler', 'secret', 'put', 'THREADS_ACCESS_TOKEN'],
    {
      input: token,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 30000,
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: process.env['CLOUDFLARE_WORKERS_TOKEN'],
      },
    },
  );
  if (worker.error || worker.status !== 0) {
    console.error('Threads token copies differ: repository updated, Worker update failed.');
    process.exitCode = 1;
  } else console.log('Threads token refreshed; repository and Worker secrets updated.');
} catch {
  console.error(
    repositoryUpdated
      ? 'Threads token copies differ: repository updated, Worker update failed.'
      : 'Threads token refresh failed; inspect configuration and token validity.',
  );
  process.exitCode = 1;
}
