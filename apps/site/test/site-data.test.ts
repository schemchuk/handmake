import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRepoRoot, postsIn, readTenantConfig, visiblePosts } from '../src/lib/site-data';
import type { Post } from '@handmake/core';

function post(id: string, type: Post['type'], langs: string[]): Post {
  return {
    id,
    tenant: 't',
    date: '2026-10-27T10:00:00.000Z',
    publishAt: 'now',
    type,
    photos: [],
    channels: ['telegram'],
    versions: Object.fromEntries(langs.map((l) => [l, { provenance: 'human' as const }])),
    texts: Object.fromEntries(langs.map((l) => [l, `text ${l}`])),
  };
}

describe('visiblePosts', () => {
  const posts = [
    post('A', 'free', ['de', 'uk']),
    post('B', 'announcement', ['uk']),
    post('C', 'reminder', ['uk']),
    post('D', 'wotw-poll', ['uk']),
    post('E', 'free', ['uk']),
  ];

  it('keeps only blog posts and records their languages', () => {
    const visible = visiblePosts(posts);
    expect(visible.map((p) => p.post.id)).toEqual(['A', 'E']);
    expect(visible[0]!.languages).toEqual(['de', 'uk']);
  });

  it('lists a post only in languages it has text for', () => {
    const visible = visiblePosts(posts);
    expect(postsIn({ posts: visible }, 'de').map((p) => p.post.id)).toEqual(['A']);
    expect(postsIn({ posts: visible }, 'uk').map((p) => p.post.id)).toEqual(['A', 'E']);
  });
});

describe('tenant config lookup', () => {
  it('reads the repo tenant and finds the root from a subdirectory', () => {
    const root = findRepoRoot(__dirname);
    const tenant = readTenantConfig(root, 'faden-und-stimmung');
    expect(tenant.id).toBe('faden-und-stimmung');
    expect(tenant.site?.defaultLanguage).toBe('de');
  });

  it('asks for SITE_TENANT when several tenants exist', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'site-'));
    mkdirSync(path.join(root, 'config', 'tenants'), { recursive: true });
    writeFileSync(path.join(root, 'config', 'tenants', 'a.yaml'), '');
    writeFileSync(path.join(root, 'config', 'tenants', 'b.yaml'), '');
    expect(() => readTenantConfig(root, undefined)).toThrow(/set SITE_TENANT/);
  });
});
