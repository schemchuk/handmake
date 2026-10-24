import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runDryRun } from './dry-run';
import { runPublish } from './publish';

const USAGE = [
  'usage: publisher --dry-run <payload.json> [--root <dir>]',
  '       publisher publish <payload.json> [--root <dir>]',
].join('\n');

function parseRoot(args: string[]): string | undefined | null {
  let root: string | undefined;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag !== '--root') return null;
    root = args.shift();
    if (!root) return null;
  }
  return root;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = [...argv];
  const command = args.shift();
  if (command !== '--dry-run' && command !== 'publish') {
    console.error(USAGE);
    return 2;
  }
  const payloadPath = args.shift();
  if (!payloadPath) {
    console.error(USAGE);
    return 2;
  }
  const root = parseRoot(args);
  if (root === null) {
    console.error(USAGE);
    return 2;
  }
  try {
    if (command === '--dry-run') {
      await runDryRun(payloadPath, root ? { root } : {});
    } else {
      await runPublish(payloadPath, root ? { root } : {});
    }
    return 0;
  } catch (error) {
    console.error(
      `${command === 'publish' ? 'publish' : 'dry-run'} failed: ${(error as Error).message}`,
    );
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
