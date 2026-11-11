import { contestNamesPath, signNamesRequest } from '@handmake/core';
import type { EntryNames } from '@handmake/core';

/** Mask immediately, before inspecting or rendering any name-bearing response. */
export async function fetchEntryNames(
  tenant: string,
  ids: string[],
  options: {
    env: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    logger: (line: string) => void;
    now?: Date;
  },
): Promise<EntryNames> {
  if (!ids.length) return {};
  try {
    const secret = options.env.NAMES_ENDPOINT_SECRET;
    if (!secret || !options.env.PUBLISH_CALLBACK_URL) throw new Error();
    const url = new URL(contestNamesPath, options.env.PUBLISH_CALLBACK_URL);
    if (url.protocol !== 'https:') throw new Error();
    url.searchParams.set('tenant', tenant);
    url.searchParams.set('ids', ids.join(','));
    const timestamp = String(Math.floor((options.now ?? new Date()).getTime() / 1000));
    const signature = await signNamesRequest(secret, 'GET', url.pathname + url.search, timestamp);
    const response = await (options.fetchImpl ?? fetch)(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'X-Handmake-Timestamp': timestamp,
        'X-Handmake-Signature': signature,
      },
    });
    if (!response.ok) throw new Error();
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
    for (const value of Object.values(raw))
      if (typeof value === 'string' && value)
        options.logger(
          `::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`,
        );
    const names: EntryNames = {};
    for (const id of ids) {
      const value: unknown = (raw as Record<string, unknown>)[id];
      if (
        value !== null &&
        (typeof value !== 'string' || !value.trim() || Array.from(value).length > 30)
      )
        throw new Error();
      names[id] = value as string | null;
    }
    return names;
  } catch {
    throw new Error('Contest names fetch failed');
  }
}
