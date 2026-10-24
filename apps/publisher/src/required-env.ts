/** Read a required environment variable; the value itself is never logged. */
export function requiredEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value) {
    throw new Error(`missing environment variable ${name} (see .env.example)`);
  }
  return value;
}
