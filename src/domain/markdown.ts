function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inline(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function renderLesson(
  markdown: string,
  options: {
    claims?: { quote: string; unsourced: boolean }[];
    sources?: { id: string; url: string; title: string }[];
  } = {},
): string {
  const blocks = escapeHtml(markdown).split(/\n{2,}/);
  let html = blocks
    .map((block) => {
      const lines = block.split('\n');
      const first = lines[0] ?? '';
      if (lines.length === 1 && first.startsWith('## ')) {
        return `<h2>${inline(first.slice(3))}</h2>`;
      }
      if (lines.every((line) => line.startsWith('- '))) {
        const items = lines
          .map((line) => `<li>${inline(line.slice(2))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${lines.map((line) => inline(line)).join('<br />')}</p>`;
    })
    .join('');

  const sources = options.sources ?? [];
  const citations = new Map<string, { n: number; url: string }>();
  sources.forEach((source, index) => {
    citations.set(source.id, { n: index + 1, url: source.url });
  });
  html = html.replace(
    /\[\[([A-Za-z0-9_-]{1,64})\]\]/g,
    (_whole, id: string) => {
      const hit = citations.get(id);
      if (!hit) return '';
      return `<sup class="sitasi"><a href="${escapeHtml(hit.url)}" target="_blank" rel="noopener noreferrer">[${hit.n}]</a></sup>`;
    },
  );

  for (const claim of options.claims ?? []) {
    if (!claim.unsourced) continue;
    const quote = escapeHtml(claim.quote);
    const marked = `${quote} <span class="tanpa-sumber">Tanpa sumber</span>`;
    if (quote && html.includes(quote)) html = html.replaceAll(quote, marked);
    else html += `<p>${marked}</p>`;
  }
  return html;
}
