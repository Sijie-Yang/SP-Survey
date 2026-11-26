/**
 * Stimulus variants: the same scene shown in several versions (e.g. a street
 * before and after adding trees). Each scene is one paired observation, so a
 * variant's effect is the mean of its per-scene differences from the baseline
 * version, with a t-based 95% CI, a paired t-test, Cohen's d_z, and Holm-
 * adjusted p-values across the variants of one question.
 *
 * The grouping is read from file names and folders only, deterministically:
 *   1. "scene12__trees.jpg"            → scene "scene12", variant "trees"
 *   2. "before/scene12.jpg"            → scene "scene12", variant "before"
 *      "car-1/before.jpg"              → scene "car-1",   variant "before"
 *      (for folders, whichever of folder / file name has fewer distinct
 *       values is the variant)
 * Per-image scores come from the same summary rows as every export
 * (TrueSkill μ for comparisons, the mean for ratings).
 */
import { buildQuestionSummaryRows, exportFamilyForQuestion } from './questionSummaryExport.js';
import { tQuantile, tTwoSidedP } from './statDistributions.js';

export const VARIANT_SCHEMA = 'sp-variant-contrasts/1';
export const MIN_SCENES = 2;

export const CONTRAST_HEADERS = [
  'question_name', 'attribute_key', 'attribute_label', 'metric', 'grouping', 'baseline', 'variant',
  'n_scenes', 'mean_diff', 'sd_diff', 'ci95_low', 'ci95_high', 't', 'df', 'p', 'p_holm', 'cohens_dz',
  'n_higher', 'n_lower', 'n_equal',
];

export const PAIR_HEADERS = [
  'question_name', 'attribute_key', 'metric', 'grouping', 'scene', 'baseline', 'variant',
  'baseline_unit', 'variant_unit', 'baseline_value', 'variant_value', 'diff',
];

const BASELINE_NAMES = ['base', 'baseline', 'before', 'original', 'orig', 'control', 'existing', 'current', 'pre', 'reference', 'ref', 'real'];
const SKIP_FAMILIES = new Set(['text', 'annotation', 'video_moments', 'emotion_color', 'continuous_video']);

function pathParts(key) {
  let path = String(key || '');
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch { /* plain path */ }
  const segs = decodeURIComponent(path.split('?')[0]).split('/').filter(Boolean);
  const file = segs.pop() || '';
  const dot = file.lastIndexOf('.');
  return { stem: dot > 0 ? file.slice(0, dot) : file, folder: segs.pop() || '' };
}

function group(units, pick) {
  const scenes = new Map();
  for (const u of units) {
    const sv = pick(u);
    if (!sv || !sv.scene || !sv.variant) continue;
    if (!scenes.has(sv.scene)) scenes.set(sv.scene, new Map());
    const variants = scenes.get(sv.scene);
    if (!variants.has(sv.variant)) variants.set(sv.variant, u);
  }
  const multi = [...scenes.values()].filter((m) => m.size >= 2).length;
  const variants = new Set([...scenes.values()].flatMap((m) => [...m.keys()]));
  return { scenes, multi, nVariants: variants.size };
}

/**
 * units: [{ key, label, value }]. Returns { grouping, scenes: Map(scene → Map(variant → unit)), variants }
 * or null when fewer than MIN_SCENES scenes come in two or more versions.
 */
export function groupVariants(units) {
  const parsed = units.map((u) => ({ ...u, ...pathParts(u.key || u.label) }));
  const suffix = group(parsed, (u) => {
    const i = u.stem.lastIndexOf('__');
    return i > 0 ? { scene: u.stem.slice(0, i), variant: u.stem.slice(i + 2) } : null;
  });
  let chosen = suffix.multi >= MIN_SCENES ? { ...suffix, grouping: 'file_suffix' } : null;
  if (!chosen) {
    const byFolder = group(parsed, (u) => (u.folder ? { scene: u.stem, variant: u.folder } : null));
    const byStem = group(parsed, (u) => (u.folder ? { scene: u.folder, variant: u.stem } : null));
    const options = [
      { ...byFolder, grouping: 'folder_is_variant' },
      { ...byStem, grouping: 'file_is_variant' },
    ].filter((o) => o.multi >= MIN_SCENES && o.nVariants <= o.scenes.size);
    options.sort((a, b) => a.nVariants - b.nVariants || b.multi - a.multi);
    chosen = options[0] || null;
  }
  if (!chosen) return null;
  const counts = new Map();
  for (const m of chosen.scenes.values()) {
    if (m.size < 2) continue;
    for (const v of m.keys()) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const variants = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { grouping: chosen.grouping, scenes: chosen.scenes, variants, sceneCounts: counts };
}

/** A version called base / before / original / control …, else the one present in most scenes. */
export function defaultBaseline(variants, sceneCounts = new Map()) {
  const named = variants.find((v) => BASELINE_NAMES.includes(String(v).toLowerCase()));
  if (named) return named;
  return [...variants].sort((a, b) => (sceneCounts.get(b) || 0) - (sceneCounts.get(a) || 0) || a.localeCompare(b, undefined, { numeric: true }))[0];
}

/** Paired summary of per-scene differences. */
export function pairedStats(diffs) {
  const n = diffs.length;
  if (!n) return null;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const out = {
    n, mean, sd: null, ci_low: null, ci_high: null, t: null, df: n - 1, p: null, dz: null,
    n_higher: diffs.filter((d) => d > 0).length, n_lower: diffs.filter((d) => d < 0).length, n_equal: diffs.filter((d) => d === 0).length,
  };
  if (n < 2) return out;
  const sd = Math.sqrt(diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / (n - 1));
  out.sd = sd;
  const half = tQuantile(0.975, n - 1) * (sd / Math.sqrt(n));
  out.ci_low = mean - half;
  out.ci_high = mean + half;
  if (sd > 0) {
    out.t = mean / (sd / Math.sqrt(n));
    out.p = tTwoSidedP(out.t, n - 1);
    out.dz = mean / sd;
  } else if (mean === 0) {
    out.p = 1;
  }
  return out;
}

/** Holm–Bonferroni; nulls stay null. */
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0]);
  const out = ps.map(() => null);
  let running = 0;
  idx.forEach(([p, i], rank) => {
    running = Math.max(running, Math.min(1, (idx.length - rank) * p));
    out[i] = running;
  });
  return out;
}

function units(rows, metric) {
  return rows
    .filter((r) => r.metric === metric && r.unit_key !== 'overall' && !String(r.unit_key).startsWith('['))
    .map((r) => ({ key: String(r.unit_key), label: String(r.unit_label ?? r.unit_key), value: Number(r.value) }))
    .filter((u) => Number.isFinite(u.value));
}

function byAttribute(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.attribute_key || '';
    if (!m.has(k)) m.set(k, { key: k, label: r.attribute_label || k, rows: [] });
    m.get(k).rows.push(r);
  }
  return [...m.values()];
}

/**
 * Contrasts for one question. `baselines` maps attribute key ('' for none) to a
 * chosen baseline; otherwise defaultBaseline() decides.
 * Returns [{ attribute_key, attribute_label, metric, grouping, baseline, variants, contrasts, pairs }].
 */
export function questionVariantAnalysis(question, responses, { baselines = {} } = {}) {
  if (!question?.name || SKIP_FAMILIES.has(exportFamilyForQuestion(question))) return [];
  let rows;
  try {
    rows = buildQuestionSummaryRows(question, responses) || [];
  } catch {
    return [];
  }
  const metric = rows.some((r) => r.metric === 'mu') ? 'mu' : rows.some((r) => r.metric === 'mean' && r.unit_key !== 'overall') ? 'mean' : null;
  if (!metric) return [];
  const out = [];
  for (const attr of byAttribute(rows)) {
    const grouped = groupVariants(units(attr.rows, metric));
    if (!grouped) continue;
    const chosen = baselines[attr.key];
    const baseline = grouped.variants.includes(chosen) ? chosen : defaultBaseline(grouped.variants, grouped.sceneCounts);
    const contrasts = [];
    const pairs = [];
    for (const variant of grouped.variants) {
      if (variant === baseline) continue;
      const diffs = [];
      for (const [scene, versions] of grouped.scenes) {
        const b = versions.get(baseline);
        const v = versions.get(variant);
        if (!b || !v) continue;
        diffs.push(v.value - b.value);
        pairs.push({
          question_name: question.name, attribute_key: attr.key, metric, grouping: grouped.grouping, scene, baseline, variant,
          baseline_unit: b.label, variant_unit: v.label, baseline_value: b.value, variant_value: v.value, diff: v.value - b.value,
        });
      }
      const st = pairedStats(diffs);
      if (!st) continue;
      contrasts.push({
        question_name: question.name, attribute_key: attr.key, attribute_label: attr.label, metric, grouping: grouped.grouping,
        baseline, variant, n_scenes: st.n, mean_diff: st.mean, sd_diff: st.sd, ci95_low: st.ci_low, ci95_high: st.ci_high,
        t: st.t, df: st.df, p: st.p, p_holm: null, cohens_dz: st.dz, n_higher: st.n_higher, n_lower: st.n_lower, n_equal: st.n_equal,
      });
    }
    holm(contrasts.map((c) => c.p)).forEach((p, i) => { contrasts[i].p_holm = p; });
    if (contrasts.length) {
      out.push({ attribute_key: attr.key, attribute_label: attr.label, metric, grouping: grouped.grouping, baseline, variants: grouped.variants, contrasts, pairs });
    }
  }
  return out;
}

export function surveyVariantAnalysis(questions, responses, { baselines = {} } = {}) {
  const out = [];
  for (const q of questions || []) {
    const res = questionVariantAnalysis(q, responses || [], { baselines: baselines[q?.name] || {} });
    if (res.length) out.push({ question: q, blocks: res });
  }
  return out;
}

function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return `${[headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n')}\n`;
}

export function variantExportFiles(analysis) {
  const blocks = (analysis || []).flatMap((a) => a.blocks);
  if (!blocks.length) return [];
  return [
    { path: 'variant_contrasts.csv', content: toCsv(CONTRAST_HEADERS, blocks.flatMap((b) => b.contrasts)) },
    { path: 'variant_pairs.csv', content: toCsv(PAIR_HEADERS, blocks.flatMap((b) => b.pairs)) },
  ];
}

export const VARIANT_README_LINES = [
  'variant_contrasts.csv       Image versions of the same scene (e.g. scene12__trees.jpg vs scene12__base.jpg, or before/ vs after/ folders):',
  '                            per version, mean per-scene difference from the baseline version, 95% CI, paired t-test, Holm-adjusted p, Cohen\'s d_z',
  'variant_pairs.csv           The per-scene differences behind each contrast',
];
