import type { APIRoute, GetStaticPaths } from 'astro';

import { loadSiteData } from '../../../../lib/site-data';

export const getStaticPaths = (async () => {
  const data = await loadSiteData();
  return [...data.workImages].flatMap(([key, image]) => {
    const [id, file] = key.split('/');
    return image.variants.map((variant) => ({
      params: { work: id!.toLowerCase(), file, variant: `${variant.width}.webp` },
      props: { key, width: variant.width },
    }));
  });
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const data = await loadSiteData();
  const variant = data.workImages
    .get(props.key)
    ?.variants.find((image) => image.width === props.width);
  if (!variant) return new Response(null, { status: 404 });
  return new Response(variant.bytes as unknown as BodyInit, {
    headers: { 'Content-Type': 'image/webp' },
  });
};
