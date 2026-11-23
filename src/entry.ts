import { createApp } from './server/app';
import {
  type GenerationMessage,
  handleQueue,
  sweepStaleJobs,
} from './server/generation';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  queue(batch: MessageBatch<GenerationMessage>, env: Env) {
    return handleQueue(batch, env);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweepStaleJobs(env));
  },
} satisfies ExportedHandler<Env, GenerationMessage>;
