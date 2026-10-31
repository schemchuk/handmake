/** Log only the message, never request objects, headers or stack traces. */
export function safeErrorMessage(error: unknown, secrets: readonly (string | undefined)[] = []) {
  let message = error instanceof Error ? error.message : 'Unknown error';
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message.replace(
    /\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|\d{6,}:[\w-]+)\b/g,
    '[REDACTED]',
  );
}
