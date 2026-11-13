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
  claims: { quote: string; unsourced: boolean }[],
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

  for (const claim of claims) {
    if (!claim.unsourced) continue;
    const quote = escapeHtml(claim.quote);
    const marked = `${quote} <span class="tanpa-sumber">Tanpa sumber</span>`;
    if (quote && html.includes(quote)) html = html.replaceAll(quote, marked);
    else html += `<p>${marked}</p>`;
  }
  return html;
}
