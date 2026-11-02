import { selectShowTemplate } from '@handmake/core';
import type { ShowConfig, ShowModel, ShowTemplate, Work } from '@handmake/core';
import type { AppContext } from './context';
import type { CreateBotOptions } from './bot';
import type { StoredDraft } from './draft-store';

export type ShowOriginal =
  { kind: 'work'; workId: string; fileName: string } | { kind: 'telegram'; fileId: string };
export type ShowInput = {
  originals: ShowOriginal[];
  template: ShowTemplate;
  model?: ShowModel;
  menuConfig: string;
  ready: boolean;
};

/** Persist author choices separately from the immutable execution plan. */
export function createShowInput(options: CreateBotOptions) {
  const { drafts, texts, show } = options;
  const read = async (stored: StoredDraft) => {
    const tenant = await show!.configs.load(stored.draft.tenantId);
    const id = (stored.draft.extras['showSelection'] as { workId?: string } | undefined)?.workId;
    const work = id ? await show!.works.readWork(stored.draft.tenantId, id) : undefined;
    if (!work || work.id !== id || work.tenant !== stored.draft.tenantId)
      throw new Error('missing linked work');
    if (tenant.id !== stored.draft.tenantId || !tenant.shows || !tenant.ai)
      throw new Error('disabled show');
    return { work, config: tenant.shows };
  };
  const save = (stored: StoredDraft, input: ShowInput) =>
    drafts.updateShow(
      {
        ...stored.draft,
        extras: { ...stored.draft.extras, showInput: input },
        updatedAt: new Date().toISOString(),
      },
      stored.version,
    );
  const current = (stored: StoredDraft, work: Work, config: ShowConfig): ShowInput => {
    const input = stored.draft.extras['showInput'] as ShowInput | undefined;
    const validModel =
      input?.model && config.models.some((m) => JSON.stringify(m) === JSON.stringify(input.model));
    return {
      originals: input?.originals ?? [],
      template: input?.template ?? selectShowTemplate(work.kind),
      model: validModel ? input!.model : undefined,
      menuConfig: JSON.stringify(config),
      ready: input?.ready === true && input.menuConfig === JSON.stringify(config),
    };
  };
  const present = async (ctx: AppContext, stored: StoredDraft) => {
    const { work, config } = await read(stored);
    const input = current(stored, work, config);
    if (!(await save(stored, input))) throw new Error('input changed');
    const prefix = `show:${stored.draft.draftId}:`;
    // Telegram keyboards have no selected state; mark the saved choices in their labels.
    const mark = (selected: boolean, label: string) => (selected ? `✓ ${label}` : label);
    const button = (label: string, action: string, value = '') => ({
      text: label,
      callback_data: `${prefix}${action}:${stored.version + 1}${action === 'start' ? '' : `.${value}`}`,
    });
    await ctx.reply(
      texts.showInputText(
        input.originals.length,
        texts.workKinds[input.template],
        input.model?.name,
        input.ready,
      ),
      {
        reply_markup: {
          inline_keyboard: [
            ...(work.photos.length <= 3
              ? [[button(texts.showUseWorkPhotosButton, 'originals')]]
              : []),
            [button(texts.showResetPhotosButton, 'reset')],
            ...(['worn', 'closeup', 'interior'] as const).map((t) => [
              button(mark(input.template === t, texts.workKinds[t]), 'template', t),
            ]),
            ...config.models.map((m, i) => [
              button(
                mark(input.model?.id === m.id, Array.from(m.name).slice(0, 60).join('')),
                'persona',
                String(i),
              ),
            ]),
            [button(texts.showFinalizeButton, 'finalize')],
            ...(input.ready ? [[button(texts.showStartButton, 'start')]] : []),
          ],
        },
      },
    );
  };
  const presentStart = (ctx: AppContext, stored: StoredDraft) =>
    ctx.reply(texts.showStartText, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: texts.showStartButton,
              callback_data: `show:${stored.draft.draftId}:start:${stored.version}`,
            },
          ],
        ],
      },
    });
  return {
    present,
    presentStart,
    async start(ctx: AppContext, stored: StoredDraft, version: string) {
      if (!/^\d+$/.test(version) || Number(version) !== stored.version)
        return ctx.reply(texts.showSelectionErrorText);
      if (!show?.start) return ctx.reply(texts.showUnavailableText);
      const selected = stored.draft.extras['showInput'] as ShowInput | undefined;
      if (!stored.draft.extras['show'] && !selected?.ready)
        return ctx.reply(texts.showSelectionErrorText);
      await ctx.reply(texts.showStartingText);
      options.background(async () => {
        try {
          await show.start!(stored);
          await ctx.reply(texts.showDispatchedText);
        } catch {
          await ctx.reply(texts.showStartFailedText);
        }
      });
    },
    async action(ctx: AppContext, stored: StoredDraft, action: string, value: string) {
      const [version, choice] = value.split('.');
      const { work, config } = await read(stored);
      const previous = stored.draft.extras['showInput'] as ShowInput | undefined;
      if (Number(version) !== stored.version || previous?.menuConfig !== JSON.stringify(config))
        return ctx.reply(texts.showSelectionErrorText);
      const input = current(stored, work, config);
      input.ready = false;
      if (action === 'originals' && work.photos.length <= 3)
        input.originals = work.photos.map((fileName) => ({
          kind: 'work',
          workId: work.id,
          fileName,
        }));
      else if (action === 'reset') input.originals = [];
      else if (action === 'template' && ['worn', 'closeup', 'interior'].includes(choice!))
        input.template = choice as ShowTemplate;
      else if (action === 'persona' && /^\d+$/.test(choice ?? '') && config.models[Number(choice)])
        input.model = config.models[Number(choice)];
      else if (action === 'finalize') {
        if (input.originals.length < 2 || input.originals.length > 3)
          return ctx.reply(texts.showPhotoBoundsText);
        if (input.template !== 'interior' && !input.model)
          return ctx.reply(texts.showNeedsPersonaText);
        if (
          input.originals.some(
            (ref) =>
              ref.kind === 'work' &&
              (ref.workId !== work.id || !work.photos.includes(ref.fileName)),
          )
        )
          return ctx.reply(texts.showMissingWorkText);
        input.ready = true;
      } else return ctx.reply(texts.showSelectionErrorText);
      if (!(await save(stored, input))) return ctx.reply(texts.showSelectionErrorText);
      await drafts.setChatSession(
        ctx.tenantId,
        String(ctx.chat!.id),
        { kind: 'show', draftId: stored.draft.draftId },
        new Date(),
      );
      const updated = await drafts.get(ctx.tenantId, stored.draft.draftId);
      if (updated) return present(ctx, updated);
    },
    async photo(ctx: AppContext, id: string, fileId: string) {
      // Retry CAS from fresh state: concurrent album updates cannot overwrite each other or exceed three.
      for (let attempt = 0; attempt < 8; attempt++) {
        const stored = await drafts.get(ctx.tenantId, id);
        if (!stored || stored.draft.state !== 'collecting' || stored.draft.extras['show']) break;
        const { work, config } = await read(stored);
        const input = current(stored, work, config);
        if (input.originals.some((ref) => ref.kind === 'telegram' && ref.fileId === fileId)) return;
        if (input.originals.length >= 3) return ctx.reply(texts.showPhotoBoundsText);
        input.originals.push({ kind: 'telegram', fileId });
        input.ready = false;
        if (!(await save(stored, input))) continue;
        return ctx.reply(texts.showPhotoSavedText(input.originals.length));
      }
      return ctx.reply(texts.showSelectionErrorText);
    },
  };
}
