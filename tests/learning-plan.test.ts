import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { generatorTools } from '../src/ai/tools';
import { roadmapOutputSchema } from '../src/domain/schemas';
import { database } from '../src/server/account';
import { processGeneration } from '../src/server/generation';
import { api, jsonBody, signIn } from './helpers';

beforeEach(async () => {
  await database(env);
});

describe('field perencanaan jalur', () => {
  it('tool dan skema roadmap memuat field perencanaan', () => {
    const declared = JSON.stringify(generatorTools.roadmap.parameters);
    for (const key of [
      'audience',
      'governingThought',
      'runningCase',
      'keyQuestion',
      'keyMessage',
      'coreConcept',
    ])
      expect(declared).toContain(`"${key}"`);

    const parsed = roadmapOutputSchema.safeParse({
      title: 'Judul jalur',
      audience: 'Pemula yang baru mulai',
      governingThought: 'Setelah jalur ini kamu bisa memakainya',
      runningCase: 'Rani di Surabaya memakai topik ini untuk laporan bulanan',
      chapters: [
        {
          title: 'Bab',
          summary: 'Ringkas.',
          keyQuestion: 'Apa yang berubah?',
          lessons: [
            {
              title: 'Pelajaran',
              objective: 'Menjelaskan satu aspek',
              keyMessage: 'Satu kalimat kesimpulan.',
              coreConcept: 'Konsep inti',
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('menyimpan perencanaan jalur dan pelajaran dari outline', async () => {
    const cookie = await signIn('rencana@example.com');
    const started = await api('/api/paths', {
      method: 'POST',
      json: { topic: 'Merawat tanaman kopi di rumah' },
      cookie,
    });
    expect(started.status).toBe(202);
    const { pathId, jobId } = await jsonBody<{ pathId: string; jobId: string }>(
      started,
    );
    expect(await processGeneration(env, jobId, 1)).toBe('ack');

    const path = await env.DB.prepare(
      'select audience, governing_thought, running_case from path where id = ?',
    )
      .bind(pathId)
      .first<{
        audience: string | null;
        governing_thought: string | null;
        running_case: string | null;
      }>();
    expect(path?.audience).toBeTruthy();
    expect(path?.governing_thought).toBeTruthy();
    expect(path?.running_case).toBeTruthy();

    const lesson = await env.DB.prepare(
      'select key_message, core_concept from lesson where chapter_id in (select id from chapter where path_id = ?) limit 1',
    )
      .bind(pathId)
      .first<{ key_message: string | null; core_concept: string | null }>();
    expect(lesson?.key_message).toBeTruthy();
    expect(lesson?.core_concept).toBeTruthy();
  });
});
