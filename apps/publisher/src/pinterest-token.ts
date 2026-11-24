import { spawnSync } from 'node:child_process';

export async function savePinterestRefreshToken(token: string, env: NodeJS.ProcessEnv) {
  if (env['GITHUB_ACTIONS'] === 'true') {
    const escaped = token.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    process.stdout.write(`::add-mask::${escaped}\n`);
  }
  const secretWriter = env['SECRETS_WRITE_TOKEN'];
  const repo = env['GITHUB_REPOSITORY'];
  if (!secretWriter || !repo) throw new Error('Pinterest refresh token storage is not configured');
  const result = spawnSync('gh', ['secret', 'set', 'PINTEREST_REFRESH_TOKEN', '--repo', repo], {
    input: token,
    env: { PATH: env['PATH'], GH_TOKEN: secretWriter },
    stdio: ['pipe', 'ignore', 'ignore'],
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new Error('Could not store the Pinterest refresh token');
}
