import { isUlid } from './post';
import type { Post } from './post';
import type { TenantConfig } from './tenant';
import { signCallbackBody } from './published-callback';

export type EntryNames = Record<string, string | null>;
export const contestNamesPath = '/internal/contest-names';

export class EntryPlaceholderError extends Error {
  constructor() {
    super('Invalid entry placeholder');
    this.name = 'EntryPlaceholderError';
  }
}

/** Reject broken reserved tokens without echoing their contents. Order defines work numbers. */
export function entryReferences(text: string): string[] {
  const ids: string[] = [];
  const remainder = text.replace(/\{entry:([^{}]*)\}/g, (_, id: string) => {
    if (!isUlid(id)) throw new EntryPlaceholderError();
    ids.push(id);
    return '';
  });
  if (/\{entry\b/i.test(remainder)) throw new EntryPlaceholderError();
  return [...new Set(ids)];
}

export function resolveEntryNames(
  text: string,
  names: EntryNames,
  policy: boolean,
  order?: string[],
): string {
  const references = entryReferences(text);
  const numbered = order ?? references;
  return text.replace(/\{entry:([^{}]*)\}/g, (_, id: string) =>
    policy && names[id] ? names[id]! : `Work No ${numbered.indexOf(id) + 1}`,
  );
}

export function postEntryReferences(post: Pick<Post, 'texts' | 'poll'>): string[] {
  return [
    ...new Set(
      [
        ...Object.values(post.texts),
        ...(post.poll ? [post.poll.question, ...post.poll.options] : []),
      ].flatMap(entryReferences),
    ),
  ];
}

/** Resolved projections must never be passed back to a content store. */
export function resolvePostEntryNames(post: Post, names: EntryNames, allow: boolean): Post {
  const order = postEntryReferences(post);
  const resolve = (text: string) => resolveEntryNames(text, names, allow, order);
  return {
    ...post,
    texts: Object.fromEntries(Object.entries(post.texts).map(([k, v]) => [k, resolve(v)])),
    ...(post.poll
      ? { poll: { question: resolve(post.poll.question), options: post.poll.options.map(resolve) } }
      : {}),
  };
}

export function entryNamesAllowed(tenant: TenantConfig, channel: string): boolean {
  return channel === 'telegram' && tenant.entryNamePolicy?.telegram === true;
}

/** Sign the exact path AND query, including tenant and IDs; timestamp is epoch seconds. */
export function signNamesRequest(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
): Promise<string> {
  return signCallbackBody(secret, `${method}\n${path}\n${timestamp}`);
}
