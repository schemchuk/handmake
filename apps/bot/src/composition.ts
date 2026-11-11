import { createEntrySessionStore } from './entry-session';
import { ClaudeTranslator, humanizeDePromptV1 } from '@handmake/ai';
import { FacebookAdapter, InstagramAdapter, ThreadsAdapter } from '@handmake/channels';
import { draftRetentionDays, safeErrorMessage } from '@handmake/core';
import type { ChannelCommentsCapability, ChannelCommentsContext } from '@handmake/core';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';

import { createAiCostLedger } from './ai-costs';
import { createAiCostRuntime } from './ai-cost-runtime';
import { runAnnouncementCron } from './announcement-cron';
import { runPollCron } from './poll-cron';
import { createPollOpeningStore } from './poll-opening-store';
import { AuthorEntrySource, createContestEntryStore } from './contest-store';
import { createTenantLookup, parseAllowList } from './allow-list';
import type { TenantLookup } from './allow-list';
import { createBot } from './bot';
import type { AppContext } from './context';
import { runCommentCollect } from './comment-collect';
import { commentRetentionDays, createCommentStore } from './comment-store';
import type { CommentNetwork } from './comment-store';
import { createD1DraftStore } from './draft-store';
import type { Env } from './env';
import { createProcessedUpdateTracker, processedUpdateRetentionDays } from './processed-updates';
import { createGitHubActionsRunner } from './publish-runner';
import { handlePublishedCallback, publishedCallbackPath } from './published-callback';
import { createGitHubCollectionReader } from './collection-reader';
import { createGitHubWorkReader } from './work-reader';
import { handleContestNames, readEntryNames } from './contest-names';
import { contestNamesPath } from '@handmake/core';
import { createGitHubTenantConfigSource } from './tenant-config-source';
import type { BotTexts } from './texts';
import { createShowRuntime } from './show-runtime';
import { showTransportPath } from './show-transport';

/** Header Telegram sends when the webhook was registered with a secret token. */
export const secretTokenHeader = 'x-telegram-bot-api-secret-token';

/** The cron that runs retention cleanup; every other tick evaluates F18. */
export const cleanupCron = '29 3 * * *';

export interface App {
  handle(request: Request): Promise<Response>;
  /** Scheduled work: F18 announcement/reminder check and the F34 comment
   * collect on every tick, daily retention cleanup on the cleanup cron;
   * returns the number of rows the cleanup deleted (drafts + comments). */
  scheduled(event: ScheduledEvent): Promise<number>;
  /** Exposed for tests; production uses only `handle`. */
  bot: Bot<AppContext>;
}

/**
 * Constant-time string comparison: no early exit, so the check does not leak
 * how much of the secret a wrong guess got right (PR #19 review note 1).
 * The length is compared up front; the string content only via the XOR loop.
 */
export function secretsEqual(expected: string, provided: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

interface TelegramUpdateBody {
  update_id?: unknown;
  message?: { from?: { id?: unknown } };
  callback_query?: { from?: { id?: unknown } };
}

/** Parses the webhook body once; every guard below reads the same object. */
async function bodyOf(request: Request, onError: (error: unknown) => void): Promise<unknown> {
  return request
    .clone()
    .json()
    .catch((error) => {
      onError(error);
      return undefined;
    });
}

function updateIdOf(body: unknown): number | undefined {
  const updateId = (body as TelegramUpdateBody | null | undefined)?.update_id;
  return typeof updateId === 'number' ? updateId : undefined;
}

/** Sender of the update, whether it came as a message or a button press. */
function senderIdOf(body: unknown): number | undefined {
  const update = body as TelegramUpdateBody | null | undefined;
  const from = update?.message?.from ?? update?.callback_query?.from;
  return typeof from?.id === 'number' ? from.id : undefined;
}

/** Composition root: wires secrets/bindings to the bot (ADR 007).
 * `executionCtx` lets the bot finish translations after the webhook response
 * has been sent (Cloudflare waitUntil); grammY's own webhook timeout is only
 * 10 s, a translation takes 10-30 s. Callers without one (the scheduled
 * handler, tests) get a detached fallback — production always passes it. */
export function createApp(env: Env, texts: BotTexts, executionCtx?: ExecutionContext): App {
  function logError(operation: string, error: unknown, tenantId = 'unknown') {
    console.error(operation, {
      tenantId,
      operation,
      message: safeErrorMessage(error, [
        env.ANTHROPIC_API_KEY,
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_WEBHOOK_SECRET,
        env.TELEGRAM_ALLOWED_USER_IDS,
        env.GITHUB_DISPATCH_TOKEN,
        env.PUBLISH_CALLBACK_SECRET,
        env.SHOW_TRANSPORT_SECRET ?? '',
        env.INSTAGRAM_USER_ID,
        env.INSTAGRAM_ACCESS_TOKEN,
        env.FACEBOOK_PAGE_ID,
        env.FACEBOOK_PAGE_ACCESS_TOKEN,
        env.META_APP_ID,
        env.META_APP_SECRET,
      ]),
    });
  }
  // The bot is built lazily so the webhook secret is checked BEFORE the
  // allow-list secret is parsed: a malformed allow-list must yield 401, not
  // 500, for unauthenticated callers (PR #19 review note 2).
  let bot: Bot<AppContext> | undefined;
  let handleUpdate: ((request: Request) => Promise<Response>) | undefined;
  // Cached for the dedupe gate below; parsing the allow-list secret once per
  // app instance, not once per request.
  let tenantLookup: TenantLookup | undefined;
  function lookup(): TenantLookup {
    tenantLookup ??= createTenantLookup(env.TELEGRAM_ALLOWED_USER_IDS);
    return tenantLookup;
  }
  const costs = createAiCostLedger(env.DB);
  const tenantConfigs = createGitHubTenantConfigSource({ repo: env.GITHUB_REPO, ref: 'main' });
  function aiRuntime() {
    return createAiCostRuntime(
      costs,
      tenantConfigs,
      parseAllowList(env.TELEGRAM_ALLOWED_USER_IDS),
      env.ANTHROPIC_API_KEY,
      (id, text) => {
        build();
        return bot!.api.sendMessage(String(id), text);
      },
    );
  }
  // Missing optional secret pairs disable their network.
  const metaSecrets: Record<string, string | undefined> = {
    INSTAGRAM_USER_ID: env.INSTAGRAM_USER_ID,
    INSTAGRAM_ACCESS_TOKEN: env.INSTAGRAM_ACCESS_TOKEN,
    FACEBOOK_PAGE_ID: env.FACEBOOK_PAGE_ID,
    FACEBOOK_PAGE_ACCESS_TOKEN: env.FACEBOOK_PAGE_ACCESS_TOKEN,
    THREADS_USER_ID: env.THREADS_USER_ID,
    THREADS_ACCESS_TOKEN: env.THREADS_ACCESS_TOKEN,
    META_APP_ID: env.META_APP_ID,
    META_APP_SECRET: env.META_APP_SECRET,
  };
  const commentsContext: ChannelCommentsContext = {
    secrets: { resolve: async (name) => metaSecrets[name] ?? '' },
  };
  function commentCapabilities(): Partial<Record<CommentNetwork, ChannelCommentsCapability>> {
    const capabilities: Partial<Record<CommentNetwork, ChannelCommentsCapability>> = {};
    if (env.INSTAGRAM_USER_ID && env.INSTAGRAM_ACCESS_TOKEN) {
      capabilities.instagram = new InstagramAdapter().comments;
    }
    if (env.FACEBOOK_PAGE_ID && env.FACEBOOK_PAGE_ACCESS_TOKEN) {
      capabilities.facebook = new FacebookAdapter().comments;
    }
    if (env.THREADS_USER_ID && env.THREADS_ACCESS_TOKEN) {
      capabilities.threads = new ThreadsAdapter().comments;
    }
    return capabilities;
  }
  function build(): (request: Request) => Promise<Response> {
    if (!handleUpdate) {
      const shows = createShowRuntime(env);
      bot = createBot({
        token: env.TELEGRAM_BOT_TOKEN,
        entryNames: (tenant, ids) => readEntryNames(env.DB, tenant, ids),
        entries: createEntrySessionStore(env.DB),
        comments: {
          store: createCommentStore(env.DB),
          capabilities: commentCapabilities(),
          context: commentsContext,
        },
        tenantConfigs,
        // Previews must show what the publisher will deliver: while
        // PUBLISH_LIVE is off, publishes are site-excluded test runs.
        publishesLive: env.PUBLISH_LIVE === 'true',
        costs: { ledger: costs, tenantConfigs },
        translatorFor: aiRuntime().translatorFor,
        show: {
          works: createGitHubWorkReader({
            repo: env.GITHUB_REPO,
            ref: 'main',
            token: env.GITHUB_DISPATCH_TOKEN,
          }),
          configs: tenantConfigs,
          recovery: shows?.recovery,
          approval: shows?.approval,
          start: shows?.start,
          preview: shows?.preview,
        },
        work: {
          logError,
          collections: createGitHubCollectionReader({
            repo: env.GITHUB_REPO,
            ref: 'main',
            token: env.GITHUB_DISPATCH_TOKEN,
          }),
          configs: tenantConfigs,
          textGeneratorFor: aiRuntime().textGeneratorFor,
        },
        drafts: createD1DraftStore(env.DB),
        resolveTenant: createTenantLookup(env.TELEGRAM_ALLOWED_USER_IDS),
        texts,
        translator: new ClaudeTranslator({
          systemPrompt: humanizeDePromptV1,
          apiKey: env.ANTHROPIC_API_KEY,
        }),
        publishRunner: createGitHubActionsRunner({
          repo: env.GITHUB_REPO,
          token: env.GITHUB_DISPATCH_TOKEN,
          live: env.PUBLISH_LIVE === 'true',
        }),
        background: (task) =>
          executionCtx
            ? executionCtx.waitUntil(task())
            : void task().catch((error) => logError('background task failed', error)),
      });
      handleUpdate = webhookCallback(bot, 'cloudflare-mod');
    }
    return handleUpdate;
  }

  return {
    get bot(): Bot<AppContext> {
      build();
      return bot as Bot<AppContext>;
    },

    async handle(request) {
      if (new URL(request.url).pathname === contestNamesPath)
        return handleContestNames(env, request);
      if (new URL(request.url).pathname.startsWith(showTransportPath)) {
        const shows = createShowRuntime(env);
        return shows ? shows.handle(request) : new Response('shows disabled', { status: 503 });
      }
      // The publisher's callback authenticates with its own HMAC, not the
      // Telegram webhook secret — it must branch off before that gate.
      if (new URL(request.url).pathname === publishedCallbackPath) {
        return handlePublishedCallback(env, request, { texts, tenantConfigs });
      }
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405 });
      }
      // Fail closed: a missing or empty configured secret rejects everything.
      const expected = env.TELEGRAM_WEBHOOK_SECRET;
      const provided = request.headers.get(secretTokenHeader);
      if (!expected || provided === null || !secretsEqual(expected, provided)) {
        return new Response('unauthorized', { status: 401 });
      }
      // Telegram retries a webhook delivery when our answer is lost, and a
      // re-run would append the author's content twice. Updates answered
      // successfully are recorded by update_id and exact redeliveries are
      // dropped (handled-failed updates are NOT recorded, so a genuine
      // retry after an error re-runs normally).
      //
      // The dedupe write is scoped to allow-listed senders: a refused
      // stranger must leave no trace in D1 (A6, PR #22 review note).
      const body = await bodyOf(request, (error) => logError('parse webhook body', error));
      const updateId = updateIdOf(body);
      const senderId = senderIdOf(body);
      const allowListed = senderId !== undefined && lookup()(senderId) !== undefined;
      const processed = allowListed ? createProcessedUpdateTracker(env.DB) : undefined;
      if (processed && updateId !== undefined && (await processed.wasProcessed(updateId))) {
        return new Response('ok');
      }
      const response = await build()(request);
      if (processed && updateId !== undefined && response.ok) {
        await processed.markProcessed(updateId);
      }
      return response;
    },

    async scheduled(event) {
      const drafts = createD1DraftStore(env.DB);
      // Retention cleanup runs on its own daily cron — an event without a
      // cron (as in tests) counts as the cleanup cron and never fetches
      // tenant config.
      if (event.cron === undefined || event.cron === cleanupCron) {
        const retentionMs = draftRetentionDays * 24 * 60 * 60 * 1000;
        const updates = createProcessedUpdateTracker(env.DB);
        const updateRetentionMs = processedUpdateRetentionDays * 24 * 60 * 60 * 1000;
        const cutoff = new Date(event.scheduledTime - retentionMs);
        await updates.deleteOlderThan(new Date(event.scheduledTime - updateRetentionMs));
        const comments = createCommentStore(env.DB);
        const commentsDeleted = await comments.deleteOlderThan(
          new Date(event.scheduledTime - commentRetentionDays * 24 * 60 * 60 * 1000),
        );
        await createEntrySessionStore(env.DB).cleanup(new Date(event.scheduledTime));
        return (await drafts.deleteOlderThan(cutoff)) + commentsDeleted;
      }
      // F18: on every other tick, check whether an announcement/reminder
      // moment just fired for some tenant. Failures stay inside the cron:
      // it is a best-effort notifier and drafts are the source of truth.
      let tenantId = 'unknown';
      try {
        tenantId = [...new Set(parseAllowList(env.TELEGRAM_ALLOWED_USER_IDS).values())].join(',');
        await runAnnouncementCron(new Date(event.scheduledTime), {
          translatorFor: aiRuntime().translatorFor,
          drafts,
          translator: new ClaudeTranslator({
            systemPrompt: humanizeDePromptV1,
            apiKey: env.ANTHROPIC_API_KEY,
          }),
          bot: this.bot,
          tenantConfigs,
          allowList: parseAllowList(env.TELEGRAM_ALLOWED_USER_IDS),
          texts,
        });
      } catch (error) {
        logError('announcement cron failed', error, tenantId);
      }
      try {
        await runPollCron(new Date(event.scheduledTime), {
          openings: createPollOpeningStore(env.DB),
          source: new AuthorEntrySource(createContestEntryStore(env.DB)),
          bot: this.bot,
          tenantConfigs,
          allowList: parseAllowList(env.TELEGRAM_ALLOWED_USER_IDS),
          texts,
          lookupNames: (tenant, ids) => readEntryNames(env.DB, tenant, ids),
          publishesLive: env.PUBLISH_LIVE === 'true',
        });
      } catch (error) {
        logError('poll cron failed', error, tenantId);
      }
      try {
        await aiRuntime().notices(new Date(event.scheduledTime));
      } catch (error) {
        logError('AI cost notification failed', error, tenantId);
      }
      // F34: D1 claims and watermarks make collection retryable.
      try {
        await runCommentCollect(new Date(event.scheduledTime), {
          store: createCommentStore(env.DB),
          tenantConfigs,
          allowList: parseAllowList(env.TELEGRAM_ALLOWED_USER_IDS),
          capabilities: commentCapabilities(),
          commentsContext,
          drafterFor: (tenantId, commentId) =>
            aiRuntime().commentDrafterFor(tenantId, `comment:${commentId}`),
          bot: this.bot,
          texts,
        });
      } catch (error) {
        logError('comment collect failed', error, tenantId);
      }
      return 0;
    },
  };
}
