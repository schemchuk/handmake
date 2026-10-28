import { signCallbackBody } from '@handmake/core';
import type { PublishedCallbackBody } from '@handmake/core';

/**
 * Publisher → bot "post is published" callback (architecture 4.3, T19).
 * The sender and the Worker's verifier share `signCallbackBody` from core,
 * so the HMAC always matches; the body is serialized once and the exact same
 * string is signed and sent.
 */

export const callbackSignatureHeader = 'X-Handmake-Signature';

export interface PublishCallbackSender {
  send(body: PublishedCallbackBody): Promise<void>;
}

/**
 * POSTs the body to the callback URL with the HMAC-SHA256 signature header.
 * Throws on a rejected request or a non-2xx response; the caller turns that
 * into an operator alert, never a publish failure.
 */
export function createPublishCallbackSender(options: {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
}): PublishCallbackSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async send(body: PublishedCallbackBody): Promise<void> {
      const rawBody = JSON.stringify(body);
      const signature = await signCallbackBody(options.secret, rawBody);
      const response = await fetchImpl(options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [callbackSignatureHeader]: signature,
        },
        body: rawBody,
      });
      if (!response.ok) {
        throw new Error(`callback returned HTTP ${response.status}`);
      }
    },
  };
}
