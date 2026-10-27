import { createApp } from './composition';
import type { Env } from './env';
import { botTexts } from './texts';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createApp(env, botTexts, ctx).handle(request);
  },
  scheduled(event: ScheduledEvent, env: Env): Promise<number> {
    return createApp(env, botTexts).scheduled(event);
  },
};
