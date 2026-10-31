import { botTexts } from './texts';
import { ClaudeTranslator, DEFAULT_MODEL, humanizeDePromptV1 } from '@handmake/ai';
import { safeErrorMessage } from '@handmake/core';
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
    const tenants = new Map<string, number[]>();
    for (const [userId, tenantId] of operators) {
      const users = tenants.get(tenantId) ?? [];
      users.push(userId);
      tenants.set(tenantId, users);
    }
    for (const [tenantId, users] of tenants) {
      try {
        const budget = (await configs.load(tenantId)).ai;
        if (!budget) continue;
        const monthlyKey = `summary:${costMonth(now, -1).key}`;
        const pendingUsers: number[] = [];
        for (const userId of users) {
          if (!(await ledger.hasNotice(tenantId, `${monthlyKey}:${userId}`)))
            pendingUsers.push(userId);
        }
        const current = await ledger.summary(tenantId, now);
        const messages: [string, string][] = [];
        if (current.total >= budget.monthlyTargetEur) {
          messages.push([
            `target:${current.month}`,
            `${botTexts.costTargetText}\n${formatCosts(current, budget)}`,
          ]);
        }
        if (pendingUsers.length) {
          const previous = await ledger.summary(tenantId, now, -1);
          if (previous.total > 0) messages.push([monthlyKey, formatCosts(previous, budget)]);
        }
        for (const [key, text] of messages) {
          for (const userId of users) {
            const notice = `${key}:${userId}`;
            if (!(await ledger.claimNotice(tenantId, notice))) continue;
            try {
              await send(userId, text);
            } catch (error) {
              console.error('AI cost notification delivery failed', {
                tenantId,
                operation: 'sendNotice',
                message: safeErrorMessage(error, [apiKey]),
              });
              await ledger.releaseNotice(tenantId, notice);
            }
          }
        }
      } catch (error) {
        console.error('AI cost notification failed', {
          tenantId,
          operation: 'notices',
          message: safeErrorMessage(error, [apiKey]),
        });
      }
    }
  }
  return {
    notices,
    async translatorFor(tenantId: string, ref: string) {
      const pricing = await configs
        .load(tenantId)
        .then((config) => config.ai?.translation)
        .catch((error) => {
          console.warn(
            'Tenant config unavailable; using default translator without cost accounting',
            {
              tenantId,
              operation: 'loadTranslationPricing',
              message: safeErrorMessage(error, [apiKey]),
            },
          );
          return undefined;
        });
      if (!pricing)
        return new ClaudeTranslator({ apiKey, tenantId, systemPrompt: humanizeDePromptV1 });
      return new ClaudeTranslator({
        apiKey,
        tenantId,
        systemPrompt: humanizeDePromptV1,
        model: DEFAULT_MODEL,
        onUsage: async (usage, responseId) => {
          await ledger.recordCost(tenantId, {
            id: responseId ?? crypto.randomUUID(),
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
