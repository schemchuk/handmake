import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitCommitter {
  /**
   * Stage and commit the given paths. Resolves true when a commit was
   * created, false when there was nothing to commit.
   */
  commit(paths: string[], message: string): Promise<boolean>;
}

export interface GitCommitterOptions {
  repoDir: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable command runner (tests); resolves with stdout. */
  run?: (cmd: string, args: string[], cwd: string) => Promise<string>;
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

/**
 * Commits content changes as the publisher identity (ADR 003 exception:
 * commits under `content/` only). Identity comes from PUBLISHER_GIT_NAME /
 * PUBLISHER_GIT_EMAIL, with bot defaults.
 */
export function createGitCommitter(options: GitCommitterOptions): GitCommitter {
  const run = options.run ?? defaultRun;
  const env = options.env ?? process.env;
  const git = (args: string[]): Promise<string> => run('git', args, options.repoDir);
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
  };
}
