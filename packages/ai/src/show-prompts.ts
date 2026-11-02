import type { ShowImageRequest } from '@handmake/core';

/** Versioned independently of provider/model identifiers; changing text needs a new version. */
export function showImagePrompt(request: ShowImageRequest): string {
  if (request.promptVersion !== `show-${request.template}@1`)
    throw new Error('unsupported show prompt version');
  const look = request.persona?.model.look;
  const scenes = {
    worn: `Photograph of ${look} wearing the garment from the reference photo, standing in soft daylight, plain neutral background.`,
    closeup: `Close-up photograph of ${look} holding or wearing the item from the reference photo, shallow depth of field, natural light.`,
    interior:
      'Interior photograph of a bright, calm living space showing the item from the reference photo in place (sofa, wall).',
  };
  return [
    scenes[request.template],
    'The first reference images show the real work. Preserve its cut, colours and every embroidered motif exactly; do not add, remove, rearrange or restyle embroidery.',
    request.persona
      ? 'The final reference shows a fictional adult model; use it only for the person, never as a replacement for the work.'
      : 'The item stays identical to the reference.',
  ].join(' ');
}

export function showVideoPrompt(version: string): string {
  if (version !== 'show-video@1') throw new Error('unsupported show prompt version');
  return 'Slow, gentle camera movement and small natural movement where a person is present; the real item, garment and embroidery do not change.';
}
