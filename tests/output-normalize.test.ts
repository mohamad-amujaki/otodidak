import { describe, expect, it } from 'vitest';
import { parseModelOutput } from '../src/ai/generate';
import { normalizeLessonOutput } from '../src/ai/output-normalize';

const markdown = 'Pelajaran contoh yang cukup panjang untuk lolos validasi.';

describe('normalisasi output lesson', () => {
  it('membuang field opsional bernilai null dan kunci tambahan', () => {
    const parsed = parseModelOutput('lesson', {
      markdown,
      case: null,
      concepts: null,
      diagrams: null,
      buildsOn: null,
      adds: null,
      title: 'Judul yang tidak diminta',
      sources: [],
    });
    expect(parsed).toMatchObject({ markdown, sources: [] });
    expect(parsed).not.toHaveProperty('case');
    expect(parsed).not.toHaveProperty('title');
  });

  it('menerima alias body sebagai markdown', () => {
    const parsed = parseModelOutput('lesson', {
      body: markdown,
      sources: [],
    });
    expect(parsed).toMatchObject({ markdown });
  });

  it('memotong field yang melewati batas, bukan menggagalkan pelajaran', () => {
    const parsed = parseModelOutput('lesson', {
      markdown,
      adds: 'a'.repeat(500),
      case: {
        role: 'r'.repeat(200),
        numbers: 'n'.repeat(400),
        artifact: 'x'.repeat(400),
        dilemma: 'd'.repeat(600),
      },
      sources: [],
    });
    expect(parsed).toMatchObject({ markdown });
    const lesson = parsed as {
      adds?: string;
      case?: {
        role: string;
        numbers: string;
        artifact: string;
        dilemma: string;
      };
    };
    expect(lesson.adds?.length).toBe(200);
    expect(lesson.case?.role.length).toBe(120);
    expect(lesson.case?.numbers.length).toBe(160);
    expect(lesson.case?.dilemma.length).toBe(200);
  });

  it('membuang sumber cacat dan penandanya di markdown', () => {
    const parsed = parseModelOutput('lesson', {
      markdown: `${markdown} Klaim penting [[s1]] dan [[s2]].`,
      sources: [
        {
          id: 's1',
          url: 'bukan-url',
          title: 'Sumber rusak',
          kind: 'article',
        },
        {
          id: 's2',
          url: 'https://example.com/sumber',
          title: 'Sumber valid',
          kind: 'article',
        },
      ],
    });
    const lesson = parsed as {
      markdown: string;
      sources: { id: string }[];
    };
    expect(lesson.sources).toHaveLength(1);
    expect(lesson.sources[0]?.id).toBe('s2');
    expect(lesson.markdown).not.toContain('[[s1]]');
    expect(lesson.markdown).toContain('[[s2]]');
  });

  it('membuang diagram cacat dan menjepit posisi after', () => {
    const parsed = parseModelOutput('lesson', {
      markdown,
      sources: [],
      diagrams: [
        {
          after: 99,
          kind: 'steps',
          title: 'Alur',
          nodes: [{ label: 'A' }, { label: 'B' }],
        },
        {
          after: 1,
          kind: 'tidak-ada',
          title: 'Salah',
          nodes: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    });
    const lesson = parsed as {
      diagrams?: { after: number; title: string }[];
    };
    expect(lesson.diagrams).toHaveLength(1);
    expect(lesson.diagrams?.[0]?.after).toBe(20);
  });

  it('menyebut field yang gagal di detail error', () => {
    expect(() => normalizeAndParse({})).toThrowError(/markdown/);
  });
});

function normalizeAndParse(value: unknown) {
  return parseModelOutput('lesson', normalizeLessonOutput(value));
}
