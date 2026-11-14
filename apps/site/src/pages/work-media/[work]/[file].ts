import type { APIRoute, GetStaticPaths } from 'astro';

import { loadSiteData } from '../../../lib/site-data';

export const getStaticPaths = (async () => {
  const data = await loadSiteData();
  return data.works.flatMap((work) =>
    work.video
      ? [
          {
            params: { work: work.id.toLowerCase(), file: work.video.fileName },
            props: { workId: work.id, fileName: work.video.fileName },
          },
        ]
      : [],
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { workId, fileName } = props as { workId: string; fileName: string };
  const data = await loadSiteData();
  const bytes = await data.store.readWorkVideo(data.tenant.id, workId);
  if (!bytes?.length) throw new Error(`work ${workId}: declared video ${fileName} is absent`);
  return new Response(bytes as unknown as BodyInit, {
    headers: { 'Content-Type': 'video/mp4' },
  });
};
