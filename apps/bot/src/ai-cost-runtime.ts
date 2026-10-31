import { ClaudeTranslator, humanizeDePromptV1 } from '@handmake/ai';
import type { TenantConfigSource } from './tenant-config-source';
import type { AllowList } from './allow-list';
import { costMonth, formatCosts } from './ai-costs';
import type { AiCostLedger } from './ai-costs';

/** The existing allow-list is also the operator list (Volodymyr, T42). */
export function createAiCostRuntime(
  ledger: AiCostLedger,
  configs: TenantConfigSource,
  operators: AllowList,
  apiKey: string,
  send: (userId: number, text: string) => Promise<unknown>,
) {
  /** Cron-only: threshold checks and reports never delay a translation. */
  async function notices(now: Date) {
    for (const [userId, tenantId] of operators) {
      try {
        const budget = (await configs.load(tenantId)).ai;
        if (!budget) continue;
        const current = await ledger.summary(tenantId, now);
        const messages: [string, string][] = [];
        if (current.total >= budget.monthlyTargetEur) {
          messages.push([
            `target:${current.month}`,
            `Досягнуто місячну ціль витрат на ШІ.\n${formatCosts(current, budget)}`,
          ]);
        }
        if (costMonth(now).firstDay) {
          const previous = await ledger.summary(tenantId, now, -1);
          messages.push([`summary:${previous.month}`, formatCosts(previous, budget)]);
        }
        for (const [key, text] of messages) {
          const notice = `${key}:${userId}`;
          if (!(await ledger.claimNotice(tenantId, notice))) continue;
          try {
            await send(userId, text);
          } catch {
            await ledger.releaseNotice(tenantId, notice);
          }
        }
      } catch {
        console.error('AI cost notification failed');
      }
    }
  }
  return {
    notices,
    async translatorFor(tenantId: string, ref: string) {
      const pricing = (await configs.load(tenantId)).ai?.translation;
      if (!pricing) return new ClaudeTranslator({ apiKey, systemPrompt: humanizeDePromptV1 });
      return new ClaudeTranslator({
        apiKey,
        systemPrompt: humanizeDePromptV1,
        model: pricing.model,
        onUsage: async (usage) => {
          await ledger.recordCost(tenantId, {
            id: crypto.randomUUID(),
            at: new Date(),
            ref,
            service: `translation:${pricing.model}`,
            unit: 'tokens',
            amountEur:
              (usage.input_tokens * pricing.inputEurPerMillion +
                usage.output_tokens * pricing.outputEurPerMillion) /
              1_000_000,
          });
        },
      });
    },
  };
}
