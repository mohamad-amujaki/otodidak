import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  chapters,
  type creditLedger,
  creditOrders,
  generationJobs,
  lessons,
  paths,
  quizzes,
} from '../db/schema';
import { nowIso } from '../domain/time';
import { ledgerPage } from './account';

type LedgerRow = typeof creditLedger.$inferSelect;

export type EnrichedLedgerRow = LedgerRow & {
  href: string | null;
  contextLabel: string | null;
};

export async function ledgerSummary30d(
  db: Database,
  userId: string,
): Promise<{ added: number; used: number; net: number }> {
  const since = new Date(nowIso());
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();
  const row = await db.get<{ added: number | null; used: number | null }>(sql`
    select
      coalesce(sum(case when amount > 0 then amount else 0 end), 0) as added,
      coalesce(sum(case when amount < 0 then amount else 0 end), 0) as used
    from credit_ledger
    where user_id = ${userId} and created_at >= ${sinceIso}
  `);
  const added = Number(row?.added ?? 0);
  const used = Number(row?.used ?? 0);
  return { added, used, net: added + used };
}

export async function enrichLedgerEntries(
  db: Database,
  userId: string,
  entries: LedgerRow[],
): Promise<EnrichedLedgerRow[]> {
  if (entries.length === 0) return [];

  const orderIds = entries
    .filter((e) => e.reason === 'purchase' && e.refType === 'order' && e.refId)
    .map((e) => e.refId as string);
  const jobIds = entries
    .filter((e) => e.refType === 'job' && e.refId)
    .map((e) => e.refId as string);

  const [orders, jobs] = await Promise.all([
    orderIds.length > 0
      ? db
          .select({ id: creditOrders.id })
          .from(creditOrders)
          .where(
            and(
              inArray(creditOrders.id, orderIds),
              eq(creditOrders.userId, userId),
            ),
          )
      : Promise.resolve([]),
    jobIds.length > 0
      ? db
          .select({
            id: generationJobs.id,
            kind: generationJobs.kind,
            refId: generationJobs.refId,
          })
          .from(generationJobs)
          .where(
            and(
              inArray(generationJobs.id, jobIds),
              eq(generationJobs.userId, userId),
            ),
          )
      : Promise.resolve([]),
  ]);

  const orderSet = new Set(orders.map((o) => o.id));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  const pathIds = jobs.filter((j) => j.kind === 'roadmap').map((j) => j.refId);
  const lessonIds = jobs.filter((j) => j.kind === 'lesson').map((j) => j.refId);
  const quizIds = jobs.filter((j) => j.kind === 'quiz').map((j) => j.refId);

  const [pathRows, lessonRows, quizRows] = await Promise.all([
    pathIds.length > 0
      ? db
          .select({ id: paths.id, title: paths.title })
          .from(paths)
          .where(inArray(paths.id, pathIds))
      : Promise.resolve([]),
    lessonIds.length > 0
      ? db
          .select({
            id: lessons.id,
            title: lessons.title,
            chapterId: lessons.chapterId,
          })
          .from(lessons)
          .where(inArray(lessons.id, lessonIds))
      : Promise.resolve([]),
    quizIds.length > 0
      ? db
          .select({
            id: quizzes.id,
            chapterId: quizzes.chapterId,
            lessonId: quizzes.lessonId,
          })
          .from(quizzes)
          .where(inArray(quizzes.id, quizIds))
      : Promise.resolve([]),
  ]);

  const pathMap = new Map(pathRows.map((p) => [p.id, p]));
  const lessonMap = new Map(lessonRows.map((l) => [l.id, l]));
  const quizMap = new Map(quizRows.map((q) => [q.id, q]));

  const chapterIds = [
    ...new Set([
      ...lessonRows.map((l) => l.chapterId),
      ...quizRows.map((q) => q.chapterId),
    ]),
  ];
  const chapterRows =
    chapterIds.length > 0
      ? await db
          .select({
            id: chapters.id,
            pathId: chapters.pathId,
            title: chapters.title,
          })
          .from(chapters)
          .where(inArray(chapters.id, chapterIds))
      : [];
  const chapterMap = new Map(chapterRows.map((c) => [c.id, c]));

  const missingPathIds = chapterRows
    .map((c) => c.pathId)
    .filter((id) => !pathMap.has(id));
  if (missingPathIds.length > 0) {
    const more = await db
      .select({ id: paths.id, title: paths.title })
      .from(paths)
      .where(inArray(paths.id, missingPathIds));
    for (const p of more) pathMap.set(p.id, p);
  }

  return entries.map((entry) => {
    let href: string | null = null;
    let contextLabel: string | null = entry.note?.trim() || null;

    if (
      entry.reason === 'purchase' &&
      entry.refType === 'order' &&
      entry.refId &&
      orderSet.has(entry.refId)
    ) {
      href = `/kredit/pesanan/${entry.refId}`;
      contextLabel = contextLabel ?? 'Lihat pesanan';
    }

    if (entry.refType === 'job' && entry.refId) {
      const job = jobMap.get(entry.refId);
      if (job?.kind === 'roadmap') {
        href = `/jalur/${job.refId}`;
        contextLabel = pathMap.get(job.refId)?.title ?? contextLabel;
      } else if (job?.kind === 'lesson') {
        const lesson = lessonMap.get(job.refId);
        const chapter = lesson ? chapterMap.get(lesson.chapterId) : undefined;
        if (lesson && chapter) {
          href = `/jalur/${chapter.pathId}/pelajaran/${lesson.id}`;
          contextLabel = lesson.title;
        }
      } else if (job?.kind === 'quiz') {
        const quiz = quizMap.get(job.refId);
        const chapter = quiz ? chapterMap.get(quiz.chapterId) : undefined;
        if (chapter) {
          href = quiz?.lessonId
            ? `/jalur/${chapter.pathId}/kuis/${quiz.lessonId}`
            : `/jalur/${chapter.pathId}`;
          contextLabel = chapter.title;
        }
      }
    }

    return { ...entry, href, contextLabel };
  });
}

export async function ledgerExportCsv(
  db: Database,
  userId: string,
  reason?: string,
): Promise<string> {
  const { ledgerReasonLabels } = await import('../domain/credit-ui');
  const lines = ['tanggal,alasan,jumlah,catatan'];
  const pageSize = 50;
  const maxRows = 5_000;
  let offset = 0;
  while (offset < maxRows) {
    const batch = await ledgerPage(db, userId, pageSize, offset, reason);
    if (batch.length === 0) break;
    const enriched = await enrichLedgerEntries(db, userId, batch);
    for (const row of enriched) {
      const label = ledgerReasonLabels[row.reason] ?? row.reason;
      const note = (row.contextLabel ?? row.note ?? '').replaceAll('"', '""');
      lines.push(
        `"${row.createdAt}","${label.replaceAll('"', '""')}",${row.amount},"${note}"`,
      );
    }
    offset += batch.length;
    if (batch.length < pageSize) break;
  }
  return `${lines.join('\n')}\n`;
}
