import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  chapters,
  lessonClaims,
  lessonSources,
  lessons,
  paths,
  shareLinks,
} from '../db/schema';
import { AppError } from '../domain/errors';
import { nowIso } from '../domain/time';

const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const TOKEN_LENGTH = 10;
const MAX_ACTIVE_LINKS = 20;

export type ShareScope = 'lesson' | 'path';

export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  return Array.from(
    bytes,
    (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length] ?? 'a',
  ).join('');
}

async function createLink(
  db: Database,
  userId: string,
  scope: ShareScope,
  targetId: string,
  days: number,
) {
  const now = nowIso();
  const active = await db
    .select()
    .from(shareLinks)
    .where(
      and(
        eq(shareLinks.ownerId, userId),
        eq(shareLinks.scope, scope),
        eq(shareLinks.targetId, targetId),
        isNull(shareLinks.revokedAt),
      ),
    )
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);
  const current = active[0];
  if (current && (!current.expiresAt || current.expiresAt > now))
    return current;

  const totals = await db
    .select({ total: sql<number>`count(*)` })
    .from(shareLinks)
    .where(and(eq(shareLinks.ownerId, userId), isNull(shareLinks.revokedAt)));
  if (Number(totals[0]?.total ?? 0) >= MAX_ACTIVE_LINKS)
    throw new AppError(
      'rate_limited',
      'Terlalu banyak link aktif. Cabut beberapa dulu.',
    );

  const expiresAt =
    days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID();
    const token = newShareToken();
    try {
      await db.insert(shareLinks).values({
        id,
        token,
        scope,
        targetId,
        ownerId: userId,
        createdAt: now,
        expiresAt,
        revokedAt: null,
        views: 0,
        lastViewedAt: null,
      });
      return {
        id,
        token,
        scope,
        targetId,
        ownerId: userId,
        createdAt: now,
        expiresAt,
        revokedAt: null,
        views: 0,
        lastViewedAt: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('UNIQUE')) throw error;
    }
  }
  throw new AppError('rate_limited');
}

export async function createLessonShareLink(
  db: Database,
  userId: string,
  lessonId: string,
  days = 30,
) {
  const owned = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(chapters, eq(lessons.chapterId, chapters.id))
    .innerJoin(paths, eq(chapters.pathId, paths.id))
    .where(and(eq(lessons.id, lessonId), eq(paths.userId, userId)))
    .limit(1);
  if (!owned[0]) throw new AppError('not_found');
  return createLink(db, userId, 'lesson', lessonId, days);
}

export async function createPathShareLink(
  db: Database,
  userId: string,
  pathId: string,
  days = 30,
) {
  const owned = await db
    .select({ id: paths.id })
    .from(paths)
    .where(and(eq(paths.id, pathId), eq(paths.userId, userId)))
    .limit(1);
  if (!owned[0]) throw new AppError('not_found');
  return createLink(db, userId, 'path', pathId, days);
}

/** Ringkasan jalur publik: bab + judul pelajaran (tanpa isi materi). */
export async function publicPathPayload(db: Database, pathId: string) {
  const rows = await db
    .select({ id: paths.id, title: paths.title, topic: paths.topic })
    .from(paths)
    .where(and(eq(paths.id, pathId), eq(paths.status, 'ready')))
    .limit(1);
  const path = rows[0];
  if (!path) return null;
  const chapterRows = await db
    .select({
      id: chapters.id,
      title: chapters.title,
      summary: chapters.summary,
      position: chapters.position,
    })
    .from(chapters)
    .where(eq(chapters.pathId, pathId))
    .orderBy(asc(chapters.position));
  const lessonRows = await db
    .select({
      id: lessons.id,
      chapterId: lessons.chapterId,
      title: lessons.title,
      objective: lessons.objective,
      position: lessons.position,
    })
    .from(lessons)
    .innerJoin(chapters, eq(lessons.chapterId, chapters.id))
    .where(eq(chapters.pathId, pathId))
    .orderBy(asc(lessons.position));
  return {
    ...path,
    chapters: chapterRows.map((chapter) => ({
      ...chapter,
      lessons: lessonRows.filter((lesson) => lesson.chapterId === chapter.id),
    })),
  };
}

/** Topik jalur di balik sebuah share link (untuk CTA halaman publik). */
export async function shareTopic(
  db: Database,
  link: {
    scope: ShareScope;
    targetId: string;
  },
): Promise<string> {
  if (link.scope === 'path') {
    const rows = await db
      .select({ topic: paths.topic })
      .from(paths)
      .where(eq(paths.id, link.targetId))
      .limit(1);
    return rows[0]?.topic ?? '';
  }
  const rows = await db
    .select({ topic: paths.topic })
    .from(lessons)
    .innerJoin(chapters, eq(lessons.chapterId, chapters.id))
    .innerJoin(paths, eq(chapters.pathId, paths.id))
    .where(eq(lessons.id, link.targetId))
    .limit(1);
  return rows[0]?.topic ?? '';
}

export async function countShareCtaClick(
  db: Database,
  token: string,
): Promise<void> {
  const rows = await db
    .select({ id: shareLinks.id })
    .from(shareLinks)
    .where(eq(shareLinks.token, token))
    .limit(1);
  const link = rows[0];
  if (!link) return;
  await db
    .update(shareLinks)
    .set({ ctaClicks: sql`${shareLinks.ctaClicks} + 1` })
    .where(eq(shareLinks.id, link.id));
}

/** Link yang masih berlaku, tanpa menambah hitungan apa pun. */
export async function activeShareLink(db: Database, token: string) {
  const rows = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.token, token))
    .limit(1);
  const link = rows[0];
  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt <= nowIso()) return null;
  return link;
}

/** Link publik yang masih berlaku — sekaligus menambah hitungan dibuka. */
export async function resolveShareLink(db: Database, token: string) {
  const link = await activeShareLink(db, token);
  if (!link) return null;
  await db
    .update(shareLinks)
    .set({ views: link.views + 1, lastViewedAt: nowIso() })
    .where(eq(shareLinks.id, link.id));
  return link;
}

export async function ownerShareLink(
  db: Database,
  userId: string,
  token: string,
) {
  const rows = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.token, token), eq(shareLinks.ownerId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeShareLink(
  db: Database,
  userId: string,
  token: string,
) {
  const link = await ownerShareLink(db, userId, token);
  if (!link) throw new AppError('not_found');
  await db
    .update(shareLinks)
    .set({ revokedAt: nowIso() })
    .where(eq(shareLinks.id, link.id));
}

/** Materi publik (tanpa scope user) untuk halaman /s/[token]. */
export async function publicLessonPayload(db: Database, lessonId: string) {
  const rows = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      objective: lessons.objective,
      body: lessons.body,
      adds: lessons.adds,
      diagramsJson: lessons.diagramsJson,
      chapterTitle: chapters.title,
      chapterPosition: chapters.position,
      pathTitle: paths.title,
    })
    .from(lessons)
    .innerJoin(chapters, eq(lessons.chapterId, chapters.id))
    .innerJoin(paths, eq(chapters.pathId, paths.id))
    .where(and(eq(lessons.id, lessonId), eq(lessons.status, 'ready')))
    .limit(1);
  const row = rows[0];
  if (!row?.body) return null;
  const [sources, claims] = await Promise.all([
    db
      .select()
      .from(lessonSources)
      .where(eq(lessonSources.lessonId, lessonId))
      .orderBy(asc(lessonSources.position)),
    db.select().from(lessonClaims).where(eq(lessonClaims.lessonId, lessonId)),
  ]);
  return { ...row, sources, claims };
}

export type OwnerShareRow = {
  id: string;
  token: string;
  scope: ShareScope;
  targetId: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  views: number;
  ctaClicks: number;
  title: string;
};

export async function listOwnerShares(
  db: Database,
  userId: string,
): Promise<OwnerShareRow[]> {
  const rows = await db
    .select({
      id: shareLinks.id,
      token: shareLinks.token,
      scope: shareLinks.scope,
      targetId: shareLinks.targetId,
      createdAt: shareLinks.createdAt,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      views: shareLinks.views,
      ctaClicks: shareLinks.ctaClicks,
      lessonTitle: lessons.title,
      pathTitle: paths.title,
    })
    .from(shareLinks)
    .leftJoin(
      lessons,
      and(eq(shareLinks.scope, 'lesson'), eq(lessons.id, shareLinks.targetId)),
    )
    .leftJoin(
      paths,
      and(eq(shareLinks.scope, 'path'), eq(paths.id, shareLinks.targetId)),
    )
    .where(eq(shareLinks.ownerId, userId))
    .orderBy(desc(shareLinks.createdAt));
  return rows.map((row) => ({
    id: row.id,
    token: row.token,
    scope: row.scope,
    targetId: row.targetId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    views: row.views,
    ctaClicks: row.ctaClicks,
    title: row.lessonTitle ?? row.pathTitle ?? 'Materi',
  }));
}

export function shareMessage(title: string, summary: string, url: string) {
  const cleanSummary = summary.replace(/\s+/g, ' ').trim().slice(0, 140);
  const lines = [
    `Aku baru selesai baca ini di Otodidak: *${title}*`,
    cleanSummary ? `${cleanSummary}…` : '',
    `Baca di sini: ${url}`,
    '',
    '(Dibuat dengan Otodidak — bisa bikin jalur belajar sendiri dari satu topik.)',
  ].filter(Boolean);
  return lines.join('\n');
}

export function whatsappHref(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
