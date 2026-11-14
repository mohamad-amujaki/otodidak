import { describe, expect, it } from 'vitest';
import { parseLessonDiagrams, renderLesson } from '../src/domain/markdown';

describe('renderLesson sitasi', () => {
  it('mengubah marker [[id]] menjadi tautan sup bernomor', () => {
    const html = renderLesson('Klaim penting. [[s1]]', {
      sources: [{ id: 's1', url: 'https://example.com/rujukan', title: 'X' }],
    });
    expect(html).toContain(
      '<sup class="sitasi"><a href="https://example.com/rujukan"',
    );
    expect(html).toContain('[1]');
  });

  it('membuang marker yang tidak punya sumber', () => {
    const html = renderLesson('Klaim tanpa sumber. [[hilang]]', {
      sources: [],
    });
    expect(html).not.toContain('[[');
    expect(html).toContain('Klaim tanpa sumber.');
  });
});

describe('diagram pelajaran', () => {
  const markdown = `Pembuka singkat.

## Pertama

Isi bagian pertama.

## Kedua

Isi bagian kedua.`;

  it('menyisipkan SVG setelah heading yang diminta', () => {
    const html = renderLesson(markdown, {
      diagrams: [
        {
          after: 2,
          kind: 'steps',
          title: 'Alur keputusan',
          nodes: [{ label: 'Kesimpulan dulu' }, { label: 'Argumen di bawah' }],
        },
      ],
    });
    const figure = html.indexOf('<figure class="diagram">');
    const firstHeading = html.indexOf('<h2>Pertama</h2>');
    const secondHeading = html.indexOf('<h2>Kedua</h2>');
    expect(figure).toBeGreaterThan(firstHeading);
    expect(figure).toBeGreaterThan(secondHeading);
    expect(html).toContain(
      '<title id="diagram-title-0">Alur keputusan</title>',
    );
    expect(html).toContain('diagram-caption');
    expect(html).toContain('<text');
  });

  it('mengabaikan diagram dengan node kurang dari dua', () => {
    const html = renderLesson(markdown, {
      diagrams: [
        { after: 1, kind: 'flow', title: 'X', nodes: [{ label: 'Satu' }] },
      ],
    });
    expect(html).not.toContain('<figure class="diagram">');
  });

  it('membaca diagram tersimpan dan menolak nilai rusak', () => {
    const saved = JSON.stringify([
      {
        after: 1,
        kind: 'compare',
        title: 'Dua sisi',
        nodes: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    expect(parseLessonDiagrams(saved)).toHaveLength(1);
    expect(parseLessonDiagrams('bukan json')).toHaveLength(0);
    expect(parseLessonDiagrams(null)).toHaveLength(0);
  });
});
