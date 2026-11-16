import { describe, expect, it } from 'vitest';

import { createGitCommitter } from '../src/git';

describe('git push', () => {
  it('aborts a stopped pull-rebase so later commits still work', async () => {
    const calls: string[] = [];
    const committer = createGitCommitter({
      repoDir: '/repo',
      env: {},
      run: async (_cmd, args) => {
        calls.push(args.join(' '));
        if (args[0] === 'pull') throw new Error('git pull failed: could not apply');
        return '';
      },
    });
    await expect(committer.push('main')).rejects.toThrow(/could not apply/);
    expect(calls).toEqual(['pull --rebase origin main', 'rebase --abort']);
  });

  it('pushes after a clean pull-rebase', async () => {
    const calls: string[] = [];
    const committer = createGitCommitter({
      repoDir: '/repo',
      env: {},
      run: async (_cmd, args) => {
        calls.push(args.join(' '));
        return '';
      },
    });
    await committer.push('main');
    expect(calls).toEqual(['pull --rebase origin main', 'push origin HEAD:main']);
  });
});
