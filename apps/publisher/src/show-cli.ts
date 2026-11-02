import { readFile } from 'node:fs/promises';
import { parseTenantConfig } from '@handmake/core';
import { FalShowGenerator } from '@handmake/ai';
import { createShowClient, executeShow } from './show-executor';

try {
  const payload = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
  const client = createShowClient({
    origin: process.env['SHOW_WORKER_ORIGIN'] ?? '',
    secret: process.env['SHOW_TRANSPORT_SECRET'] ?? '',
    job: payload,
  });
  const config = parseTenantConfig(
    await readFile(`../../config/tenants/${client.job.tenantId}.yaml`, 'utf8'),
  );
  if (!config.shows) throw new Error('shows disabled');
  const generator = new FalShowGenerator({
    apiKey: process.env['FAL_KEY'] ?? '',
    journal: client.journal,
    config: () => config.shows!,
    // Dispatch is never permission to spend. Both gates default to closed.
    allowPaidCalls: process.env['SHOW_ALLOW_PAID_CALLS'] === 'true',
    verifiedModels: JSON.parse(process.env['SHOW_VERIFIED_MODELS'] || '[]'),
    maxPolls: 600,
  });
  await executeShow(client, generator);
} catch {
  console.error('Show execution stopped; inspect durable state before resuming.');
  process.exitCode = 1;
}
