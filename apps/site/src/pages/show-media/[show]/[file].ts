import type { APIRoute, GetStaticPaths } from 'astro';

import { loadSiteData } from '../../../lib/site-data';

export const getStaticPaths = (async () => {
  const data = await loadSiteData();
  return data.shows.flatMap((show) =>
    [...show.images, show.video].map(({ fileName }) => ({
      params: { show: show.id.toLowerCase(), file: fileName },
      props: { showId: show.id, fileName },
    })),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { showId, fileName } = props as { showId: string; fileName: string };
  const data = await loadSiteData();
  const bytes = await data.store.readShowMedia(data.tenant.id, showId, fileName);
  if (!bytes?.length) throw new Error(`show ${showId}: declared media ${fileName} is absent`);
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    mp4: 'video/mp4',
  };
  return new Response(bytes as unknown as BodyInit, {
    headers: { 'Content-Type': types[fileName.split('.').pop()!.toLowerCase()]! },
  });
};
