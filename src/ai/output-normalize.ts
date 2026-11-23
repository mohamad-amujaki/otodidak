const SOURCE_KINDS = new Set([
  'article',
  'video',
  'documentation',
  'course',
  'paper',
  'book',
  'other',
]);

const DIAGRAM_KINDS = new Set(['flow', 'hierarchy', 'compare', 'steps']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function optionalText(value: unknown, max: number): string | undefined {
  return text(value, max) ?? undefined;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let raw = value.trim();
  if (!raw) return null;
  if (/^www\./i.test(raw)) raw = `https://${raw}`;
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function stringArray(
  value: unknown,
  max: number,
  limit: number,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .map((item) => text(item, max))
    .filter((item): item is string => item !== null)
    .slice(0, limit);
  return rows.length > 0 ? rows : undefined;
}

/**
 * Model sering mengirim `null` untuk field opsional. Zod `.optional()` hanya
 * menerima field yang tidak ada, jadi null harus dibuang sebelum validasi.
 */
export function normalizeLessonOutput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const markdown =
    text(value.markdown, 100_000) ??
    text(value.body, 100_000) ??
    text(value.content, 100_000);

  const result = normalizeSources(value.sources, markdown);
  const output: Record<string, unknown> = {};
  if (result.markdown) output.markdown = result.markdown;
  output.sources = result.sources;

  const adds = optionalText(value.adds, 200);
  if (adds) output.adds = adds;

  const buildsOn = stringArray(value.buildsOn, 80, 6);
  if (buildsOn) output.buildsOn = buildsOn;

  const concepts = normalizeConcepts(value.concepts);
  if (concepts) output.concepts = concepts;

  const lessonCase = normalizeCase(value.case);
  if (lessonCase) output.case = lessonCase;

  const diagrams = normalizeDiagrams(value.diagrams);
  if (diagrams) output.diagrams = diagrams;

  return output;
}

export function normalizeOutlineOutput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {
    title: text(value.title, 160) ?? '',
    objective: text(value.objective, 400) ?? '',
  };
  const keyMessage = optionalText(value.keyMessage, 240);
  if (keyMessage) output.keyMessage = keyMessage;
  const coreConcept = optionalText(value.coreConcept, 60);
  if (coreConcept) output.coreConcept = coreConcept;
  return output;
}

function normalizeConcepts(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const rows: { term: string; gloss: string }[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const term = text(entry.term, 80);
    const gloss = text(entry.gloss, 160);
    if (!term || !gloss) continue;
    rows.push({ term, gloss });
    if (rows.length === 6) break;
  }
  return rows.length > 0 ? rows : undefined;
}

function normalizeCase(value: unknown) {
  if (!isRecord(value)) return undefined;
  const role = text(value.role, 120);
  const numbers = text(value.numbers, 160);
  const artifact = text(value.artifact, 160);
  const dilemma = text(value.dilemma, 200);
  if (!role || !numbers || !artifact || !dilemma) return undefined;
  return { role, numbers, artifact, dilemma };
}

function normalizeDiagrams(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const rows: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const kind =
      typeof entry.kind === 'string' && DIAGRAM_KINDS.has(entry.kind)
        ? entry.kind
        : null;
    const title = text(entry.title, 120);
    if (!kind || !title) continue;
    const afterRaw =
      typeof entry.after === 'number' && Number.isFinite(entry.after)
        ? Math.trunc(entry.after)
        : null;
    if (afterRaw === null) continue;
    const after = Math.min(20, Math.max(1, afterRaw));
    const nodes: { label: string; detail?: string }[] = [];
    if (Array.isArray(entry.nodes)) {
      for (const node of entry.nodes) {
        if (!isRecord(node)) continue;
        const label = text(node.label, 80);
        if (!label) continue;
        const detail = optionalText(node.detail, 120);
        nodes.push(detail ? { label, detail } : { label });
        if (nodes.length === 8) break;
      }
    }
    if (nodes.length < 2) continue;
    const diagram: Record<string, unknown> = { after, kind, title, nodes };
    if (Array.isArray(entry.edges)) {
      const edges = entry.edges
        .filter(
          (edge) =>
            Array.isArray(edge) &&
            edge.length === 2 &&
            Number.isInteger(edge[0]) &&
            Number.isInteger(edge[1]) &&
            edge[0] >= 0 &&
            edge[0] < nodes.length &&
            edge[1] >= 0 &&
            edge[1] < nodes.length,
        )
        .slice(0, 12);
      if (edges.length > 0) diagram.edges = edges;
    }
    rows.push(diagram);
    if (rows.length === 2) break;
  }
  return rows.length > 0 ? rows : undefined;
}

function normalizeSources(value: unknown, markdown: string | null) {
  if (value == null) return { sources: [], markdown };
  if (!Array.isArray(value)) return { sources: [], markdown };
  const sources: Record<string, string>[] = [];
  const keptIds = new Set<string>();
  const droppedIds = new Set<string>();
  for (const entry of value) {
    if (sources.length >= 6) break;
    if (!isRecord(entry)) continue;
    const id = text(entry.id, 64) ?? `s${sources.length + 1}`;
    const url = httpUrl(entry.url);
    const title = text(entry.title, 180);
    const kind =
      typeof entry.kind === 'string' && SOURCE_KINDS.has(entry.kind)
        ? entry.kind
        : null;
    if (!url || !title || !kind || keptIds.has(id)) {
      droppedIds.add(id);
      continue;
    }
    const publisher = optionalText(entry.publisher, 120);
    sources.push(
      publisher
        ? { id, url, title, publisher, kind }
        : { id, url, title, kind },
    );
    keptIds.add(id);
  }
  let next = markdown;
  if (next) {
    for (const id of droppedIds) next = next.split(`[[${id}]]`).join('');
  }
  return { sources, markdown: next };
}
