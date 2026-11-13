import { describe, expect, it } from 'vitest';
import { renderLesson } from '../src/domain/markdown';

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
