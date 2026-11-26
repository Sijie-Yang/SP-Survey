/** Presentation rules belong to a question/device, never to sampled image URLs. */
export const MEDIA_LAYOUT_DEFAULTS = { mode: 'dynamic', height: 240, minHeight: 100, gap: 12, rowGap: 16, align: 'center', packing: 'auto', columns: 2, stageHeight: 70, top: 0, bottom: 0, slots: [] };
const clamp = (n, low, high, fallback) => Number.isFinite(Number(n)) ? Math.max(low, Math.min(high, Number(n))) : fallback;
export function normalizeMediaLayout(value = {}) {
  const v = { ...MEDIA_LAYOUT_DEFAULTS, ...value };
  return {
    mode: ['dynamic', 'grid', 'free'].includes(v.mode) ? v.mode : 'dynamic',
    height: clamp(v.height, 40, 800, 240), minHeight: Math.min(clamp(v.minHeight, 40, 800, 100), clamp(v.height, 40, 800, 240)),
    gap: clamp(v.gap, 0, 80, 12), rowGap: clamp(v.rowGap, 0, 80, 16),
    align: ['left', 'center', 'right'].includes(v.align) ? v.align : 'center',
    packing: ['auto', 'row', 'stack'].includes(v.packing) ? v.packing : 'auto',
    columns: Math.round(clamp(v.columns, 1, 8, 2)), stageHeight: clamp(v.stageHeight, 15, 250, 70),
    top: clamp(v.top, 0, 160, 0), bottom: clamp(v.bottom, 0, 160, 0),
    slots: (Array.isArray(v.slots) ? v.slots : []).slice(0, 50).map(s => {
      const width = clamp(s.width, 5, 100, 40);
      return { x: clamp(s.x, 0, 100 - width, 0), y: clamp(s.y, 0, 250, 0), width, ar: clamp(s.ar, 0.05, 50, 1) };
    }),
  };
}
export function savedMediaLayout(config, viewport, name) {
  return config?.viewportLayout?.[viewport]?.questions?.[name]?.mediaLayout || null;
}
export function setMediaLayout(config, viewport, name, value) {
  const layout = config.viewportLayout || {}, device = layout[viewport] || {};
  const questions = { ...device.questions }, q = { ...questions[name] };
  if (value == null) delete q.mediaLayout;
  else q.mediaLayout = normalizeMediaLayout(value);
  if (JSON.stringify(q) === JSON.stringify(questions[name] || {})) return config;
  if (Object.keys(q).length) questions[name] = q; else delete questions[name];
  return { ...config, viewportLayout: { ...layout, [viewport]: { ...device, questions } } };
}
export function mediaLayoutFallback(rule, ratios) {
  if (rule.mode !== 'free') return null;
  if (rule.slots.length !== ratios.length) return 'count';
  if (ratios.some((ar, i) => Math.abs(ar / rule.slots[i].ar - 1) > 0.2)) return 'ratio';
  return null;
}
export function defaultMediaSlots(ratios) {
  const columns = Math.min(3, ratios.length || 1), width = Math.min(70, (100 - (columns - 1) * 4) / columns);
  let y = 0;
  return ratios.map((ar, i) => {
    if (i && i % columns === 0) y += Math.max(...ratios.slice(i - columns, i).map(a => width / a)) + 8;
    return { x: ratios.length === 1 ? (100 - width) / 2 : (i % columns) * (width + 4), y, width, ar };
  });
}
/** Pure geometry: preserve source order and aspect ratios under every mode. */
export function mediaPlacements(raw, ratios, availableWidth) {
  const rule = normalizeMediaLayout(raw), width = Math.max(1, availableWidth);
  const fallback = mediaLayoutFallback(rule, ratios);
  if (rule.mode === 'free' && !fallback) {
    const items = rule.slots.map((s, i) => ({ x: s.x * width / 100, y: s.y * width / 100, width: s.width * width / 100, height: s.width * width / 100 / ratios[i] }));
    return { mode: 'free', fallback, items, height: Math.max(rule.stageHeight * width / 100, ...items.map(i => i.y + i.height)), rows: null };
  }
  if (rule.mode === 'grid') {
    const columns = Math.min(rule.columns, Math.max(1, ratios.length));
    const gap = Math.min(rule.gap, width / Math.max(1, columns) / 2);
    const cell = Math.max(1, (width - gap * (columns - 1)) / columns);
    const items = ratios.map((ar, i) => {
      const h = Math.min(rule.height, cell / ar), w = h * ar;
      return { x: (i % columns) * (cell + gap) + (cell - w) / 2, y: Math.floor(i / columns) * (rule.height + rule.rowGap), width: w, height: h };
    });
    return { mode: 'grid', fallback, items, rows: Math.ceil(ratios.length / columns), height: Math.ceil(ratios.length / columns) * (rule.height + rule.rowGap) - rule.rowGap };
  }
  const rows = [];
  ratios.forEach((ar, i) => {
    let row = rows[rows.length - 1];
    if (!row || rule.packing === 'stack' || (rule.packing !== 'row' && (row.sum + ar) * rule.minHeight + rule.gap * row.indices.length > width)) {
      row = { sum: 0, indices: [] }; rows.push(row);
    }
    row.sum += ar; row.indices.push(i);
  });
  const gap = Math.min(rule.gap, ...rows.map(r => width / Math.max(1, r.indices.length - 1 + r.sum)));
  const h = Math.max(0.1, Math.min(rule.height, ...rows.map(r => (width - gap * (r.indices.length - 1)) / r.sum)));
  const items = [];
  rows.forEach((r, ri) => {
    const used = r.sum * h + gap * (r.indices.length - 1);
    let x = rule.align === 'right' ? width - used : rule.align === 'center' ? (width - used) / 2 : 0;
    r.indices.forEach(i => { items[i] = { x, y: ri * (h + rule.rowGap), width: ratios[i] * h, height: h }; x += ratios[i] * h + gap; });
  });
  return { mode: 'dynamic', fallback, items, rows: rows.length, height: rows.length * (h + rule.rowGap) - rule.rowGap };
}
