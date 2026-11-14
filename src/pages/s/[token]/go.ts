import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { database } from '../../../server/account';
import {
  activeShareLink,
  countShareCtaClick,
  shareTopic,
} from '../../../server/share';

export const GET: APIRoute = async ({ params, redirect }) => {
  const token = params.token ?? '';
  if (!token) return redirect('/', 302);
  const db = await database(env);
  const link = await activeShareLink(db, token);
  if (!link) return redirect('/masuk', 302);
  await countShareCtaClick(db, token);
  const topic = await shareTopic(db, link);
  return redirect(
    topic ? `/masuk?topik=${encodeURIComponent(topic)}` : '/masuk',
    302,
  );
};
