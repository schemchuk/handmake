import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_PUSH_ATTEMPTS = 3;
const DEFAULT_PUSH_RETRY_DELAY_MS = 5000;

export interface GitCommitter {
  /**
   * Stage and commit the given paths. Resolves true when a commit was
   * created, false when there was nothing to commit.
   */
  commit(paths: string[], message: string): Promise<boolean>;
  /**
   * Push HEAD to `origin/<ref>` with the same pull-rebase retry loop the
   * workflows use: on rejection, rebase onto the remote ref and retry.
   */
  push(ref: string): Promise<void>;
}

export interface GitCommitterOptions {
  repoDir: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable command runner (tests); resolves with stdout. */
  run?: (cmd: string, args: string[], cwd: string) => Promise<string>;
  /** Injectable sleep between push attempts (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Total push attempts per call; default 3. */
  pushAttempts?: number;
  /** Delay before a push retry; default 5000 ms. */
  pushRetryDelayMs?: number;
}

async function defaultRun(cmd: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(`${cmd} ${args[0]} failed: ${failure.message}: ${failure.stderr ?? ''}`.trim());
  }
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Commits content changes as the publisher identity (ADR 003 exception:
 * commits under `content/` only). Identity comes from PUBLISHER_GIT_NAME /
 * PUBLISHER_GIT_EMAIL, with bot defaults.
 */
export function createGitCommitter(options: GitCommitterOptions): GitCommitter {
  const run = options.run ?? defaultRun;
  const env = options.env ?? process.env;
  const git = (args: string[]): Promise<string> => run('git', args, options.repoDir);
  const attempts = options.pushAttempts ?? DEFAULT_PUSH_ATTEMPTS;
  const retryDelay = options.sleep ?? DEFAULT_SLEEP;
  const retryDelayMs = options.pushRetryDelayMs ?? DEFAULT_PUSH_RETRY_DELAY_MS;
  return {
    async commit(paths, message) {
      if (paths.length === 0) return false;
      await git(['add', '--', ...paths]);
      const status = await git(['status', '--porcelain', '--', ...paths]);
      if (status.trim() === '') return false;
      const name = env['PUBLISHER_GIT_NAME'] ?? 'handmake-publisher';
      const email = env['PUBLISHER_GIT_EMAIL'] ?? 'handmake-publisher@localhost';
      await git([
        '-c',
        `user.name=${name}`,
        '-c',
        `user.email=${email}`,
        'commit',
        '-m',
        message,
        '--',
        ...paths,
      ]);
      return true;
    },
    async push(ref) {
      for (let attempt = 1; ; attempt++) {
        await git(['pull', '--rebase', 'origin', ref]);
        try {
          await git(['push', 'origin', `HEAD:${ref}`]);
          return;
        } catch (error) {
          if (attempt >= attempts) throw error;
          await retryDelay(retryDelayMs);
        }
      }
    },
  };
}
