/** Never include the provider response in errors: it contains credentials. */
export function parseThreadsRefresh(value: unknown): string {
  const data = value as Record<string, unknown> | null;
  if (
    !data ||
    data['error'] !== undefined ||
    typeof data['access_token'] !== 'string' ||
    !/^[A-Za-z0-9._~-]+$/.test(data['access_token']) ||
    typeof data['expires_in'] !== 'number' ||
    !Number.isSafeInteger(data['expires_in']) ||
    data['expires_in'] < 50 * 86400
  ) {
    throw new Error('Threads refresh returned an invalid token or expiry');
  }
  return data['access_token'];
}
