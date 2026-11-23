import { verifyCallbackSignature } from '@handmake/core';

/**
 * Checks an internal GET signed as `method\npath?query\ntimestamp` (HMAC,
 * headers `X-Handmake-Timestamp` / `X-Handmake-Signature`, ±300 s). Fails
 * closed: a missing secret rejects everything.
 */
export async function verifySignedRequest(
  secret: string | undefined,
  request: Request,
  now: number,
): Promise<boolean> {
  const url = new URL(request.url);
  const timestamp = request.headers.get('X-Handmake-Timestamp') ?? '';
  const signature = request.headers.get('X-Handmake-Signature') ?? '';
  return (
    !!secret &&
    /^\d+$/.test(timestamp) &&
    Math.abs(now / 1000 - Number(timestamp)) <= 300 &&
    (await verifyCallbackSignature(
      secret,
      `${request.method}\n${url.pathname}${url.search}\n${timestamp}`,
      signature,
    ))
  );
}
