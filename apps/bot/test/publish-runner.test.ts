import type { PublishJob } from '@handmake/core';
import { describe, expect, it, vi } from 'vitest';

import { createGitHubActionsRunner } from '../src/publish-runner';

const job: PublishJob = {
  tenantId: 'faden-und-stimmung',
  postId: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  kind: 'post',
  type: 'free',
  texts: { uk: 'Привіт!', de: 'Hallo!' },
  fileIds: ['file-1', 'file-2'],
  provenance: 'ai-assisted',
};

function mockFetch(status: number, body = ''): ReturnType<typeof vi.fn> {
  // 204 means "no content": undici rejects a Response that pairs it with a body.
  return vi.fn(async () =>
    status === 204 ? new Response(null, { status }) : new Response(body, { status }),
  ) as unknown as ReturnType<typeof vi.fn>;
}

describe('createGitHubActionsRunner', () => {
  it('sends repository_dispatch with the payload mirrored 1:1', async () => {
    const fetchImpl = mockFetch(204);
    const runner = createGitHubActionsRunner({
      repo: 'owner/repo',
      token: 'secret-token',
      live: true,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await runner.run(job);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/owner/repo/dispatches');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-token');
    expect(headers['Accept']).toBe('application/vnd.github+json');
    expect(headers['User-Agent']).toBe('handmake-bot');
    expect(JSON.parse(init.body as string)).toEqual({
      event_type: 'publish-post',
      client_payload: {
        tenantId: job.tenantId,
        draftId: job.postId,
        kind: 'post',
        type: 'free',
        texts: job.texts,
        fileIds: job.fileIds,
        provenance: job.provenance,
        live: true,
      },
    });
  });

  it('mirrors kind, type and poll of a wotw-poll job (T25)', async () => {
    const fetchImpl = mockFetch(204);
    const runner = createGitHubActionsRunner({
      repo: 'owner/repo',
      token: 'secret-token',
      live: true,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const pollJob: PublishJob = {
      ...job,
      type: 'wotw-poll',
      poll: { question: 'Яка робота тижня?', options: ['1. Ваза', '2. Шаль'] },
    };

    await runner.run(pollJob);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string)['client_payload'] as Record<string, unknown>;
    expect(payload['kind']).toBe('post');
    expect(payload['type']).toBe('wotw-poll');
    expect(payload['poll']).toEqual({ question: 'Яка робота тижня?', options: ['1. Ваза', '2. Шаль'] });
  });

  it('carries live=false as long as the PUBLISH_LIVE var stays off', async () => {
    const fetchImpl = mockFetch(204);
    const runner = createGitHubActionsRunner({
      repo: 'owner/repo',
      token: 'secret-token',
      live: false,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await runner.run(job);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).client_payload['live']).toBe(false);
  });

  it('a non-204 response rejects without ever mentioning the token', async () => {
    const fetchImpl = mockFetch(403, '{"message":"Resource not accessible"}');
    const runner = createGitHubActionsRunner({
      repo: 'owner/repo',
      token: 'secret-token',
      live: false,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const failure = await runner.run(job).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain('403');
    expect(message).toContain('Resource not accessible');
    expect(message).not.toContain('secret-token');
  });

  it('a network error rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const runner = createGitHubActionsRunner({
      repo: 'owner/repo',
      token: 'secret-token',
      live: false,
      fetchImpl,
    });

    await expect(runner.run(job)).rejects.toThrowError(/fetch failed/);
  });
});
