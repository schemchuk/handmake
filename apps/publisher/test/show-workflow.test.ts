import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
interface Job {
  needs?: string | string[];
  if?: string;
  uses?: string;
  outputs?: Record<string, string>;
  steps: Step[];
}
const workflow = parse(
  await readFile(new URL('../../../.github/workflows/publish.yml', import.meta.url), 'utf8'),
) as { concurrency: { group: string; 'cancel-in-progress': boolean }; jobs: Record<string, Job> };
const publish = workflow.jobs.publish!;
const site = workflow.jobs.site!;
const copy = workflow.jobs['copy-show']!;
const step = (job: Job, name: string) => job.steps.find((entry) => entry.name === name)!;

it('gates copies on successful publication/push and site deployment, leaving site independent of copies', () => {
  expect(workflow.concurrency).toEqual({ group: 'publish', 'cancel-in-progress': false });
  expect(site.needs).toBe('publish');
  expect(site.if).toBeUndefined();
  expect(site.uses).toBe('./.github/workflows/site.yml');
  expect(copy.needs).toEqual(['publish', 'site']);
  // No always() override: GitHub adds its default success() dependency guard.
  expect(copy.if).toBe("needs.publish.outputs.is_show == 'true'");
  expect(step(publish, 'Push published content').if).toBe('always()');
  expect(step(copy, 'Push copy progress').if).toBe('always()');
  expect(copy.steps.indexOf(step(copy, 'Push copy progress'))).toBeGreaterThan(
    copy.steps.indexOf(step(copy, 'Copy published show')),
  );
  expect(copy.steps.find((entry) => entry.uses?.startsWith('actions/checkout@'))?.with?.ref).toBe(
    'main',
  );
  expect(step(copy, 'Copy published show').run).toContain('copy-show');
  expect(step(copy, 'Copy published show').run).not.toContain('payload.json');
  expect(Object.keys(publish.outputs!)).toEqual(['is_show', 'tenant_id', 'show_id']);
});

it('passes the Meta secrets and the pre-delivery push opt-in to both delivery jobs (T26a3)', () => {
  const metaSecrets = [
    'INSTAGRAM_USER_ID',
    'INSTAGRAM_ACCESS_TOKEN',
    'META_APP_ID',
    'META_APP_SECRET',
  ];
  for (const job of [publish, copy]) {
    const env = step(job, job === publish ? 'Publish to channels' : 'Copy published show').env!;
    for (const name of metaSecrets) {
      expect(env[name], `${name} in ${job === publish ? 'publish' : 'copy-show'}`).toBe(
        `\${{ secrets.${name} }}`,
      );
    }
    expect(env['CONTENT_PUSH_BEFORE_DELIVERY']).toBe('true');
  }
});

it.each([
  ['workflow_dispatch', false, undefined, 'test'],
  ['workflow_dispatch', true, undefined, 'live'],
  ['repository_dispatch', undefined, false, 'test'],
  ['repository_dispatch', undefined, true, 'live'],
  ['repository_dispatch', undefined, 'true', 'test'],
] as const)('preserves routing for %s / %s / %s', (event, live, botLive, expected) => {
  const original = step(publish, 'Publish to channels').env!.TELEGRAM_CHANNEL_ID!;
  const expression = step(copy, 'Copy published show').env!.TELEGRAM_CHANNEL_ID!;
  expect(expression).toBe(original);
  const result = runInNewContext(expression.replace(/^\$\{\{|\}\}$/g, ''), {
    github: { event_name: event, event: { client_payload: { live: botLive } } },
    inputs: { live },
    secrets: { TELEGRAM_CHANNEL_ID: 'live', TELEGRAM_TEST_CHANNEL_ID: 'test' },
  }) as string;
  expect(result).toBe(expected);
});

it.each([
  ['show', 'main', 'faden-und-stimmung', true],
  ['show', 'feature', 'faden-und-stimmung', false],
  ['show', 'main', 'bad\nname', false],
  ['post', 'feature', 'faden-und-stimmung', true],
  ['work', 'main', 'faden-und-stimmung', true],
] as const)('executes routing shell for %s on %s (%s)', async (kind, branch, tenantId, success) => {
  const root = await mkdtemp(path.join(tmpdir(), 'handmake-show-routing-'));
  const output = path.join(root, 'output');
  try {
    await writeFile(output, '');
    await writeFile(
      path.join(root, 'payload.json'),
      JSON.stringify({ kind, tenantId, draftId: '01JBCA1B2C3D4E5F6G7H8J9K0A' }),
    );
    const result = promisify(execFile)(
      'bash',
      ['-e', '-o', 'pipefail', '-c', step(publish, 'Select show copy routing').run!],
      {
        env: { ...process.env, RUNNER_TEMP: root, GITHUB_OUTPUT: output, GITHUB_REF_NAME: branch },
      },
    );
    if (success) await result;
    else await expect(result).rejects.toThrow();
    const routing = await readFile(output, 'utf8');
    if (success && kind === 'show') {
      expect(routing).toBe(
        'tenant_id=faden-und-stimmung\nshow_id=01JBCA1B2C3D4E5F6G7H8J9K0A\nis_show=true\n',
      );
    } else expect(routing).not.toContain('is_show=true');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
