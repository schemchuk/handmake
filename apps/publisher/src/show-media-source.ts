import type { ShowMediaSource } from '@handmake/core';
import { TelegramMediaSource } from './photos/telegram-media-source';
import { requiredEnv } from './required-env';

/** Resolve only the current publication's private objects; never accept arbitrary URLs. */
export function createPublicationMediaSource(
  tenant: string,
  show: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): ShowMediaSource {
  return {
    async fetchMedia(ref) {
      if (!ref.startsWith('show-'))
        return new TelegramMediaSource({
          token: requiredEnv('TELEGRAM_BOT_TOKEN', env),
          fetchImpl,
        }).fetchMedia(ref);
      const match =
        /^show-(authentic|marked):v1:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]{1,128})$/.exec(
          ref,
        );
      if (
        !match ||
        match[2] !== tenant ||
        match[3] !== show ||
        (match[1] === 'authentic' && !/^[a-f0-9]{64}$/.test(match[4]!))
      )
        throw new Error('Invalid private show media scope');
      const account = requiredEnv('CLOUDFLARE_ACCOUNT_ID', env);
      if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('Invalid media account');
      const key = `show-${match[1]}/v1/${tenant}/${show}/${match[4]}`;
      try {
        const response = await fetchImpl(
          `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/handmake-show/objects/${key}`,
          {
            headers: { Authorization: `Bearer ${requiredEnv('CLOUDFLARE_API_TOKEN', env)}` },
            redirect: 'error',
            signal: AbortSignal.timeout(90_000),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error();
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 20_000_000) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(value);
        }
        if (!size) throw new Error();
        return Buffer.concat(chunks);
      } catch {
        throw new Error('Private show media unavailable; resend expired authentic media');
      }
    },
  };
}
