import { FalShowError } from '@handmake/ai';

/** Only the adapter's typed gate refusal is safe to describe as uncharged. */
export function showFailureOutcome(error: unknown): 'paid-calls-disabled' | 'failed' {
  return error instanceof FalShowError && error.code === 'disabled'
    ? 'paid-calls-disabled'
    : 'failed';
}
