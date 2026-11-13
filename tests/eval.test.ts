import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { database } from '../src/server/account';
import { processGeneration } from '../src/server/generation';
import { api, jsonBody, signIn } from './helpers';

/**
 * Rubrik struktural tanpa memanggil provider berbayar (mock mode).
 * Tujuan: gate regresi untuk skema, panjang, sitasi, dan kuis.
 */
const topics = [
  'Dasar analisis regresi untuk pemula',
  'Manajemen risiko proyek konstruksi',
  'Sistem distribusi air bersih perkotaan',
];

describe('QA eval rubrik (mock, tanpa biaya)', () => {
  it.each(topics)('roadmap + lesson + quiz: %s', async (topic, index) => {
    await database(env);
    const cookie = await signIn(`eval-${index}@example.com`, 'Eval');

    const started = await api('/api/paths', {
      method: 'POST',
      json: { topic },
      cookie,
    });
    expect(started.status).toBe(202);
    const { pathId, jobId } = await jsonBody<{
      pathId: string;
      jobId: string;
    }>(started);
    expect(await processGeneration(env, jobId, 1)).toBe('ack');

    const detailResponse = await api(`/api/paths/${pathId}`, { cookie });
    expect(detailResponse.status).toBe(200);
    const detail = await jsonBody<{
      title: string;
      chapters: { id: string; lessons: { id: string }[] }[];
    }>(detailResponse);
    expect(detail.title.trim().length).toBeGreaterThan(3);
    expect(detail.chapters.length).toBeGreaterThanOrEqual(2);
    for (const chapter of detail.chapters) {
      expect(chapter.lessons.length).toBeGreaterThanOrEqual(1);
    }

    const chapter = detail.chapters[0];
    if (!chapter) throw new Error('bab tidak ada');
    const lessonId = chapter.lessons[0]?.id;
    if (!lessonId) throw new Error('pelajaran tidak ada');

    const opened = await api(`/api/lessons/${lessonId}/open`, {
      method: 'POST',
      json: {},
      cookie,
    });
    expect(opened.status).toBe(202);
    expect(
      await processGeneration(
        env,
        (await jsonBody<{ jobId: string }>(opened)).jobId,
        1,
      ),
    ).toBe('ack');

    const contentResponse = await api(`/api/lessons/${lessonId}`, { cookie });
    const content = await jsonBody<{
      body: string;
      sources: { id: string; url: string; kind: string }[];
    }>(contentResponse);
    expect(content.body).toContain('**Inti pelajaran:**');
    const webSources = content.sources.filter(
      (source) => source.kind === 'web',
    );
    expect(webSources.length).toBeGreaterThanOrEqual(1);
    for (const source of webSources) {
      expect(source.url.startsWith('https://')).toBe(true);
      expect(content.body).toContain(`[[${source.id}]]`);
    }

    const quiz = await api(`/api/chapters/${chapter.id}/quiz`, {
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
    const rows = await env.DB.prepare(
      'select choices_json as choices from quiz_question where quiz_id = ?',
    )
      .bind(quizId)
      .all<{ choices: string }>();
    const questions = rows.results ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(3);
    for (const question of questions) {
      expect(JSON.parse(question.choices)).toHaveLength(4);
    }
  });
});
