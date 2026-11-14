import { describe, expect, it } from 'vitest';
import { buildShareOgSvg, escapeXml, wrapText } from '../src/domain/share-og';

describe('OG image materi', () => {
  it('membungkus judul panjang maksimal tiga baris', () => {
    const svg = buildShareOgSvg({
      eyebrow: 'Jalur · Bab 2',
      title: 'Kata '.repeat(40).trim(),
      footer: '6 referensi · dibagikan lewat Otodidak',
    });
    expect(svg).toContain('width="1200"');
    expect((svg.match(/font-size="60"/g) ?? []).length).toBeLessThanOrEqual(3);
    expect(svg).toContain('…');
    expect(svg).toContain('otodidak.web.id');
  });

  it('meng-escape teks agar SVG valid', () => {
    expect(escapeXml('a & b <c> "d"')).toBe(
      'a &amp; b &lt;c&gt; &quot;d&quot;',
    );
    const svg = buildShareOgSvg({
      eyebrow: 'R&D',
      title: 'A <b> & C',
      footer: 'x',
    });
    expect(svg).toContain('R&amp;D');
    expect(svg).toContain('A &lt;b&gt; &amp; C');
  });

  it('tidak melebihi batas karakter per baris', () => {
    for (const line of wrapText('kata '.repeat(30), 20, 3))
      expect(line.length).toBeLessThanOrEqual(21);
  });
});
