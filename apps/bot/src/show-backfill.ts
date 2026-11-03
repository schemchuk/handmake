/** Persist dispatch suppression across Worker requests, scoped to a recovery job. */
export async function dispatchShowBackfill(
  bucket: R2Bucket,
  job: { id: string; expires: number },
  dispatch: () => Promise<void>,
  now = Date.now(),
) {
  const key = `show-backfill-dispatch/v1/${job.id}`;
  const previous = await bucket.get(key);
  if (previous && Number(await previous.text()) > now) return 'running' as const;
  // A short lease suppresses concurrent refreshes; an interrupted request can retry.
  const claim = await bucket.put(key, String(now + 60_000), {
    onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' },
  });
  if (!claim) return 'running' as const;
  try {
    await dispatch();
  } catch (error) {
    await bucket.put(key, '0', { onlyIf: { etagMatches: claim.etag } });
    throw error;
  }
  await bucket.put(key, String(job.expires), { onlyIf: { etagMatches: claim.etag } });
  return 'dispatched' as const;
}
