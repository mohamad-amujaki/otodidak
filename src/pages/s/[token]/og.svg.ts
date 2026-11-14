import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildShareOgSvg } from '../../../domain/share-og';
import { database } from '../../../server/account';
import {
  activeShareLink,
  publicLessonPayload,
  publicPathPayload,
} from '../../../server/share';

export const GET: APIRoute = async ({ params }) => {
  const token = params.token ?? '';
  if (!token) return new Response('Not found', { status: 404 });

  const db = await database(env);
  const link = await activeShareLink(db, token);
  if (!link) return new Response('Not found', { status: 404 });

  let eyebrow = 'Materi dari Otodidak';
  let title = 'Materi belajar';
  let footer = 'Dibagikan lewat Otodidak';
  if (link.scope === 'lesson') {
    const lesson = await publicLessonPayload(db, link.targetId);
    if (lesson) {
      title = lesson.title;
      eyebrow = `${lesson.pathTitle} · ${lesson.chapterTitle}`;
      footer = `${lesson.sources.length} referensi · dibagikan lewat Otodidak`;
    }
  } else {
    const path = await publicPathPayload(db, link.targetId);
    if (path) {
      title = path.title;
      eyebrow = `Jalur belajar · ${path.topic}`;
      footer = `${path.chapters.length} bab · dibagikan lewat Otodidak`;
    }
  }

  const svg = buildShareOgSvg({
    eyebrow: eyebrow.slice(0, 70),
    title,
    footer,
  });
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
};
