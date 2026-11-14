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

export type LessonDiagram = {
  after: number;
  kind: 'flow' | 'hierarchy' | 'compare' | 'steps';
  title: string;
  nodes: { label: string; detail?: string }[];
  edges?: number[][];
};

const GAP = 28;
const PAD = 24;
const LINE_H = 15;
const BOX_PAD = 12;

function wrapLabel(label: string, detail: string | undefined): string[] {
  const words = `${label}${detail ? ` — ${detail}` : ''}`
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 26 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function textLines(
  lines: string[],
  x: number,
  y: number,
  className: string,
): string {
  return lines
    .map(
      (line, index) =>
        `<text class="${className}" x="${x}" y="${y + index * LINE_H}" text-anchor="middle">${escapeHtml(line)}</text>`,
    )
    .join('');
}

function box(
  x: number,
  y: number,
  width: number,
  height: number,
  lines: string[],
  accent: boolean,
): string {
  const centerX = x + width / 2;
  const startY = y + BOX_PAD + 11;
  return [
    `<rect class="diagram-box${accent ? ' diagram-box-accent' : ''}" x="${x}" y="${y}" width="${width}" height="${height}" rx="10" />`,
    textLines(lines, centerX, startY, 'diagram-text'),
  ].join('');
}

function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  marker: string,
): string {
  return `<path class="diagram-line" marker-end="url(#${marker})" d="M${x1} ${y1} L${x2} ${y2}" />`;
}

/** Diagram SVG murni (tanpa JS), aman terhadap CSP `style-src 'self'`. */
export function diagramSvg(diagram: LessonDiagram, index: number): string {
  const width = 720;
  const marker = `diagram-arrow-${index}`;
  const parts: string[] = [];
  let height = 0;

  const nodes = diagram.nodes.slice(0, 8);
  const wrapped = nodes.map((node) => wrapLabel(node.label, node.detail));
  const heights = wrapped.map((lines) => BOX_PAD * 2 + lines.length * LINE_H);

  if (diagram.kind === 'steps') {
    height =
      PAD * 2 +
      heights.reduce((sum, value) => sum + value, 0) +
      (nodes.length - 1) * 30;
    let y = PAD;
    nodes.forEach((_, nodeIndex) => {
      const boxHeight = heights[nodeIndex] ?? 40;
      parts.push(
        box(
          PAD,
          y,
          width - PAD * 2,
          boxHeight,
          wrapped[nodeIndex] ?? [],
          nodeIndex === 0,
        ),
      );
      if (nodeIndex < nodes.length - 1) {
        parts.push(
          arrow(
            width / 2,
            y + boxHeight,
            width / 2,
            y + boxHeight + 22,
            marker,
          ),
        );
      }
      y += boxHeight + 30;
    });
  } else if (diagram.kind === 'hierarchy') {
    const rootLines = wrapped[0] ?? [];
    const rootHeight = BOX_PAD * 2 + rootLines.length * LINE_H;
    const children = nodes.slice(1);
    const childLines = wrapped.slice(1);
    const childHeights = heights.slice(1);
    const cols = Math.min(children.length, 3);
    const rows = Math.ceil(children.length / cols);
    const childWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;
    const rowHeight = Math.max(...childHeights, 40);
    height = PAD * 2 + rootHeight + 34 + rows * rowHeight + (rows - 1) * 18;
    const rootWidth = Math.min(300, width - PAD * 2);
    const rootX = (width - rootWidth) / 2;
    parts.push(box(rootX, PAD, rootWidth, rootHeight, rootLines, true));
    const rowTop = PAD + rootHeight + 34;
    children.forEach((_, childIndex) => {
      const row = Math.floor(childIndex / cols);
      const col = childIndex % cols;
      const x = PAD + col * (childWidth + GAP);
      const y = rowTop + row * (rowHeight + 18);
      parts.push(
        box(
          x,
          y,
          childWidth,
          childHeights[childIndex] ?? rowHeight,
          childLines[childIndex] ?? [],
          false,
        ),
      );
      parts.push(
        arrow(width / 2, PAD + rootHeight, x + childWidth / 2, y - 4, marker),
      );
    });
  } else if (diagram.kind === 'compare') {
    const cols = Math.min(nodes.length, 2);
    const colWidth = (width - PAD * 2 - GAP) / cols;
    const colHeight = Math.max(...heights, 48);
    height = PAD * 2 + colHeight;
    nodes.slice(0, 2).forEach((_, nodeIndex) => {
      parts.push(
        box(
          PAD + nodeIndex * (colWidth + GAP),
          PAD,
          colWidth,
          colHeight,
          wrapped[nodeIndex] ?? [],
          false,
        ),
      );
    });
  } else {
    const cols = Math.min(nodes.length, 3);
    const rows = Math.ceil(nodes.length / cols);
    const colWidth = (width - PAD * 2 - GAP * (cols - 1)) / cols;
    const rowHeight = Math.max(...heights, 44);
    height = PAD * 2 + rows * rowHeight + (rows - 1) * 26;
    nodes.forEach((_, nodeIndex) => {
      const row = Math.floor(nodeIndex / cols);
      const col = nodeIndex % cols;
      const x = PAD + col * (colWidth + GAP);
      const y = PAD + row * (rowHeight + 26);
      parts.push(
        box(
          x,
          y,
          colWidth,
          rowHeight,
          wrapped[nodeIndex] ?? [],
          nodeIndex === 0,
        ),
      );
      if (col < cols - 1 && nodeIndex < nodes.length - 1) {
        parts.push(
          arrow(
            x + colWidth,
            y + rowHeight / 2,
            x + colWidth + GAP - 6,
            y + rowHeight / 2,
            marker,
          ),
        );
      }
    });
  }

  const titleId = `diagram-title-${index}`;
  return [
    '<figure class="diagram">',
    `<svg class="diagram-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}" preserveAspectRatio="xMidYMid meet">`,
    `<title id="${titleId}">${escapeHtml(diagram.title)}</title>`,
    `<defs><marker id="${marker}" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path class="diagram-arrow" d="M0 0 L9 4.5 L0 9 z" /></marker></defs>`,
    ...parts,
    '</svg>',
    `<figcaption class="diagram-caption">${escapeHtml(diagram.title)}</figcaption>`,
    '</figure>',
  ].join('');
}

export function renderLesson(
  markdown: string,
  options: {
    claims?: { quote: string; unsourced: boolean }[];
    sources?: { id: string; url: string; title: string }[];
    diagrams?: LessonDiagram[];
  } = {},
): string {
  const diagrams = (options.diagrams ?? [])
    .filter((diagram) => diagram.nodes.length >= 2)
    .slice(0, 2);
  const markers = new Map<number, string>();
  diagrams.forEach((diagram, index) => {
    markers.set(diagram.after, `<!--diagram:${index}-->`);
  });

  const blocks = escapeHtml(markdown).split(/\n{2,}/);
  let headingCount = 0;
  let html = blocks
    .map((block) => {
      const lines = block.split('\n');
      const first = lines[0] ?? '';
      if (lines.length === 1 && first.startsWith('## ')) {
        headingCount += 1;
        const marker = markers.get(headingCount) ?? '';
        return `<h2>${inline(first.slice(3))}</h2>${marker}`;
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

  diagrams.forEach((diagram, index) => {
    html = html.replace(`<!--diagram:${index}-->`, diagramSvg(diagram, index));
  });
  return html.replace(/<!--diagram:\d+-->/g, '');
}

export function parseLessonDiagrams(value: unknown): LessonDiagram[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is LessonDiagram => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as LessonDiagram;
        return (
          Array.isArray(candidate.nodes) &&
          typeof candidate.title === 'string' &&
          ['flow', 'hierarchy', 'compare', 'steps'].includes(candidate.kind)
        );
      })
      .slice(0, 2);
  } catch {
    return [];
  }
}
