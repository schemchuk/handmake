import { newsletterFormAction } from './newsletter';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Work } from '@handmake/core';
import { GitRepoContentStore } from '@handmake/stores';
import sharp from 'sharp';

import { findRepoRoot, readTenantConfig } from '../../src/lib/site-data';

export const ids = {
  a: '01JBCA1B2C3D4E5F6G7H8J9K0A',
  b: '01JBCA1B2C3D4E5F6G7H8J9K0B',
  c: '01JBCA1B2C3D4E5F6G7H8J9K0C',
  foreign: '01JBCA1B2C3D4E5F6G7H8J9K0Z',
};
export async function createPortfolioFixture() {
  // Astro renames prerender assets, so output must share the site's filesystem.
  const cache = path.resolve(import.meta.dirname, '../../node_modules/.cache');
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'portfolio-'));
  const tenant = readTenantConfig(findRepoRoot(import.meta.dirname), 'faden-und-stimmung');
  tenant.id = 'fixture';
  tenant.site!.baseUrl = 'https://example.invalid';
  delete tenant.site!.profiles;
  delete tenant.site!.circle;
  delete tenant.site!.groupUrl;
  tenant.site!.newsletter = { formAction: newsletterFormAction };
  await mkdir(path.join(root, 'config/tenants'), { recursive: true });
  await writeFile(path.join(root, 'config/tenants/fixture.yaml'), JSON.stringify(tenant));
  await cp(
    path.join(findRepoRoot(import.meta.dirname), 'docs/legal'),
    path.join(root, 'docs/legal'),
    { recursive: true },
  );
  const store = new GitRepoContentStore({ rootDir: root });
  // Structural image fixtures only; never copied into real content or claimed as handmade items.
  const original = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: '#955341' },
  })
    .withMetadata()
    .jpeg({ quality: 95 })
    .toBuffer();
  const secondary = await sharp({
    create: { width: 1000, height: 1400, channels: 3, background: '#727765' },
  })
    .png()
    .toBuffer();
  const versions = (label: string) => ({
    de: {
      title: `DE ${label}`,
      description: `DE ${label} description`,
      provenance: 'human' as const,
    },
    uk: {
      title: `UA ${label}`,
      description: `UA ${label} description`,
      provenance: 'human' as const,
    },
  });
  await store.saveCollection({
    tenant: 'fixture',
    slug: 'first',
    order: 0,
    versions: versions('first'),
    cover: { workId: ids.a, fileName: 'a.jpg' },
  });
  await store.saveCollection({
    tenant: 'fixture',
    slug: 'second',
    order: 1,
    versions: { uk: versions('second').uk },
    cover: { workId: ids.b, fileName: 'a.jpg' },
  });
  for (const [key, id] of Object.entries(ids)) {
    const work: Work = {
      id,
      tenant: key === 'foreign' ? 'other' : 'fixture',
      date: key === 'a' ? '2026-11-03T10:00:00Z' : '2026-11-01T10:00:00Z',
      kind: 'worn',
      collection: key === 'b' ? 'second' : 'first',
      photos: key === 'a' ? ['a.jpg', 'b.png'] : ['a.jpg'],
      versions: {
        ...(key !== 'b'
          ? {
              de: {
                description: `DE fixture ${key}\n\nLiteral <b>fixture</b> text.`,
                provenance: 'ai-generated' as const,
              },
            }
          : {}),
        uk: {
          description: `UA fixture ${key}\n\nSecond fixture paragraph.`,
          provenance: 'ai-assisted',
        },
      },
    };
    await store.saveWork(work, [
      { fileName: 'a.jpg', data: original },
      ...(key === 'a' ? [{ fileName: 'b.png', data: secondary }] : []),
    ]);
  }
  return { root, dist: path.join(root, 'dist'), store, original, tenant };
}
