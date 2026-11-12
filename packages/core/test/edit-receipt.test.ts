import { describe, expect, it } from 'vitest';
import { anonymousEditReceiptSchema, resolveEditPlan } from '../src/edit-receipt';

const id = '01JBCA1B2C3D4E5F6G7H8J9K0N';
const receipt = {
  plan: {
    version: 1,
    type: 'wotw-result',
    entryRefs: [id],
    allowNames: true,
    settings: { channelId: 'CHANNEL_SECRET' },
    operations: [
      { kind: 'mediaGroup', photoIndexes: [0], caption: `Winner {entry:${id}}`, captionLang: 'uk' },
      { kind: 'message', text: `Werk {entry:${id}}`, lang: 'de', replyToOp: 0 },
    ],
  },
  remoteIds: [101, 102],
  publishedAt: '2026-11-12T12:00:00Z',
};
describe('anonymous edit receipt', () => {
  it('resolves every language with stable numbering without mutating source', () => {
    const parsed = anonymousEditReceiptSchema.parse(receipt);
    expect(resolveEditPlan(parsed.plan, { [id]: 'Private fixture' })[0]).toMatchObject({
      caption: 'Winner Private fixture',
    });
    expect(resolveEditPlan(parsed.plan, {})[1]).toMatchObject({ text: 'Werk Werk Nr. 1' });
    expect(JSON.stringify(parsed)).not.toContain('Private fixture');
  });
  it('rejects missing IDs, broken references, forward replies and oversized sources', () => {
    for (const invalid of [
      { ...receipt, remoteIds: [101] },
      { ...receipt, publishedAt: 'yesterday' },
      { ...receipt, plan: { ...receipt.plan, entryRefs: [] } },
      {
        ...receipt,
        plan: {
          ...receipt.plan,
          operations: [{ kind: 'message', text: '{entry:broken}', lang: 'de' }],
        },
        remoteIds: [1],
      },
      {
        ...receipt,
        plan: {
          ...receipt.plan,
          operations: [{ kind: 'message', text: 'text', lang: 'de', replyToOp: 0 }],
        },
        remoteIds: [1],
      },
      { ...receipt, plan: { ...receipt.plan, settings: { value: 'a'.repeat(65536) } } },
    ])
      expect(anonymousEditReceiptSchema.safeParse(invalid).success).toBe(false);
  });
});

it('preserves the anonymous plan across interrupted delivery and ledger round-trips', async () => {
  const { initLedger, markOpDelivered, markFailed, markDone, parseLedger, serializeLedger } =
    await import('../src/ledger');
  const plan = anonymousEditReceiptSchema.parse(receipt).plan;
  const start = initLedger('tenant', 'post', ['channel'], new Date('2026-11-10T00:00:00Z'));
  start.channels.channel!.editPlan = plan;
  const partial = markOpDelivered(start, 'channel', 0, 101, new Date('2026-11-11T00:00:00Z'));
  const failed = parseLedger(
    serializeLedger(markFailed(partial, 'channel', 'failed', new Date('2026-11-11T01:00:00Z'))),
  );
  expect(failed.channels.channel!.editPlan).toEqual(plan);
  const resumed = markOpDelivered(failed, 'channel', 1, 102, new Date('2026-11-12T12:00:00Z'));
  const done = markDone(resumed, 'channel', new Date(receipt.publishedAt));
  expect(done.channels.channel).toMatchObject({
    editPlan: plan,
    remoteIds: [101, 102],
    status: 'done',
    updatedAt: new Date(receipt.publishedAt).toISOString(),
  });
  expect(done.channels.channel!.error).toBeUndefined();
});
