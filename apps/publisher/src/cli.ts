import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runDryRun } from './dry-run';

const USAGE = 'usage: publisher --dry-run <payload.json> [--root <dir>]';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = [...argv];
  if (args.shift() !== '--dry-run') {
    console.error(USAGE);
    return 2;
  }
  const payloadPath = args.shift();
  if (!payloadPath) {
    console.error(USAGE);
    return 2;
  }
  let root: string | undefined;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag !== '--root') {
      console.error(USAGE);
      return 2;
    }
    root = args.shift();
    if (!root) {
      console.error(USAGE);
      return 2;
    }
  }
  try {
    await runDryRun(payloadPath, root ? { root } : {});
    return 0;
  } catch (error) {
    console.error(`dry-run failed: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
