/**
 * Shared CSV helpers: RFC4180 escaping + UTF-8 BOM for Excel.
 */

export const CSV_BOM = '\uFEFF';

export function escapeCsvCell(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Convert array of row arrays to CSV text (with BOM). First row should be headers. */
export function rowsToCsv(rows, { bom = true } = {}) {
  const body = (rows || [])
    .map((row) => (row || []).map(escapeCsvCell).join(','))
    .join('\n');
  return bom ? `${CSV_BOM}${body}` : body;
}

/** Convert array of objects using a fixed header list. */
export function objectsToCsv(headers, objects, { bom = true } = {}) {
  const rows = [
    headers,
    ...(objects || []).map((obj) => headers.map((h) => (obj?.[h] == null ? '' : obj[h]))),
  ];
  return rowsToCsv(rows, { bom });
}

export function exportDateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
