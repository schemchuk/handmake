import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseLedger } from '@handmake/core';
import type { PublishLedger } from '@handmake/core';

/** Count completed channel entries, not remote message IDs or pending attempts. */
export function ledgerStats(ledgers: readonly PublishLedger[], tenantId: string) {
  let published = 0;
  let deliveries = 0;
  const networks = new Set<string>();
  for (const ledger of ledgers) {
    if (ledger.tenantId !== tenantId) continue;
    let completed = false;
    for (const [network, entry] of Object.entries(ledger.channels)) {
      networks.add(network);
      if (entry.status !== 'done') continue;
      deliveries++;
      completed = true;
    }
    if (completed) published++;
  }
  return { published, deliveries, networks: networks.size };
}

export function readLedgerStats(root: string, tenantId: string) {
  const dir = path.join(root, 'content/ledger');
  const ledgers = existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => parseLedger(readFileSync(path.join(dir, file), 'utf8')))
    : [];
  return ledgerStats(ledgers, tenantId);
}

export const decisionFiles = [
  ['003-publish-in-github-actions.md'],
  ['007-ports-and-adapters.md'],
  ['006-multi-tenancy.md'],
  ['004-ai-translation.md'],
  ['011-website.md', '016-site-content-and-config.md'],
];
