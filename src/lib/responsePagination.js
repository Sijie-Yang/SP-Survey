/** Never present a truncated or duplicated response set as a complete analysis. */
export async function readAllResponsePages(fetchPage, { onProgress = () => {}, cancelled = () => false, maxRows = 500000 } = {}) {
  const rows = []; const seen = new Set();
  while (true) {
    if (cancelled()) throw new Error('Response loading cancelled');
    const page = await fetchPage(rows.length, rows[rows.length - 1] || null);
    if (!Array.isArray(page)) throw new Error('Invalid response page');
    if (cancelled()) throw new Error('Response loading cancelled');
    if (!page.length) return rows;
    for (const row of page) {
      if (row.id && seen.has(row.id)) throw new Error('Responses changed while loading. Refresh to load a consistent result set.');
      if (row.id) seen.add(row.id);
      rows.push(row);
    }
    if (rows.length > maxRows) throw new Error(`Response count exceeds the ${maxRows} row loading limit. No partial results were used.`);
    onProgress(rows.length);
    // Continue even if a server cap is lower than our requested page size.
  }
}

// PostgREST tuple cursor, descending by timestamp then immutable response id.
// Quoted values prevent ids or timestamp text from becoming filter operators.
export function responseCursorFilter(after) {
  if (!after?.id) return null;
  const id = JSON.stringify(String(after.id));
  if (!after.created_at) return `and(created_at.is.null,id.lt.${id})`;
  const stamp = JSON.stringify(String(after.created_at));
  return `created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${id}),created_at.is.null`;
}
