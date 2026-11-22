// One-off local helper (H19/T78): get a YouTube refresh token for the brand channel.
// Usage: pnpm -C apps/publisher exec tsx scripts/youtube-auth.ts <client_secret_*.json>
// The JSON is the "Desktop app" OAuth client downloaded from Google Cloud. The refresh token
// is printed once to this terminal and never written to disk.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const scope = 'https://www.googleapis.com/auth/youtube.upload';
const base64url = (bytes: Buffer) => bytes.toString('base64url');

const file = process.argv[2];
if (!file) throw new Error('Usage: tsx scripts/youtube-auth.ts <client_secret_*.json>');
const parsed = JSON.parse(await readFile(file, 'utf8')) as {
  installed?: { client_id?: string; client_secret?: string };
};
const clientId = parsed.installed?.client_id;
const clientSecret = parsed.installed?.client_secret;
if (!clientId || !clientSecret) throw new Error('Not a "Desktop app" OAuth client JSON');

const state = base64url(randomBytes(24));
const verifier = base64url(randomBytes(48));
const challenge = base64url(createHash('sha256').update(verifier).digest());

const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
auth.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope,
  access_type: 'offline',
  prompt: 'consent',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

console.log('\nOpen this link, sign in with the BRAND account and allow access:\n');
console.log(auth.toString() + '\n');
execFile('xdg-open', [auth.toString()], () => {});

const code = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('No answer within 10 minutes')), 600_000);
  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);
    const value = url.searchParams.get('code');
    const ok = !!value && url.searchParams.get('state') === state;
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Готово, вікно можна закрити.' : 'Помилка входу, дивись термінал.');
    if (!ok) return; // ignore stray requests such as /favicon.ico
    clearTimeout(timer);
    resolve(value);
  });
});
server.close();

const response = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  }),
});
const token = (await response.json()) as { refresh_token?: string; error?: string };
if (!response.ok || !token.refresh_token) {
  throw new Error(`Token exchange failed: HTTP ${response.status} ${token.error ?? ''}`);
}
console.log(
  'Refresh token (store as GitHub Secret YOUTUBE_REFRESH_TOKEN, then clear the terminal):\n',
);
console.log(token.refresh_token + '\n');
