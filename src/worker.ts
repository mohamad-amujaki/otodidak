import { handle } from '@astrojs/cloudflare/handler';
import entry from './entry';
import type { GenerationMessage } from './server/generation';
import { withApiSecurityHeaders, withSecurityHeaders } from './server/security';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return withApiSecurityHeaders(await entry.fetch(request, env, ctx));
    }
    const fileName = url.pathname.split('/').pop() ?? '';
    if (fileName.includes('.')) {
      try {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      } catch {
        // The dev asset binding can miss a file; the page handler still answers.
      }
    }
    const response = await handle(request, env, ctx);
    return withSecurityHeaders(response, request, env);
  },
  queue: entry.queue,
} satisfies ExportedHandler<Env, GenerationMessage>;
