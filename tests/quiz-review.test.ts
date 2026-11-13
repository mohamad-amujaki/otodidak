import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { UserRow } from '../src/db/schema';
import { database } from '../src/server/account';
import { processGeneration } from '../src/server/generation';
import { submitQuizAttempt } from '../src/server/quiz-actions';
import { pathDetail } from '../src/server/read';
import { api, jsonBody, signIn } from './helpers';

async function userRow(email: string): Promise<UserRow> {
  const row = await env.DB.prepare('select * from user where email = ?')
    .bind(email)
    .first<UserRow>();
  if (!row) throw new Error('pengguna tidak ada');
  return row;
}

/**
 * Halaman kuis menampilkan pembahasan dari payload: `selected`, `correctIndex`,
 * dan `explanation` per soal. Tes ini menjaga kontrak itu tetap tersedia.
 */
describe('data pembahasan kuis', () => {
  it('mengembalikan jawaban, kunci, dan penjelasan setelah dikirim', async () => {
    const db = await database(env);
    const email = 'review-kuis@example.com';
    const cookie = await signIn(email, 'Review Kuis');
    const user = await userRow(email);

    const started = await api('/api/paths', {
      method: 'POST',
      json: { topic: 'Dasar analisis regresi untuk pemula' },
      cookie,
    });
    const { pathId, jobId } = await jsonBody<{ pathId: string; jobId: string }>(
      started,
    );
    expect(await processGeneration(env, jobId, 1)).toBe('ack');

    const beforeQuiz = (await pathDetail(db, user.id, pathId)) as {
      chapters: { id: string }[];
    };
    const chapterId = beforeQuiz.chapters[0]?.id;
    if (!chapterId) throw new Error('bab tidak ada');

    const quiz = await api(`/api/chapters/${chapterId}/quiz`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(quiz.status).toBe(202);
    const { quizId, jobId: quizJobId } = await jsonBody<{
      quizId: string;
      jobId: string;
    }>(quiz);
    expect(await processGeneration(env, quizJobId, 1)).toBe('ack');

    const payload = (await pathDetail(db, user.id, pathId)) as unknown as {
      chapters: {
        id: string;
        quiz: {
          id: string;
          questions: {
            id: string;
            choices: string[];
            selected: number | null;
            correctIndex: number | null;
          }[];
        } | null;
      }[];
    };
    const quizPayload = payload.chapters.find(
      (item) => item.id === chapterId,
    )?.quiz;
    if (!quizPayload) throw new Error('kuis tidak ada');
    const questions = quizPayload.questions;
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions[0]?.selected).toBeNull();
    expect(questions[0]?.correctIndex).toBeNull();

    const rows = await env.DB.prepare(
      'select correct_index as correctIndex from quiz_question where quiz_id = ? order by position',
    )
      .bind(quizId)
      .all<{ correctIndex: number }>();
    const keys = (rows.results ?? []).map((row) => Number(row.correctIndex));
    expect(keys.length).toBe(questions.length);

    const wrongChoice = (keys[0] ?? 0) === 0 ? 1 : 0;
    const answers = questions.map((_, index) =>
      index === 0 ? wrongChoice : (keys[index] ?? 0),
    );
    const result = await submitQuizAttempt(db, user, quizId, answers);
    const review = result.review as {
      selected: number;
      correctIndex: number;
      explanation: string | null;
      choices: string[];
    }[];
    expect(review[0]?.selected).toBe(wrongChoice);
    expect(review[0]?.correctIndex).toBe(keys[0]);
    expect(typeof review[0]?.explanation).toBe('string');
    expect(review[1]?.explanation).toBeNull();
    const expectedScore = Math.round(
      ((questions.length - 1) / questions.length) * 100,
    );
    expect(result.scorePercent).toBe(expectedScore);

    const after = (await pathDetail(db, user.id, pathId)) as unknown as {
      chapters: {
        id: string;
        quiz: {
          questions: {
            selected: number | null;
            correctIndex: number | null;
            explanation: string | null;
          }[];
          attempt: { scorePercent: number } | null;
        } | null;
      }[];
    };
    const reloaded = after.chapters.find((item) => item.id === chapterId)?.quiz;
    expect(reloaded?.attempt?.scorePercent).toBe(expectedScore);
    expect(reloaded?.questions[0]?.selected).toBe(wrongChoice);
    expect(reloaded?.questions[0]?.correctIndex).toBe(keys[0]);
    expect(typeof reloaded?.questions[0]?.explanation).toBe('string');
    expect(reloaded?.questions[1]?.explanation).toBeNull();

    const perfect = questions.map((_, index) => keys[index] ?? 0);
    const second = await submitQuizAttempt(db, user, quizId, perfect);
    expect(second.scorePercent).toBe(100);

    const history = (await pathDetail(db, user.id, pathId)) as unknown as {
      chapters: {
        id: string;
        quiz: {
          attempt: { scorePercent: number } | null;
          attempts: { id: string; scorePercent: number; createdAt: string }[];
        } | null;
      }[];
    };
    const after2 = history.chapters.find((item) => item.id === chapterId)?.quiz;
    expect(after2?.attempt?.scorePercent).toBe(100);
    expect(after2?.attempts.length).toBe(2);
    expect(
      [...(after2?.attempts ?? [])]
        .map((item) => item.scorePercent)
        .sort((a, b) => a - b),
    ).toEqual([expectedScore, 100]);
    for (const item of after2?.attempts ?? []) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.createdAt).toBe('string');
    }
  });
});
