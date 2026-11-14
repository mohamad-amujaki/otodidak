export const lessonMinWords = 800;
export const lessonMaxWords = 1200;

export const forbiddenLessonHeadings = [
  'pendahuluan',
  'pengertian',
  'latar belakang',
  'manfaat',
  'cara menerapkan',
  'langkah-langkah',
  'kesalahan umum',
  'tips',
  'kesimpulan',
  'ringkasan',
  'penutup',
  'studi kasus',
];

export const lessonClichés = [
  'pada era digital ini',
  'di era yang serba cepat',
  'sangat penting untuk',
  'perlu diketahui bahwa',
  'dengan demikian dapat disimpulkan',
  'mari kita bahas',
  'tak dapat dipungkiri',
  'pada akhirnya',
];

const markerPattern = /\[\[[a-z0-9_-]+\]\]/gi;
const unit =
  'persen|%|menit|jam|hari|bulan|tahun|detik|halaman|kata|kali|orang|juta|miliar|ribu|rp\\.?|rupiah';
const spell =
  'satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|dua belas|tiga puluh|empat puluh|lima puluh';
const specificPattern = new RegExp(
  `(?:\\d+(?:[.,]\\d+)?\\s*(?:${unit})?|(?:${spell})\\s+(?:${unit}))`,
  'gi',
);
const contrastPattern =
  /bedanya|sebaliknya|versi (?:lemah|biasa|bawah)|yang biasa orang|dibanding versi|sedangkan versi/i;
const limitsPattern =
  /batas|keberatan|tidak cocok|kurang cocok|kelemahan|kapan .{0,24}tidak/i;
const summaryPattern = /^##\s*\*\*inti pelajaran:?\*\*/im;

export function proseOf(body: string): string {
  return body
    .replace(/^#{1,6}.*$/gm, ' ')
    .replace(markerPattern, ' ')
    .replace(/[*_`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(body: string): number {
  const prose = proseOf(body);
  return prose === '' ? 0 : prose.split(' ').length;
}

export function sentencesOf(body: string): string[] {
  return proseOf(body)
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function countShortSentences(body: string, maxWords = 8): number {
  return sentencesOf(body).filter(
    (sentence) => sentence.split(' ').length <= maxWords,
  ).length;
}

export function averageSentenceWords(body: string): number {
  const sentences = sentencesOf(body);
  if (sentences.length === 0) return 0;
  const total = sentences.reduce(
    (sum, sentence) => sum + sentence.split(' ').length,
    0,
  );
  return Math.round(total / sentences.length);
}

export function listHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const line of body.split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    const label = match[1]
      .replace(/\*\*/g, '')
      .replace(/:$/, '')
      .trim()
      .toLowerCase();
    if (label === 'inti pelajaran') continue;
    headings.push(label);
  }
  return headings;
}

export function wrongLevelHeadings(body: string): string[] {
  const wrong: string[] = [];
  for (const line of body.split('\n')) {
    const match = /^(#{1,6})\s+(\S.*)$/.exec(line.trim());
    if (!match?.[1] || !match[2]) continue;
    if (match[1].length !== 2) wrong.push(match[2].trim().toLowerCase());
  }
  return wrong;
}

export function countBulletLines(body: string): number {
  return body
    .split('\n')
    .filter((line) => /^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)).length;
}

export function countSpecifics(body: string): number {
  return (proseOf(body).match(specificPattern) ?? []).length;
}

export function hasContrast(body: string): boolean {
  return contrastPattern.test(body);
}

export function hasLimits(body: string): boolean {
  return limitsPattern.test(body);
}

export function hasSummary(body: string): boolean {
  return summaryPattern.test(body);
}

export function clichesIn(body: string): string[] {
  const lower = body.toLowerCase();
  return lessonClichés.filter((cliche) => lower.includes(cliche));
}

export interface LessonQualityOptions {
  minWords?: number;
  maxWords?: number;
}

export interface LessonQualityReport {
  words: number;
  headings: string[];
  wrongLevelHeadings: string[];
  bullets: number;
  shortSentences: number;
  averageSentenceWords: number;
  specifics: number;
  hasContrast: boolean;
  hasLimits: boolean;
  hasSummary: boolean;
  cliches: string[];
  issues: string[];
}

export function auditLessonQuality(
  body: string,
  options: LessonQualityOptions = {},
): LessonQualityReport {
  const minWords = options.minWords ?? lessonMinWords;
  const maxWords = options.maxWords ?? lessonMaxWords;
  const words = wordCount(body);
  const headings = listHeadings(body);
  const wrongLevel = wrongLevelHeadings(body);
  const bullets = countBulletLines(body);
  const shortSentences = countShortSentences(body);
  const average = averageSentenceWords(body);
  const specifics = countSpecifics(body);
  const contrast = hasContrast(body);
  const limits = hasLimits(body);
  const summary = hasSummary(body);
  const cliches = clichesIn(body);
  const issues: string[] = [];
  if (words < minWords) issues.push(`pendek: ${words} kata (min ${minWords})`);
  if (words > maxWords)
    issues.push(`panjang: ${words} kata (maks ${maxWords})`);
  if (headings.length < 4) issues.push(`heading kurang: ${headings.length}`);
  if (headings.length > 7) issues.push(`heading lebih: ${headings.length}`);
  const generic = headings.filter((heading) =>
    forbiddenLessonHeadings.includes(heading),
  );
  if (generic.length > 0) issues.push(`heading generik: ${generic.join(', ')}`);
  if (wrongLevel.length > 0)
    issues.push(`heading bukan level 2: ${wrongLevel.join(', ')}`);
  if (bullets > 6) issues.push(`bullet berlebih: ${bullets} baris`);
  if (shortSentences < 6)
    issues.push(`kalimat pendek kurang: ${shortSentences}`);
  if (average > 24)
    issues.push(`kalimat terlalu panjang: rata-rata ${average}`);
  if (specifics < 5) issues.push(`detail konkret kurang: ${specifics}`);
  if (!contrast) issues.push('tanpa kontras versi lemah vs kuat');
  if (!limits) issues.push('tanpa bagian batas/keberatan');
  if (!summary) issues.push('tanpa penutup "Inti pelajaran"');
  if (cliches.length > 0) issues.push(`klise: ${cliches.join(', ')}`);
  return {
    words,
    headings,
    wrongLevelHeadings: wrongLevel,
    bullets,
    shortSentences,
    averageSentenceWords: average,
    specifics,
    hasContrast: contrast,
    hasLimits: limits,
    hasSummary: summary,
    cliches,
    issues,
  };
}

export function normaliseSentence(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(sentence: string): Set<string> {
  const words = normaliseSentence(sentence).split(' ').filter(Boolean);
  const grams = new Set<string>();
  for (let index = 0; index < words.length - 2; index += 1)
    grams.add(words.slice(index, index + 3).join(' '));
  return grams;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Kalimat di `body` yang sudah muncul (mirip) di pelajaran sebelumnya. */
export function repeatedSentences(body: string, earlier: string[]): string[] {
  if (earlier.length === 0) return [];
  const references = earlier.map((text) => {
    const sentences = sentencesOf(text).filter(
      (sentence) => sentence.split(' ').length >= 6,
    );
    return sentences.map((sentence) => trigrams(sentence));
  });
  const repeated: string[] = [];
  for (const sentence of sentencesOf(body)) {
    if (sentence.split(' ').length < 6) continue;
    const grams = trigrams(sentence);
    if (grams.size === 0) continue;
    const duplicate = references.some((reference) =>
      reference.some((candidate) => jaccard(grams, candidate) >= 0.6),
    );
    if (duplicate) repeated.push(sentence.trim());
  }
  return repeated;
}

/** Rasio tumpang tindih 0..1 antara satu pelajaran dan kumpulan sebelumnya. */
export function overlapRatio(body: string, earlier: string[]): number {
  if (earlier.length === 0) return 0;
  const grams = trigrams(body);
  if (grams.size === 0) return 0;
  const reference = trigrams(earlier.join(' '));
  return jaccard(grams, reference);
}
