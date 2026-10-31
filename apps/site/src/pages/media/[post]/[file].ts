import type { APIRoute, GetStaticPaths } from 'astro';

import { loadSiteData } from '../../../lib/site-data';

const contentTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const getStaticPaths = (async () => {
  const data = await loadSiteData();
  return data.posts.flatMap(({ post }) =>
    post.photos.map((file) => ({
      params: { post: post.id.toLowerCase(), file },
      props: { postId: post.id, file },
    })),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { postId, file } = props as { postId: string; file: string };
  const data = await loadSiteData();
  const bytes = await data.store.readPostPhoto(data.tenant.id, postId, file);
  if (!bytes) return new Response(null, { status: 404 });
  const type = contentTypes[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
  return new Response(bytes as unknown as BodyInit, { headers: { 'Content-Type': type } });
};
