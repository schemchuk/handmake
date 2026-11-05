// Only fixed application messages may cross the private show logging boundary.
const messages = new Set([
  'job unavailable',
  'invalid job',
  'job changed',
  'draft unavailable',
  'grant unavailable',
  'source changed',
  'source unavailable',
  'result unavailable',
  'stale recovery',
  'billing reconciliation required',
  'recovery is GET-only',
  'verification scope mismatch',
  'invalid receipt',
  'receipt does not match journal',
  'marked receipt changed',
  'body too large',
  'shows disabled',
  'invalid show transport configuration',
  'show generation lease lost',
  'show draft changed during generation',
  'show generation is disabled',
  'show outcome requires reconciliation; never retry the paid call',
  'show result requires reconciliation: invalid model, prompt or media',
  'show billing requires reconciliation',
  'show checkpoint slot mismatch',
  'finish explicit reconciliation before accepting output',
  'show checkpoint rejected; inspect durable state',
  'show transport rejected; resume from durable state',
  'show step bound exceeded',
  'verified raw result missing',
  'marking failed',
  'show scope mismatch',
  'show receipt mismatch',
  'show source mismatch',
  'show grant mismatch',
  'show result unavailable',
  'show grant unavailable',
  'GET recovery unavailable',
]);
const names = new Set([
  'Error',
  'TypeError',
  'SyntaxError',
  'RangeError',
  'AbortError',
  'TimeoutError',
  'FalShowError',
  'ShowStorageError',
  'ShowIncompleteCompletion',
  'ZodError',
]);

/** Never serialize stacks, causes, arbitrary upstream messages, URLs or media. */
export function showErrorDiagnostic(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const fixed =
    messages.has(message) ||
    /^fal show: (invalid-input|disabled|reconcile|provider|timeout|invalid-media)$/.test(message) ||
    /^show storage: (invalid-input|collision|corrupt|missing|storage)$/.test(message);
  const status = error instanceof Error && 'httpStatus' in error ? error.httpStatus : undefined;
  return {
    errorClass: error instanceof Error && names.has(error.name) ? error.name : 'UnknownError',
    message:
      error instanceof Error && error.name === 'ZodError'
        ? 'Schema validation failed'
        : fixed
          ? message
          : /^D1_ERROR:/.test(message)
            ? 'D1 operation failed'
            : 'Details redacted',
    ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? { httpStatus: status }
      : {}),
    ...(/\(10058\)$/.test(message) ? { storageCode: 10058 } : {}),
  };
}

/** Bounded operation names safe to include in transport diagnostics. */
export const showTransportOperations: readonly string[] = [
  'authorize',
  'checkpoint',
  'finish',
  'reserve',
  'record',
  'stored',
  'status',
  'grant',
  'recovery',
  'journal',
  'verified-put',
  'raw-put',
  'raw-get',
  'marked-put',
  'marked-get',
  'backfill-release',
  'source-0',
  'source-1',
  'source-2',
  'source-3',
];
