import { expect, it } from 'vitest';
import { showDraftDataSchema, showDraftPlanSchema } from '../src';
const plan = {
  workId: '01JBCA1B2C3D4E5F6G7H8J9K0M',
  template: 'interior',
  originals: ['opaque-original'],
  imageCount: 3,
  provider: {
    image: { model: 'image-v1', eurPerImage: 0.1 },
    video: { model: 'video-v1', eurPerSecond: 0.1 },
  },
};
it('validates an initial raw show draft checkpoint independently of a provider SDK', () => {
  expect(showDraftDataSchema.parse({ plan })).toEqual({
    plan,
    outputs: {},
    retired: [],
    reconciled: [],
  });
});
it.each([
  { imageCount: 2 },
  { imageCount: 6 },
  { originals: [] },
  { template: 'worn' },
  { workId: '../escape' },
])('rejects an invalid generation plan %j', (patch) => {
  expect(showDraftPlanSchema.safeParse({ ...plan, ...patch }).success).toBe(false);
});
it('rejects malformed receipts and pending timestamps', () => {
  expect(showDraftDataSchema.safeParse({ plan, outputs: { video: { costEur: -1 } } }).success).toBe(
    false,
  );
  expect(
    showDraftDataSchema.safeParse({
      plan,
      pending: { attemptId: 'attempt', slot: 'video', at: 'yesterday' },
    }).success,
  ).toBe(false);
});
