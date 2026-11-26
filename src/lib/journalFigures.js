/**
 * Journal-ready figures built from the per-question summary rows (the same
 * numbers as questions/{name}__summary.csv), so a figure always matches the
 * exported data. Output is a self-contained SVG string: white background,
 * Arial, black axes, no on-screen styling. PNG is rendered from that SVG.
 */
import { buildQuestionSummaryRows, exportFamilyForQuestion } from './questionSummaryExport.js';

const FONT = 'Arial, Helvetica, sans-serif';
const INK = '#222222';
const MUTED = '#666666';
const GRID = '#e3e3e3';
const BAR = '#3b6ea5';
// Okabe–Ito: distinguishable in colour-blind vision and in greyscale print.
const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442', '#000000'];
const WIDTH = 640;
const MAX_ITEMS = 40;

export const FIGURE_CREDIT = 'Data collected with SP-Survey (https://sp-survey.org).';

function esc(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clip(text, max = 28) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Rough Arial advance width; enough to size margins without a DOM.
const textWidth = (text, size) => String(text).length * size * 0.56;

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

const fmt = (v) => {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 100 || Number.isInteger(v)) return String(Math.round(v * 10) / 10);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2).replace(/0$/, '');
};

function svgDoc(width, height, body, label) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" font-family="${FONT}">\n<rect width="100%" height="100%" fill="#ffffff"/>\n${body}\n</svg>\n`;
}

/**
 * Horizontal bars with optional error bars, one row per item, sorted as given.
 * items: [{ label, value, lo?, hi? }]
 */
export function horizontalBarSvg({ items, axisLabel = '', domain = null, note = '', label = 'Figure', percent = false, dots = false }) {
  const rows = items.slice(0, MAX_ITEMS);
  const fontSize = 11;
  const rowH = rows.length > 24 ? 14 : 18;
  const labelW = Math.min(220, Math.max(60, ...rows.map((r) => textWidth(clip(r.label), fontSize))) + 10);
  const left = labelW + 8;
  const right = 30;
  const top = 12;
  const plotH = rows.length * rowH;
  const bottom = 44 + (note ? 16 : 0);
  const height = top + plotH + bottom;
  const values = rows.flatMap((r) => [r.value, r.lo, r.hi]).filter(Number.isFinite);
  const [dMin, dMax] = domain || (dots ? [Math.min(...values), Math.max(...values)] : [Math.min(0, ...values), Math.max(0, ...values)]);
  // A short integer answer scale (1–5, 1–7) gets one tick per answer value.
  const integerScale = domain && Number.isInteger(dMin) && Number.isInteger(dMax) && dMax - dMin <= 10;
  const ticks = integerScale ? Array.from({ length: dMax - dMin + 1 }, (_, i) => dMin + i) : niceTicks(dMin, dMax);
  const x0 = domain ? dMin : ticks[0];
  const x1 = domain ? dMax : ticks[ticks.length - 1];
  const plotW = WIDTH - left - right;
  const sx = (v) => left + ((v - x0) / (x1 - x0 || 1)) * plotW;
  const parts = [];
  ticks.filter((t) => t >= x0 - 1e-9 && t <= x1 + 1e-9).forEach((t) => {
    const x = sx(t).toFixed(1);
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${top + plotH + 15}" font-size="10" fill="${INK}" text-anchor="middle">${percent ? `${Math.round(t * 100)}%` : fmt(t)}</text>`);
  });
  const zero = sx(Math.max(x0, Math.min(x1, 0)));
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const cy = y + rowH / 2;
    const xv = sx(r.value);
    const bx = Math.min(zero, xv);
    parts.push(`<text x="${labelW}" y="${(cy + 3.5).toFixed(1)}" font-size="${fontSize}" fill="${INK}" text-anchor="end">${esc(clip(r.label))}</text>`);
    if (!dots) parts.push(`<rect x="${bx.toFixed(1)}" y="${(y + rowH * 0.18).toFixed(1)}" width="${Math.max(0.5, Math.abs(xv - zero)).toFixed(1)}" height="${(rowH * 0.64).toFixed(1)}" fill="${BAR}"/>`);
    if (Number.isFinite(r.lo) && Number.isFinite(r.hi)) {
      const a = sx(Math.max(x0, r.lo)).toFixed(1);
      const b = sx(Math.min(x1, r.hi)).toFixed(1);
      parts.push(`<line x1="${a}" y1="${cy}" x2="${b}" y2="${cy}" stroke="${INK}" stroke-width="1"/>`);
      parts.push(`<line x1="${a}" y1="${cy - 3}" x2="${a}" y2="${cy + 3}" stroke="${INK}" stroke-width="1"/>`);
      parts.push(`<line x1="${b}" y1="${cy - 3}" x2="${b}" y2="${cy + 3}" stroke="${INK}" stroke-width="1"/>`);
    }
    if (dots) parts.push(`<circle cx="${xv.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5" fill="${BAR}"/>`);
  });
  // Dot plots have no meaningful zero; the axis starts the plot instead.
  const axisX = dots ? left : zero;
  parts.push(`<line x1="${axisX.toFixed(1)}" y1="${top}" x2="${axisX.toFixed(1)}" y2="${top + plotH}" stroke="${INK}" stroke-width="1"/>`);
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${WIDTH - right}" y2="${top + plotH}" stroke="${INK}" stroke-width="1"/>`);
  if (axisLabel) parts.push(`<text x="${(left + plotW / 2).toFixed(1)}" y="${top + plotH + 33}" font-size="11" fill="${INK}" text-anchor="middle">${esc(axisLabel)}</text>`);
  if (note) parts.push(`<text x="${left}" y="${height - 6}" font-size="9" fill="${MUTED}">${esc(note)}</text>`);
  return svgDoc(WIDTH, height, parts.join('\n'), label);
}

/** 100% stacked horizontal bars (matrix rows × columns). rows: [{ label, segments: [{ key, value }] }] */
export function stackedBarSvg({ rows, keys, keyLabels = {}, label = 'Figure', note = '' }) {
  const fontSize = 11;
  const rowH = 20;
  const labelW = Math.min(220, Math.max(60, ...rows.map((r) => textWidth(clip(r.label), fontSize))) + 10);
  const left = labelW + 8;
  const right = 30;
  const top = 12;
  const plotH = rows.length * rowH;
  const legendH = 22;
  const height = top + plotH + 26 + legendH + (note ? 16 : 0);
  const plotW = WIDTH - left - right;
  const parts = [];
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
    const x = (left + t * plotW).toFixed(1);
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${top + plotH + 15}" font-size="10" fill="${INK}" text-anchor="middle">${t * 100}%</text>`);
  });
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const total = r.segments.reduce((s, seg) => s + (seg.value || 0), 0) || 1;
    let x = left;
    parts.push(`<text x="${labelW}" y="${(y + rowH / 2 + 3.5).toFixed(1)}" font-size="${fontSize}" fill="${INK}" text-anchor="end">${esc(clip(r.label))}</text>`);
    keys.forEach((k, ki) => {
      const v = (r.segments.find((s) => s.key === k)?.value || 0) / total;
      if (v <= 0) return;
      const w = v * plotW;
      parts.push(`<rect x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" width="${w.toFixed(1)}" height="${rowH - 6}" fill="${PALETTE[ki % PALETTE.length]}"/>`);
      x += w;
    });
  });
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${WIDTH - right}" y2="${top + plotH}" stroke="${INK}" stroke-width="1"/>`);
  let lx = left;
  const ly = top + plotH + 30;
  keys.forEach((k, ki) => {
    const text = clip(keyLabels[k] ?? k, 18);
    parts.push(`<rect x="${lx.toFixed(1)}" y="${ly}" width="10" height="10" fill="${PALETTE[ki % PALETTE.length]}"/>`);
    parts.push(`<text x="${(lx + 14).toFixed(1)}" y="${ly + 9}" font-size="10" fill="${INK}">${esc(text)}</text>`);
    lx += 14 + textWidth(text, 10) + 14;
  });
  if (note) parts.push(`<text x="${left}" y="${height - 6}" font-size="9" fill="${MUTED}">${esc(note)}</text>`);
  return svgDoc(WIDTH, height, parts.join('\n'), label);
}

// ── From summary rows to figures ────────────────────────────────────────────

const questionTitle = (q) => (typeof q.title === 'string' ? q.title : (q.title?.default || q.title?.en || '')) || q.name;
const safe = (s) => String(s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'figure';

function byUnit(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = r.unit_key;
    if (!map.has(key)) map.set(key, { key, label: r.unit_label || r.unit_key, metrics: {} });
    map.get(key).metrics[r.metric] = { value: Number(r.value), n: Number(r.n) };
  });
  return [...map.values()];
}

function groupByAttribute(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = r.attribute_key || '';
    if (!map.has(key)) map.set(key, { key, label: r.attribute_label || r.attribute_key || '', rows: [] });
    map.get(key).rows.push(r);
  });
  return [...map.values()];
}

// The answer scale when the question states it, so figures share an axis.
function scaleDomain(question, attributeKey) {
  const dim = (question.dimensions || []).find((d) => String(d.id) === String(attributeKey));
  const lo = Number(dim?.min ?? question.rateMin ?? question.min);
  const hi = Number(dim?.max ?? question.rateMax ?? question.max);
  return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : null;
}

function trimmed(items) {
  if (items.length <= MAX_ITEMS) return { items, note: '' };
  const half = MAX_ITEMS / 2;
  return {
    items: [...items.slice(0, half), ...items.slice(-half)],
    note: `Top ${half} and bottom ${half} of ${items.length} shown; all items are in the summary CSV.`,
  };
}

/**
 * Figure specs for one question: [{ id, file, caption, svg }]. Questions
 * without a numeric summary (text, annotation, custom) give none.
 */
export function figuresForQuestion(question, responses, { questionNumber = null } = {}) {
  // Typed text, drawings and free-form tasks have no numeric summary to plot.
  if (['text', 'annotation', 'video_moments', 'emotion_color', 'continuous_video'].includes(exportFamilyForQuestion(question))) return [];
  let rows = null;
  try { rows = buildQuestionSummaryRows(question, responses); } catch { rows = null; }
  if (!rows?.length) return [];
  const title = questionTitle(question);
  const qLabel = questionNumber ? `Q${questionNumber}` : question.name;
  const nResp = Number(rows[0]?.n_responses) || 0;
  const out = [];
  const add = (suffix, svg, caption) => out.push({
    id: `${question.name}${suffix ? `__${suffix}` : ''}`,
    file: `${safe(question.name)}${suffix ? `__${safe(suffix)}` : ''}`,
    caption: `${qLabel}. ${title}${caption ? ` ${caption}` : ''} n = ${nResp} responses. ${FIGURE_CREDIT}`,
    svg,
  });

  const hasMetric = (m) => rows.some((r) => r.metric === m);

  // Pairwise / best–worst: TrueSkill μ ± σ per stimulus, ranked.
  if (hasMetric('mu')) {
    groupByAttribute(rows.filter((r) => ['mu', 'sigma'].includes(r.metric))).forEach((g) => {
      const items = byUnit(g.rows)
        .filter((u) => Number.isFinite(u.metrics.mu?.value))
        .map((u) => {
          const mu = u.metrics.mu.value;
          const sd = u.metrics.sigma?.value;
          return { label: u.label, value: mu, lo: Number.isFinite(sd) ? mu - sd : undefined, hi: Number.isFinite(sd) ? mu + sd : undefined };
        })
        .sort((a, b) => b.value - a.value);
      if (!items.length) return;
      const t = trimmed(items);
      add(g.key ? `trueskill_${g.key}` : 'trueskill', horizontalBarSvg({
        items: t.items,
        axisLabel: 'TrueSkill score (μ ± σ)',
        dots: true,
        note: t.note,
        label: `${title} ${g.label}`.trim(),
      }), `${g.label ? `(${g.label}) ` : ''}Items ranked by TrueSkill score from pairwise choices; points show μ, whiskers ±1σ.`);
    });
    return out;
  }

  // Per-stimulus (or per-unit) means with 95% CI.
  const perUnitMeans = rows.filter((r) => r.metric === 'mean' && r.unit_key !== 'overall');
  if (perUnitMeans.length) {
    groupByAttribute(rows.filter((r) => ['mean', 'sd'].includes(r.metric) && r.unit_key !== 'overall')).forEach((g) => {
      const items = byUnit(g.rows)
        .filter((u) => Number.isFinite(u.metrics.mean?.value))
        .map((u) => {
          const { value: mean, n } = u.metrics.mean;
          const sd = u.metrics.sd?.value;
          const half = Number.isFinite(sd) && n > 1 ? 1.96 * sd / Math.sqrt(n) : undefined;
          return { label: u.label, value: mean, lo: half != null ? mean - half : undefined, hi: half != null ? mean + half : undefined };
        })
        .sort((a, b) => b.value - a.value);
      if (!items.length) return;
      const t = trimmed(items);
      add(g.key ? `means_${g.key}` : 'means', horizontalBarSvg({
        items: t.items,
        axisLabel: g.label ? `Mean rating: ${g.label}` : 'Mean rating',
        dots: true,
        domain: scaleDomain(question, g.key),
        note: t.note,
        label: `${title} ${g.label}`.trim(),
      }), `${g.label ? `(${g.label}) ` : ''}Mean per item (points) with 95% confidence intervals.`);
    });
    return out;
  }

  // Matrix: one stacked bar per row, segments by column.
  if (rows.some((r) => r.metric === 'count' && String(r.unit_label || '').includes('|'))) {
    const cells = rows.filter((r) => r.metric === 'count' && String(r.unit_label || '').includes('|'));
    const rowKeys = [];
    const colKeys = [];
    const counts = new Map();
    cells.forEach((r) => {
      const [rk, ck] = String(r.unit_label).split('|');
      if (!rowKeys.includes(rk)) rowKeys.push(rk);
      if (!colKeys.includes(ck)) colKeys.push(ck);
      counts.set(`${rk}|${ck}`, Number(r.value) || 0);
    });
    colKeys.sort((a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b)));
    const text = (list) => Object.fromEntries((list || []).map((c) => (c && typeof c === 'object'
      ? [String(c.value), typeof c.text === 'string' ? c.text : (c.text?.default || c.text?.en || String(c.value))]
      : [String(c), String(c)])));
    const colText = text(question.columns);
    const rowText = text(question.rows);
    add('matrix', stackedBarSvg({
      rows: rowKeys.map((rk) => ({ label: rowText[rk] || rk, segments: colKeys.map((ck) => ({ key: ck, value: counts.get(`${rk}|${ck}`) || 0 })) })),
      keys: colKeys,
      keyLabels: colText,
      label: title,
    }), 'Share of answers per row.');
    return out;
  }

  // Choice, boolean, scale distributions: share of responses per option.
  const counts = rows.filter((r) => r.metric === 'count' && r.unit_key !== 'overall' && !r.attribute_key);
  if (counts.length) {
    const total = counts.reduce((s, r) => s + (Number(r.value) || 0), 0) || 1;
    const numeric = counts.every((r) => Number.isFinite(Number(r.unit_key)));
    const items = counts.map((r) => ({ label: r.unit_label || r.unit_key, key: r.unit_key, value: (Number(r.value) || 0) / total }));
    if (numeric) items.sort((a, b) => Number(a.key) - Number(b.key));
    else items.sort((a, b) => b.value - a.value);
    const t = trimmed(items);
    add('distribution', horizontalBarSvg({
      items: t.items,
      axisLabel: 'Share of answers',
      domain: [0, Math.min(1, Math.max(0.25, niceTicks(0, Math.max(...items.map((i) => i.value))).slice(-1)[0]))],
      percent: true,
      note: t.note,
      label: title,
    }), 'Share of answers per option.');
  }
  return out;
}

/** Every figure of a survey, numbered like the Results page. */
export function figuresForSurvey(questions, responses, { numberByName = null } = {}) {
  let number = 0;
  return (questions || []).flatMap((q) => {
    number += 1;
    const questionNumber = numberByName ? (numberByName.get(q.name) ?? null) : number;
    return figuresForQuestion(q, responses, { questionNumber });
  });
}

/**
 * ZIP entries for figures: SVG always, PNG when `png` (browser only), plus
 * captions.md. `dir` prefixes every path.
 */
export function figureSvgFiles(figures, { dir = 'figures', projectName = '' } = {}) {
  const prefix = dir ? `${dir}/` : '';
  const files = figures.map((f) => ({ path: `${prefix}${f.file}.svg`, content: f.svg }));
  if (figures.length) files.push({ path: `${prefix}captions.md`, content: figureCaptionsMarkdown(figures, { projectName }) });
  return files;
}

export async function figureZipFiles(figures, { png = false, dir = 'figures', projectName = '', toPng = svgToPngBytes } = {}) {
  const prefix = dir ? `${dir}/` : '';
  const files = [];
  for (const f of figures) {
    files.push({ path: `${prefix}${f.file}.svg`, content: f.svg });
    // eslint-disable-next-line no-await-in-loop
    if (png) files.push({ path: `${prefix}${f.file}.png`, content: await toPng(f.svg) });
  }
  if (figures.length) files.push({ path: `${prefix}captions.md`, content: figureCaptionsMarkdown(figures, { projectName }) });
  return files;
}

export function figureCaptionsMarkdown(figures, { projectName = '' } = {}) {
  return [
    `# Figures${projectName ? ` · ${projectName}` : ''}`,
    '',
    'Suggested captions. Each SVG is vector and can be placed in a manuscript as is; PNG files are 3× resolution.',
    '',
    ...figures.map((f) => `- **${f.file}**: ${f.caption}`),
    '',
  ].join('\n');
}

/** Rasterise an SVG string in the browser (3× ≈ 300 dpi at journal column width). */
export function svgToPngBytes(svg, scale = 3) {
  return new Promise((resolve, reject) => {
    const m = svg.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/);
    const w = m ? Number(m[1]) : WIDTH;
    const h = m ? Number(m[2]) : 400;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('PNG export failed')); return; }
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('PNG export failed')); };
    img.src = url;
  });
}
