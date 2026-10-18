/**
 * Small CSV/TSV reader and writer for localization tables. Choose the delimiter from the first line:
 * tab (pasted spreadsheet data), then semicolon (Turkish/German Excel), then comma. Supports quoted
 * fields, escaped quotes (""), and newlines inside quotes.
 */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = src.split('\n', 1)[0] ?? '';
  const delim = first.includes('\t')
    ? '\t'
    : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Convert rows to comma-separated CSV, quoting fields as needed. */
export function toCsv(rows: string[][]): string {
  const q = (v: string) => (/[",\n;\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(q).join(',')).join('\n');
}
