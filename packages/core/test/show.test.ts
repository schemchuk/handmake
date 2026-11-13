import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
  parseTenantConfig,
  parseShow,
  serializeShow,
  selectShowTemplate,
  showConfigSchema,
  showSchema,
  showPublicationSchema,
  tenantConfigSchema,
} from '../src';
import type { Show, ShowConfig, ShowGenerator } from '../src';

const model = {
  id: 'studio-one',
  name: 'Studio One',
  look: 'Fictional adult with short brown hair',
  referenceImage: 'models/studio-one.webp',
  fictional: true as const,
  adult: true as const,
};
const config: ShowConfig = {
  models: [model],
  image: { model: 'image-edit-v1', eurPerImage: 0.1 },
  video: { model: 'image-to-video-v1', eurPerSecond: 0.08 },
};
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
function show(): Show {
  const metadata = {
    provenance: 'ai-generated' as const,
    model: 'image-edit-v1',
    promptVersion: 'worn@1',
    callId: 'image-call',
    marker: {
      visible: 'KI-generiertes Model' as const,
      machineReadable: { format: 'xmp', value: 'trainedAlgorithmicMedia' },
    },
  };
  return {
    id,
    tenant: 'faden-und-stimmung',
    date: '2026-11-01T12:00:00Z',
    workId: id,
    template: 'worn',
    model: structuredClone(model),
    provenance: 'ai-assisted',
    originals: [{ fileName: 'original.jpg', provenance: 'human' }],
    images: [1, 2, 3].map((i) => ({
      ...metadata,
      fileName: `image-${i}.webp`,
      callId: `call-${i}`,
    })),
    video: { ...metadata, fileName: 'clip.mp4', model: 'video-v1', durationSeconds: 5 },
    versions: { de: { description: 'A studio show.', provenance: 'human' } },
  };
}
const tenant = () =>
  parseTenantConfig(
    readFileSync(
      join(import.meta.dirname, '../../../config/tenants/faden-und-stimmung.yaml'),
      'utf8',
    ),
  );

describe('show content contract', () => {
  it.each([3, 4, 5])('accepts %i images and one video with original references', (count) => {
    const input = show();
    input.images = Array.from({ length: count }, (_, i) => ({
      ...input.images[0]!,
      fileName: `shot-${i}.webp`,
    }));
    expect(showSchema.parse(input)).toEqual(input);
  });
  it.each(['interior', 'worn', 'closeup'] as const)(
    'requires a persona except for %s interior',
    (template) => {
      const input = show();
      input.template = template;
      delete input.model;
      expect(showSchema.safeParse(input).success).toBe(template === 'interior');
    },
  );
  it.each([
    (s: Show) => {
      s.images = s.images.slice(0, 2);
    },
    (s: Show) => {
      s.images = Array.from({ length: 6 }, (_, i) => ({
        ...s.images[0]!,
        fileName: `image-${i}.webp`,
      }));
    },
    (s: Show) => {
      s.originals = [];
    },
    (s: Show) => {
      s.images[1]!.fileName = s.images[0]!.fileName;
    },
    (s: Show) => {
      s.originals.push(s.originals[0]!);
    },
    (s: Show) => {
      s.images[0]!.fileName = '../escape.jpg';
    },
    (s: Show) => {
      s.video.durationSeconds = 0;
    },
    (s: Show) => {
      s.video.durationSeconds = 16;
    },
    (s: Show) => {
      s.workId = 'missing';
    },
    (s: Show) => {
      s.versions = {};
    },
    (s: Show) => {
      s.images[0]!.callId = ' ';
    },
  ])('rejects malformed content %#', (mutate) => {
    const input = show();
    mutate(input);
    expect(showSchema.safeParse(input).success).toBe(false);
  });
  it.each([
    { marker: undefined },
    { marker: { visible: 'KI-generiertes Model' } },
    { marker: { visible: '', machineReadable: { format: 'xmp', value: 'AI' } } },
    { marker: { visible: 'KI-generiertes Model', machineReadable: { format: '', value: 'AI' } } },
    { provenance: 'human' },
  ])('rejects incomplete marking or provenance: %j', (patch) => {
    const input = show();
    expect(
      showSchema.safeParse({
        ...input,
        images: [{ ...input.images[0], ...patch }, ...input.images.slice(1)],
      }).success,
    ).toBe(false);
    expect(showSchema.safeParse({ ...input, video: { ...input.video, ...patch } }).success).toBe(
      false,
    );
  });
});

describe('show config and templates', () => {
  it('enables tenant shows with fictional adult personas and the ADR 015 models', () => {
    const shows = tenant().shows!;
    expect(shows.models.map((m) => m.id)).toEqual(['lena', 'marta', 'jonas']);
    expect(shows.models.every((m) => m.fictional && m.adult)).toBe(true);
    expect([shows.image.model, shows.video.model]).toEqual([
      'fal-ai/nano-banana-2/edit',
      'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    ]);
  });
  it('changes model identities, count and provider ids through config only', () => {
    const next = {
      ...config,
      models: [model, { ...model, id: 'studio-two', name: 'Studio Two' }],
      image: { ...config.image, model: 'replacement-image-model' },
    };
    expect(parseTenantConfig(stringify({ ...tenant(), shows: next })).shows).toEqual(next);
  });
  it.each([
    { models: [] },
    { models: [model, model] },
    { models: [{ ...model, adult: false }] },
    { models: [{ ...model, fictional: false }] },
    { models: [{ ...model, referenceImage: ' ' }] },
    { image: { ...config.image, eurPerImage: -1 } },
    { video: { ...config.video, eurPerSecond: 0 } },
    { image: { ...config.image, model: ' ' } },
    { video: { ...config.video, eurPerSecond: Infinity } },
  ])('rejects invalid config %j', (patch) => {
    expect(showConfigSchema.safeParse({ ...config, ...patch }).success).toBe(false);
  });
  it('requires budget configuration for shows', () => {
    const input = { ...tenant(), shows: config };
    delete input.ai;
    expect(tenantConfigSchema.safeParse(input).success).toBe(false);
  });
  it.each(['worn', 'closeup', 'interior'] as const)(
    'defaults to work kind %s and allows author override',
    (kind) => {
      expect(selectShowTemplate(kind)).toBe(kind);
      expect(selectShowTemplate(kind, 'closeup')).toBe('closeup');
    },
  );
});

it('allows a generator fake without network or provider SDK dependencies', async () => {
  const result = {
    callId: 'provider-call-1',
    model: config.image.model,
    promptVersion: 'worn@1',
    costEur: config.image.eurPerImage,
    bytes: new Uint8Array([1]),
    mimeType: 'image/png' as const,
  };
  const generator: ShowGenerator = {
    generateImage: async () => result,
    generateVideo: async () => ({ ...result, mimeType: 'video/mp4' }),
  };
  const response = await generator.generateImage({
    tenantId: 'tenant-one',
    showId: id,
    attemptId: 'attempt-1',
    providerModel: config.image.model,
    promptVersion: 'worn@1',
    template: 'worn',
    originals: [{ bytes: new Uint8Array([2]), mimeType: 'image/jpeg' }],
    persona: { model, reference: { bytes: new Uint8Array([3]), mimeType: 'image/webp' } },
  });
  expect(response.callId).toBe('provider-call-1');
  expect(response.costEur).toBe(0.1);
});

it('round-trips the show content document and rejects missing video or non-document input', () => {
  const input = show();
  expect(parseShow(serializeShow(input))).toEqual(input);
  expect(() => parseShow('not frontmatter')).toThrow();
  expect(showSchema.safeParse({ ...input, video: undefined }).success).toBe(false);
});

describe('authentic show media', () => {
  const photo = (fileName = 'real.jpg') => ({
    fileName,
    kind: 'photo' as const,
    provenance: 'human' as const,
    people: 'author' as const,
  });
  const video = {
    fileName: 'real.mp4',
    kind: 'video' as const,
    provenance: 'human' as const,
    people: 'operator' as const,
  };
  const refs = (input: Show) =>
    [...input.images, input.video, ...(input.authentic ?? [])].map(({ fileName }) => ({
      fileName,
      ref: `stored/${fileName}`,
    }));

  it.each(
    [
      undefined,
      [],
      [photo()],
      [video],
      [{ ...photo(), people: 'both' as const }],
      [{ ...video, people: 'both' as const }],
      [photo(), photo('two.jpeg'), photo('three.jpg'), video],
    ].map((authentic) => ({ authentic })),
  )('round-trips optional authentic media %#', ({ authentic }) => {
    const input = show();
    if (authentic !== undefined) input.authentic = authentic;
    expect(parseShow(serializeShow(input))).toEqual(input);
    expect(showPublicationSchema.parse({ show: input, media: refs(input).reverse() }).show).toEqual(
      input,
    );
  });
  it('accepts the ten-item publication boundary', () => {
    const input = show();
    input.images.push(
      { ...input.images[0]!, fileName: 'four.webp' },
      { ...input.images[0]!, fileName: 'five.webp' },
    );
    input.authentic = [photo(), photo('two.jpeg'), photo('three.jpg'), video];
    expect(refs(input)).toHaveLength(10);
    expect(showPublicationSchema.safeParse({ show: input, media: refs(input) }).success).toBe(true);
  });
  it.each(
    [
      [photo(), photo('two.jpg'), photo('three.jpg'), photo('four.jpg')],
      [video, { ...video, fileName: 'second.mp4' }],
      [photo(), photo()],
      [photo('original.jpg')],
      [photo('image-1.webp')],
      [{ ...video, fileName: 'clip.mp4' }],
      [photo('../escape.jpg')],
      [photo('real.png')],
      [{ ...video, fileName: 'real.mov' }],
      [{ ...photo(), provenance: 'ai-generated' }],
      [{ ...photo(), people: 'participant' }],
      [{ ...photo(), marker: {} }],
    ].map((authentic) => ({ authentic })),
  )('rejects invalid authentic declarations %#', ({ authentic }) => {
    expect(showSchema.safeParse({ ...show(), authentic }).success).toBe(false);
  });
  it('rejects a generated JPEG relabelled as authentic human media', () => {
    const input = show();
    input.images[0]!.fileName = 'generated.jpg';
    input.authentic = [photo('generated.jpg')];
    expect(showSchema.safeParse(input).success).toBe(false);
  });
  it('requires exactly the generated and authentic publication refs', () => {
    const input = show();
    input.authentic = [photo(), video];
    const media = refs(input);
    for (const invalid of [
      media.slice(0, -1),
      [...media, media[0]!],
      [...media.slice(0, -1), { fileName: 'other.mp4', ref: 'stored/other' }],
      [...media, { fileName: 'original.jpg', ref: 'stored/original' }],
    ]) {
      expect(showPublicationSchema.safeParse({ show: input, media: invalid }).success).toBe(false);
    }
  });
});
