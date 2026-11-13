import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  chapters,
  paths,
  quizAttempts,
  quizQuestions,
  quizzes,
  type UserRow,
} from '../db/schema';
import { AppError } from '../domain/errors';
import { nowIso } from '../domain/time';
import { loadConfig } from './account';

function parseChoices(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    )
      return parsed;
  } catch {
    return [];
  }
  return [];
}

export async function submitQuizAttempt(
  db: Database,
  user: UserRow,
  quizId: string,
  answers: number[],
) {
  const quizRows = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1);
  const quiz = quizRows[0];
  if (!quiz) throw new AppError('not_found');
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.id, quiz.chapterId))
    .limit(1);
  const chapter = chapterRows[0];
  if (!chapter) throw new AppError('not_found');
  const pathRows = await db
    .select()
    .from(paths)
    .where(and(eq(paths.id, chapter.pathId), eq(paths.userId, user.id)))
    .limit(1);
  if (!pathRows[0]) throw new AppError('not_found');
  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quiz.id))
    .orderBy(asc(quizQuestions.position));
  if (answers.length !== questions.length)
    throw new AppError('validation', 'Jumlah jawaban tidak sesuai.');
  let correct = 0;
  const review = questions.map((question, index) => {
    const selected = answers[index] ?? 0;
    const right = selected === question.correctIndex;
    if (right) correct += 1;
    return {
      id: question.id,
      stem: question.stem,
      choices: parseChoices(question.choicesJson),
      selected,
      correctIndex: question.correctIndex,
      explanation: right ? null : question.explanation,
    };
  });
  const scorePercent = Math.round((correct / questions.length) * 100);
  const config = await loadConfig(db);
  const quizStatus =
    scorePercent >= config.quizPassPercent ? 'understood' : 'retry';
  await db.insert(quizAttempts).values({
    id: crypto.randomUUID(),
    quizId: quiz.id,
    userId: user.id,
    scorePercent,
    answersJson: JSON.stringify(answers),
    createdAt: nowIso(),
  });
  await db
    .update(chapters)
    .set({ quizStatus })
    .where(eq(chapters.id, chapter.id));
  return { scorePercent, quizStatus, review };
}
