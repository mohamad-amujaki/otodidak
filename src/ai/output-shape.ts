type SchemaIssue = {
  path: readonly PropertyKey[];
  code: string;
};

/** Ringkasan issue Zod tanpa nilai field, aman ditampilkan ke pengguna/admin. */
export function schemaIssueSummary(
  task: string,
  issues: readonly SchemaIssue[],
): string {
  const rows = issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path} (${issue.code})`;
    })
    .join(', ');
  return `Skema ${task}: ${rows}`.slice(0, 400);
}

/**
 * Cuplikan bentuk output untuk log: nama field, tipe, dan panjang string.
 * Isi prosa tidak disalin agar log tetap kecil dan tidak memuat data sensitif.
 */
export function describeOutput(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const first =
      value.length > 0 && depth < 2
        ? `[${describeOutput(value[0], depth + 1)}]`
        : '';
    return `array(${value.length})${first}`;
  }
  if (typeof value === 'string') return `string(${value.length})`;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${typeof value}(${value})`;
  if (typeof value === 'object') {
    if (depth >= 2) return 'object';
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      24,
    );
    const inner = entries
      .map(([key, item]) => `${key}:${describeOutput(item, depth + 1)}`)
      .join(',');
    return `{${inner}}`;
  }
  return typeof value;
}
