import { CommentReplyRejectedError } from '@handmake/core';
import { expect, it, vi } from 'vitest';
import { createThreadsAdapter } from '../src';

const ctx = {
  secrets: {
    resolve: async (name: string) => (name === 'THREADS_USER_ID' ? '123' : 'private-token'),
  },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function setup(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) =>
    new URL(String(input)).searchParams.get('fields') === 'status'
      ? json({ status: 'FINISHED' })
      : handler(new URL(String(input)), init),
  );
  return {
    fetchImpl,
    comments: createThreadsAdapter({ fetchImpl, sleep: async () => {} }).comments,
  };
}
it('lists posts and filters old/own replies without sending a since query', async () => {
  const s = setup((url) => {
    if (url.pathname.endsWith('/threads'))
      return json({ data: [{ id: '10', timestamp: '2026-11-10' }] });
    expect(url.searchParams.has('since')).toBe(false);
    expect(url.searchParams.get('fields')).toContain('is_reply_owned_by_me');
    return json({
      data: [
        { id: '1', text: 'old', timestamp: '2026-11-09' },
        { id: '2', text: 'own', timestamp: '2026-11-10', is_reply_owned_by_me: true },
        { id: '3', text: 'reader', username: 'handle', timestamp: '2026-11-10' },
      ],
    });
  });
  expect(await s.comments.listPosts(25, ctx)).toEqual([{ id: '10', createdAt: '2026-11-10' }]);
  expect(await s.comments.listComments('10', new Date('2026-11-10'), ctx)).toEqual([
    { id: '3', text: 'reader', handle: 'handle', createdAt: '2026-11-10' },
  ]);
});
it('replies through a form-encoded container then publishes exactly that container', async () => {
  const s = setup((url, init) => {
    const params = new URLSearchParams(String(init?.body));
    expect(init?.method).toBe('POST');
    if (url.pathname.endsWith('/threads')) {
      expect(Object.fromEntries(params)).toEqual({
        media_type: 'TEXT',
        text: 'Danke 🧵',
        reply_to_id: '3',
      });
      return json({ id: '100' });
    }
    expect(url.pathname).toBe('/v1.0/123/threads_publish');
    expect(params.get('creation_id')).toBe('100');
    return json({ id: '101' });
  });
  expect(await s.comments.replyToComment('3', 'Danke 🧵', ctx)).toBe('101');
  expect(s.fetchImpl).toHaveBeenCalledTimes(3);
});
it.each(['network', 'server', 'malformed'])(
  'never retries an ambiguous publish (%s)',
  async (failure) => {
    const s = setup((url) => {
      if (url.pathname.endsWith('/threads')) return json({ id: '100' });
      if (failure === 'network') throw new Error('private-token reader text');
      return failure === 'server' ? json({ error: { message: 'reader text' } }, 500) : json({});
    });
    const error = await s.comments.replyToComment('3', 'Danke', ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CommentReplyRejectedError);
    expect(String(error)).not.toMatch(/private-token|reader text/);
    expect(s.fetchImpl).toHaveBeenCalledTimes(3);
  },
);
it('rejects over-budget UTF-8 text before any API call', async () => {
  const s = setup(() => json({}));
  await expect(s.comments.replyToComment('3', '🧵'.repeat(126), ctx)).rejects.toBeInstanceOf(
    CommentReplyRejectedError,
  );
  expect(s.fetchImpl).not.toHaveBeenCalled();
});
it('reports code 190 with only the token secret name and never refreshes', async () => {
  const s = setup(() => json({ error: { code: 190, message: 'private-token' } }, 400));
  await expect(s.comments.listPosts(25, ctx)).rejects.toThrow('rotate THREADS_ACCESS_TOKEN');
  expect(s.fetchImpl).toHaveBeenCalledTimes(1);
});
it('allows an explicitly rejected publish to reopen', async () => {
  const s = setup((url) =>
    url.pathname.endsWith('/threads') ? json({ id: '100' }) : json({ error: { code: 100 } }, 400),
  );
  await expect(s.comments.replyToComment('3', 'Danke', ctx)).rejects.toBeInstanceOf(
    CommentReplyRejectedError,
  );
  expect(s.fetchImpl).toHaveBeenCalledTimes(3);
});

it.each(['create', 'publish'])(
  'names only the token secret when code 190 rejects reply %s',
  async (stage) => {
    const s = setup((url) =>
      stage === 'publish' && url.pathname.endsWith('/threads')
        ? json({ id: '100' })
        : json({ error: { code: 190, message: 'private-token reader text' } }, 400),
    );
    const error = await s.comments.replyToComment('3', 'Danke', ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommentReplyRejectedError);
    expect(String(error)).toContain('rotate THREADS_ACCESS_TOKEN');
    expect(String(error)).not.toMatch(/private-token|reader text/);
    expect(s.fetchImpl).toHaveBeenCalledTimes(stage === 'create' ? 1 : 3);
  },
);

it.each([true, false])('bounds readiness polling before publish (ready: %s)', async (ready) => {
  let polls = 0;
  let publishes = 0;
  const comments = createThreadsAdapter({
    sleep: async () => {},
    statusPollMaxAttempts: 3,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('fields') === 'status') {
        polls++;
        return json({ status: ready && polls === 2 ? 'FINISHED' : 'IN_PROGRESS' });
      }
      if (url.pathname.endsWith('/threads_publish')) publishes++;
      return json({ id: '100' });
    },
  }).comments;
  if (ready) await expect(comments.replyToComment('3', 'Danke', ctx)).resolves.toBe('100');
  else
    await expect(comments.replyToComment('3', 'Danke', ctx)).rejects.toBeInstanceOf(
      CommentReplyRejectedError,
    );
  expect(polls).toBe(ready ? 2 : 3);
  expect(publishes).toBe(ready ? 1 : 0);
});
