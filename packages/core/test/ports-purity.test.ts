import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Ports must stay runtime-agnostic: no network clients, SDKs or Node-only
 * modules, so the same core runs in the bot Worker and the publisher CLI.
 */
describe('ports stay pure', () => {
  const portsDir = join(import.meta.dirname, '../src/ports');
  const portFiles = readdirSync(portsDir).filter((f) => f.endsWith('.ts'));

  const importSpecifiers = (source: string): string[] => {
    const specifiers: string[] = [];
    const patterns = [/(?:import|export)[\s\S]*?from\s+'([^']+)'/g, /import\('([^']+)'\)/g];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        specifiers.push(match[1]!);
      }
    }
    return specifiers;
  };

  it('has port files to guard', () => {
    expect(portFiles.length).toBeGreaterThan(0);
  });

  for (const file of portFiles) {
    it(`${file} imports no network, SDK or Node-only module`, () => {
      const source = readFileSync(join(portsDir, file), 'utf8');
      for (const specifier of importSpecifiers(source)) {
        expect(specifier.startsWith('.')).toBe(true);
      }
      expect(source).not.toMatch(/\bfetch\(|new URL\(|node:/);
    });
  }
});
