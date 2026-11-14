export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function wrapText(
  text: string,
  maxChars: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  const last = trimmed[maxLines - 1] ?? '';
  trimmed[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  return trimmed;
}

/** SVG kartu 1200x630 untuk OG image materi yang dibagikan. */
export function buildShareOgSvg(input: {
  eyebrow: string;
  title: string;
  footer: string;
}): string {
  const lines = wrapText(input.title, 27, 3);
  const startY = lines.length > 2 ? 268 : lines.length > 1 ? 290 : 312;
  const titleMarkup = lines
    .map(
      (line, index) =>
        `<text x="80" y="${startY + index * 78}" font-family="Plus Jakarta Sans" font-size="60" fill="#102a43">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#f4f7fb"/>
  <rect x="0" y="0" width="14" height="${OG_HEIGHT}" fill="#0b6e4f"/>
  <circle cx="1080" cy="92" r="120" fill="#0b6e4f" opacity="0.06"/>
  <text x="80" y="96" font-family="Plus Jakarta Sans" font-size="26" fill="#0b6e4f" letter-spacing="4">OTODIDAK</text>
  <text x="80" y="168" font-family="Plus Jakarta Sans" font-size="24" fill="#607d8b">${escapeXml(input.eyebrow)}</text>
  ${titleMarkup}
  <rect x="80" y="${OG_HEIGHT - 120}" width="64" height="3" rx="1.5" fill="#0b6e4f" opacity="0.5"/>
  <text x="80" y="${OG_HEIGHT - 72}" font-family="Plus Jakarta Sans" font-size="22" fill="#607d8b">${escapeXml(input.footer)}</text>
  <text x="${OG_WIDTH - 80}" y="${OG_HEIGHT - 72}" text-anchor="end" font-family="Plus Jakarta Sans" font-size="22" fill="#607d8b">otodidak.web.id</text>
</svg>`;
}
