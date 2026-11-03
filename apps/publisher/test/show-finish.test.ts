import { createShowClient, executeShow } from '../src/show-executor';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { expect, it, vi } from 'vitest';
import { FalShowError } from '@handmake/ai';
import { showFailureOutcome } from '../src/show-outcome';

it('classifies only the typed paid gate refusal as uncharged', () => {
  expect(showFailureOutcome(new FalShowError('disabled'))).toBe('paid-calls-disabled');
  for (const error of [
    new FalShowError('provider'),
    new Error('fal show: disabled'),
    { code: 'disabled' },
  ])
    expect(showFailureOutcome(error)).toBe('failed');
});
it('reports setup failures without dependencies or any provider secret', async () => {
  const workflow = parse(
    await readFile(new URL('../../../.github/workflows/show.yml', import.meta.url), 'utf8'),
  );
  const step = workflow.jobs.execute.steps.at(-1);
  expect(step.if).toBe('failure()');
  expect(step.env).toEqual({
    SHOW_JOB: '${{ inputs.payload }}',
    SHOW_WORKER_ORIGIN: '${{ vars.SHOW_WORKER_ORIGIN }}',
    SHOW_TRANSPORT_SECRET: '${{ secrets.SHOW_TRANSPORT_SECRET }}',
  });
  const script = step.run
    .split("<<'NODE'\n")[1]
    .split('\nNODE')[0]
    .replace(/import .*?from 'node:crypto';/, '');
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  await runInNewContext(`(async () => {${script}})()`, {
    createHash,
    createHmac,
    randomUUID,
    URL,
    AbortSignal,
    fetch,
    console,
    process: {
      env: {
        SHOW_JOB: JSON.stringify({ tenantId: 'tenant', showId: 'show', jobId: 'job', version: 0 }),
        SHOW_WORKER_ORIGIN: 'https://worker.test',
        SHOW_TRANSPORT_SECRET: 'fixture',
      },
    },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url.pathname).toBe('/internal/shows/tenant/show/job/0/next/finish');
  expect(JSON.parse(init.body)).toEqual({ outcome: 'failed' });
  const message = [
    'POST',
    url.pathname,
    init.headers['x-show-time'],
    init.headers['x-show-nonce'],
    '',
    createHash('sha256').update(init.body).digest('hex'),
  ].join('\n');
  expect(init.headers['x-show-signature']).toBe(
    createHmac('sha256', 'fixture').update(message).digest('hex'),
  );
});

it.each([false, true])(
  'keeps a successful execution green when ready notification fails (recovery=%s)',
  async (recovery) => {
    const outcomes: string[] = [];
    const client = createShowClient({
      origin: 'https://worker.test',
      secret: 'fixture',
      job: { tenantId: 'tenant', showId: 'show', jobId: 'job', version: 0 },
      fetch: async (url, init) => {
        const operation = new URL(String(url)).pathname.split('/').at(-1);
        if (operation === 'status') return Response.json({ version: 0, outputs: {}, recovery });
        if (operation === 'authorize') return Response.json({ version: 0, value: null });
        if (operation === 'finish') {
          outcomes.push(JSON.parse(new TextDecoder().decode(init!.body as Uint8Array)).outcome);
          return new Response(null, { status: 409 });
        }
        throw new Error('unexpected operation');
      },
    });
    const generateImage = vi.fn(),
      generateVideo = vi.fn();
    await expect(executeShow(client, { generateImage, generateVideo })).resolves.toBeUndefined();
    expect(outcomes).toEqual(['ready']);
    expect(generateImage).not.toHaveBeenCalled();
    expect(generateVideo).not.toHaveBeenCalled();
  },
);
