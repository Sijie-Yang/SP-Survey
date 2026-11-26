/**
 * Silicon vs human agreement: how closely a silicon-sample run reproduces the
 * human answers to the same survey. Everything here is deterministic and built
 * from the same per-question summary rows as the CSV export, so the numbers
 * always match what the researcher downloads.
 *
 * Column and metric names are a stable contract (SP-Bench tables read them).
 */
import { buildQuestionSummaryRows, exportFamilyForQuestion } from './questionSummaryExport.js';

export const AGREEMENT_VERSION = '1.1.0';

export const AGREEMENT_HEADERS = [
  'question_name',
  'question_type',
  'attribute_key',
  'attribute_label',
  'comparison',
  'metric',
  'value',
  'n_units',
  'n_human',
  'n_silicon',
  'silicon_run_id',
  'silicon_group',
];

export const GAP_HEADERS = [
  'question_name',
  'attribute_key',
  'attribute_label',
  'comparison',
  'unit_key',
  'unit_label',
  'human_value',
  'silicon_value',
  'human_rank',
  'silicon_rank',
  'rank_gap',
];

// Per-item calibration table: silicon values mapped onto the human scale by
// the linear fit human ≈ intercept + slope × silicon.
export const CALIBRATION_HEADERS = [
  'question_name',
  'attribute_key',
  'attribute_label',
  'comparison',
  'unit_key',
  'unit_label',
  'human_value',
  'silicon_value',
  'calibrated_value',
  'residual',
  'loo_calibrated_value',
  'silicon_run_id',
  'silicon_group',
];

// The headline metric of each comparison, in the order the overview shows them.
export const HEADLINE_METRIC = Object.freeze({
  item_scores: 'kendall_tau_b',
  item_means: 'spearman_rho',
  answer_distribution: 'js_divergence',
  overall_mean: 'mean_diff',
});

const SKIP_FAMILIES = new Set(['text', 'annotation', 'video_moments', 'emotion_color', 'continuous_video']);
const MIN_UNITS_FOR_CORRELATION = 3;

export function isSiliconRow(row) {
  return row?.source === 'silicon' || Boolean(row?.survey_metadata?.silicon_run_id);
}

// ---------------------------------------------------------------- statistics

function finite(list) {
  return list.every((v) => Number.isFinite(v));
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2 || n !== ys.length || !finite(xs) || !finite(ys)) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Average ranks (1-based), ties share the mean rank. */
export function averageRanks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs, ys) {
  if (xs.length !== ys.length || !finite(xs) || !finite(ys)) return null;
  return pearson(averageRanks(xs), averageRanks(ys));
}

/** Kendall's τ-b (handles ties). O(n²), fine for the few hundred items a survey shows. */
export function kendallTauB(xs, ys) {
  const n = xs.length;
  if (n < 2 || n !== ys.length || !finite(xs) || !finite(ys)) return null;
  let concordant = 0;
  let discordant = 0;
  let tiesX = 0;
  let tiesY = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = Math.sign(xs[i] - xs[j]);
      const dy = Math.sign(ys[i] - ys[j]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tiesX += 1;
      else if (dy === 0) tiesY += 1;
      else if (dx === dy) concordant += 1;
      else discordant += 1;
    }
  }
  const denom = Math.sqrt((concordant + discordant + tiesX) * (concordant + discordant + tiesY));
  return denom ? (concordant - discordant) / denom : null;
}

/** Jensen–Shannon divergence, base 2: 0 = identical distributions, 1 = no overlap. */
export function jsDivergence(p, q) {
  const keys = [...new Set([...Object.keys(p), ...Object.keys(q)])];
  const sp = keys.reduce((a, k) => a + (p[k] || 0), 0);
  const sq = keys.reduce((a, k) => a + (q[k] || 0), 0);
  if (!sp || !sq) return null;
  let js = 0;
  for (const k of keys) {
    const a = (p[k] || 0) / sp;
    const b = (q[k] || 0) / sq;
    const m = (a + b) / 2;
    if (a > 0) js += 0.5 * a * Math.log2(a / m);
    if (b > 0) js += 0.5 * b * Math.log2(b / m);
  }
  return Math.max(0, Math.min(1, js));
}

function modalKey(dist) {
  let best = null;
  let bestV = -Infinity;
  for (const k of Object.keys(dist).sort()) {
    if (dist[k] > bestV) {
      best = k;
      bestV = dist[k];
    }
  }
  return best;
}

/**
 * Least-squares calibration of silicon values onto the human scale:
 * human ≈ intercept + slope × silicon. `loo_rmse` is the leave-one-out error,
 * i.e. how far off a calibrated silicon score is for an item the fit did not
 * see; it is the honest number to quote when silicon scores stand in for new
 * images. Needs ≥3 items with some spread on the silicon side (≥4 for LOO).
 */
export function linearCalibration(silicon, human) {
  const n = silicon.length;
  if (n < MIN_UNITS_FOR_CORRELATION || n !== human.length || !finite(silicon) || !finite(human)) return null;
  const fit = (xs, ys) => {
    const m = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / m;
    const my = ys.reduce((a, b) => a + b, 0) / m;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < m; i += 1) {
      sxx += (xs[i] - mx) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    if (!(sxx > 1e-12)) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx };
  };
  const all = fit(silicon, human);
  if (!all) return null;
  const predicted = silicon.map((x) => all.intercept + all.slope * x);
  const my = human.reduce((a, b) => a + b, 0) / n;
  const ssRes = human.reduce((a, y, i) => a + (y - predicted[i]) ** 2, 0);
  const ssTot = human.reduce((a, y) => a + (y - my) ** 2, 0);
  let loo = null;
  if (n >= 4) {
    loo = [];
    for (let i = 0; i < n; i += 1) {
      const f = fit(silicon.filter((_, j) => j !== i), human.filter((_, j) => j !== i));
      if (!f) { loo = null; break; }
      loo.push(f.intercept + f.slope * silicon[i]);
    }
  }
  return {
    n,
    slope: all.slope,
    intercept: all.intercept,
    r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : null,
    rmse: Math.sqrt(ssRes / n),
    loo_rmse: loo ? Math.sqrt(human.reduce((a, y, i) => a + (y - loo[i]) ** 2, 0) / n) : null,
    predicted,
    loo_predicted: loo,
  };
}

// ---------------------------------------------------------------- summaries

function safeSummary(question, rows) {
  try {
    return buildQuestionSummaryRows(question, rows) || [];
  } catch {
    return [];
  }
}

function groupByAttribute(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.attribute_key || '';
    if (!groups.has(key)) groups.set(key, { key, label: r.attribute_label || r.attribute_key || '', rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()];
}

/** unit -> { key, label, value } for one metric. */
function unitValues(rows, metric) {
  const out = new Map();
  for (const r of rows) {
    if (r.metric !== metric || r.unit_key === 'overall') continue;
    const v = Number(r.value);
    if (Number.isFinite(v)) out.set(String(r.unit_key), { key: String(r.unit_key), label: String(r.unit_label ?? r.unit_key), value: v });
  }
  return out;
}

/**
 * Pair units seen on both sides. Images are matched by URL first; when the two
 * sides were shown the same files from different hosts (e.g. a preview
 * library), fall back to the file name.
 */
function pairUnits(h, s) {
  const byKey = [...h.keys()].filter((k) => s.has(k)).map((k) => [h.get(k), s.get(k)]);
  const labelMap = (m) => {
    const out = new Map();
    const dup = new Set();
    for (const u of m.values()) {
      if (out.has(u.label)) dup.add(u.label);
      out.set(u.label, u);
    }
    dup.forEach((d) => out.delete(d));
    return out;
  };
  const hl = labelMap(h);
  const sl = labelMap(s);
  const byLabel = [...hl.keys()].filter((k) => sl.has(k)).map((k) => [hl.get(k), sl.get(k)]);
  return byLabel.length > byKey.length ? byLabel : byKey;
}

function nResponses(rows) {
  return rows.length ? Number(rows[0].n_responses) || 0 : 0;
}

/** 1 = highest value. */
function rankOf(values) {
  return averageRanks(values.map((v) => -v));
}

function compareItems({ hRows, sRows, metric, comparison, push, gaps, calibration, meta = {}, question, attr }) {
  const pairs = pairUnits(unitValues(hRows, metric), unitValues(sRows, metric));
  const xs = pairs.map(([h]) => h.value);
  const ys = pairs.map(([, s]) => s.value);
  const enough = pairs.length >= MIN_UNITS_FOR_CORRELATION;
  if (comparison === 'item_scores') {
    push('kendall_tau_b', enough ? kendallTauB(xs, ys) : null, pairs.length);
    push('spearman_rho', enough ? spearman(xs, ys) : null, pairs.length);
  } else {
    push('pearson_r', enough ? pearson(xs, ys) : null, pairs.length);
    push('spearman_rho', enough ? spearman(xs, ys) : null, pairs.length);
    push('mean_abs_diff', pairs.length ? pairs.reduce((a, [h, s]) => a + Math.abs(s.value - h.value), 0) / pairs.length : null, pairs.length);
    push('mean_diff', pairs.length ? pairs.reduce((a, [h, s]) => a + (s.value - h.value), 0) / pairs.length : null, pairs.length);
  }
  const cal = linearCalibration(ys, xs);
  push('calib_slope', cal?.slope ?? null, pairs.length);
  push('calib_intercept', cal?.intercept ?? null, pairs.length);
  push('calib_r2', cal?.r2 ?? null, pairs.length);
  push('calib_loo_rmse', cal?.loo_rmse ?? null, pairs.length);
  if (cal && calibration) {
    pairs.forEach(([h, s], i) => calibration.push({
      question_name: question.name,
      attribute_key: attr.key,
      attribute_label: attr.label,
      comparison,
      unit_key: h.key,
      unit_label: h.label,
      human_value: h.value,
      silicon_value: s.value,
      calibrated_value: cal.predicted[i],
      residual: h.value - cal.predicted[i],
      loo_calibrated_value: cal.loo_predicted ? cal.loo_predicted[i] : null,
      silicon_run_id: meta.siliconRunId || '',
      silicon_group: meta.siliconGroup || 'all',
    }));
  }
  if (pairs.length >= 2) {
    const hr = rankOf(xs);
    const sr = rankOf(ys);
    const span = pairs.length - 1;
    pairs.forEach(([h, s], i) => gaps.push({
      question_name: question.name,
      attribute_key: attr.key,
      attribute_label: attr.label,
      comparison,
      unit_key: h.key,
      unit_label: h.label,
      human_value: h.value,
      silicon_value: s.value,
      human_rank: hr[i],
      silicon_rank: sr[i],
      rank_gap: Math.abs(hr[i] - sr[i]) / span,
    }));
  }
}

function distributions(rows) {
  // Matrix cells are "row|col"; everything else is one distribution.
  const groups = new Map();
  for (const r of rows) {
    if (r.metric !== 'count' || r.unit_key === 'overall') continue;
    const label = String(r.unit_label ?? r.unit_key);
    const [g, k] = label.includes('|') ? label.split('|') : ['', String(r.unit_key)];
    if (!groups.has(g)) groups.set(g, {});
    groups.get(g)[k] = (groups.get(g)[k] || 0) + (Number(r.value) || 0);
  }
  return groups;
}

/**
 * Agreement rows for one question. Returns { rows, gaps }.
 * `meta` = { siliconRunId, siliconGroup } copied onto every row.
 */
export function questionAgreement(question, humanRows, siliconRows, meta = {}) {
  const out = { rows: [], gaps: [], calibration: [] };
  if (!question?.name || SKIP_FAMILIES.has(exportFamilyForQuestion(question))) return out;
  const h = safeSummary(question, humanRows);
  const s = safeSummary(question, siliconRows);
  if (!h.length || !s.length) return out;
  const nH = nResponses(h);
  const nS = nResponses(s);
  const base = (attr, comparison) => (metric, value, nUnits) => out.rows.push({
    question_name: question.name,
    question_type: question.type || '',
    attribute_key: attr.key || '',
    attribute_label: attr.label || '',
    comparison,
    metric,
    value: value == null || !Number.isFinite(value) ? null : value,
    n_units: nUnits,
    n_human: nH,
    n_silicon: nS,
    silicon_run_id: meta.siliconRunId || '',
    silicon_group: meta.siliconGroup || 'all',
  });

  const has = (rows, m) => rows.some((r) => r.metric === m && r.unit_key !== 'overall');
  const sGroups = new Map(groupByAttribute(s).map((g) => [g.key, g]));

  if (has(h, 'mu')) {
    for (const g of groupByAttribute(h)) {
      const sg = sGroups.get(g.key);
      if (!sg) continue;
      compareItems({ hRows: g.rows, sRows: sg.rows, metric: 'mu', comparison: 'item_scores', push: base(g, 'item_scores'), gaps: out.gaps, calibration: out.calibration, meta, question, attr: g });
    }
    return out;
  }

  if (has(h, 'mean')) {
    for (const g of groupByAttribute(h)) {
      const sg = sGroups.get(g.key);
      if (!sg) continue;
      compareItems({ hRows: g.rows, sRows: sg.rows, metric: 'mean', comparison: 'item_means', push: base(g, 'item_means'), gaps: out.gaps, calibration: out.calibration, meta, question, attr: g });
    }
    return out;
  }

  // Scales: the overall mean, then the answer distribution.
  const overall = (rows) => {
    const r = rows.find((x) => x.unit_key === 'overall' && x.metric === 'mean');
    const v = r ? Number(r.value) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const hm = overall(h);
  const sm = overall(s);
  if (hm != null && sm != null) {
    const push = base({ key: '', label: '' }, 'overall_mean');
    push('human_mean', hm, 1);
    push('silicon_mean', sm, 1);
    push('mean_diff', sm - hm, 1);
  }

  const hd = distributions(h);
  const sd = distributions(s);
  const shared = [...hd.keys()].filter((k) => sd.has(k));
  if (shared.length) {
    const push = base({ key: '', label: '' }, 'answer_distribution');
    const js = shared.map((k) => jsDivergence(hd.get(k), sd.get(k))).filter((v) => v != null);
    const match = shared.filter((k) => modalKey(hd.get(k)) === modalKey(sd.get(k))).length;
    push('js_divergence', js.length ? js.reduce((a, b) => a + b, 0) / js.length : null, shared.length);
    push('top_choice_match', match / shared.length, shared.length);
  }
  return out;
}

/**
 * Agreement for a whole survey.
 * Returns { rows, gaps (top `gapLimit`, largest rank disagreement first),
 * calibration (every matched item), summary }.
 */
export function siliconAgreement(questions, humanRows, siliconRows, { siliconRunId = '', siliconGroup = 'all', gapLimit = 5 } = {}) {
  const rows = [];
  const gaps = [];
  const calibration = [];
  for (const q of questions || []) {
    const r = questionAgreement(q, humanRows || [], siliconRows || [], { siliconRunId, siliconGroup });
    rows.push(...r.rows);
    gaps.push(...r.gaps);
    calibration.push(...r.calibration);
  }
  gaps.sort((a, b) => (b.rank_gap - a.rank_gap)
    || (Math.abs(b.silicon_rank - b.human_rank) - Math.abs(a.silicon_rank - a.human_rank))
    || String(a.question_name).localeCompare(String(b.question_name))
    || String(a.unit_label).localeCompare(String(b.unit_label)));
  return { rows, gaps: gaps.slice(0, gapLimit), calibration, summary: summarizeAgreement(rows) };
}

/**
 * One headline line per question/attribute for the overview card. A scale's
 * mean difference is folded into its distribution line (`mean_diff`), and
 * a distribution line carries `top_choice_match`.
 */
export function summarizeAgreement(rows) {
  const out = [];
  const seen = new Set();
  const find = (r, comparison, metric) => rows.find((x) => x.question_name === r.question_name
    && x.attribute_key === r.attribute_key && x.comparison === comparison && x.metric === metric);
  for (const r of rows) {
    if (HEADLINE_METRIC[r.comparison] !== r.metric) continue;
    const hasDist = r.comparison === 'overall_mean' && find(r, 'answer_distribution', 'js_divergence');
    if (hasDist) continue;
    const id = `${r.question_name}\u0000${r.attribute_key}\u0000${r.comparison}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const line = { ...r, top_choice_match: null, mean_diff: null, calibration: null };
    if (r.comparison === 'item_scores' || r.comparison === 'item_means') {
      const slope = find(r, r.comparison, 'calib_slope')?.value ?? null;
      if (slope != null) {
        line.calibration = {
          slope,
          intercept: find(r, r.comparison, 'calib_intercept')?.value ?? null,
          r2: find(r, r.comparison, 'calib_r2')?.value ?? null,
          loo_rmse: find(r, r.comparison, 'calib_loo_rmse')?.value ?? null,
        };
      }
    }
    if (r.comparison === 'answer_distribution') {
      line.top_choice_match = find(r, 'answer_distribution', 'top_choice_match')?.value ?? null;
      line.mean_diff = find(r, 'overall_mean', 'mean_diff')?.value ?? null;
    }
    out.push(line);
  }
  return out;
}

/** Split silicon rows into "all" plus one group per persona. */
export function siliconGroups(siliconRows) {
  const groups = [{ id: 'all', label: '', rows: siliconRows || [] }];
  const byPersona = new Map();
  for (const row of siliconRows || []) {
    const id = row.persona_id || row.survey_metadata?.persona_id;
    if (!id) continue;
    if (!byPersona.has(id)) byPersona.set(id, { id: `persona:${id}`, label: row.survey_metadata?.persona_name || String(id).slice(0, 8), rows: [] });
    byPersona.get(id).rows.push(row);
  }
  if (byPersona.size > 1) groups.push(...[...byPersona.values()].sort((a, b) => a.label.localeCompare(b.label)));
  return groups;
}

function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return `${[headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n')}\n`;
}

export function agreementCsv(rows) {
  return toCsv(AGREEMENT_HEADERS, rows);
}

export function gapsCsv(gaps) {
  return toCsv(GAP_HEADERS, gaps);
}

export function calibrationCsv(rows) {
  return toCsv(CALIBRATION_HEADERS, rows);
}

/** Files for the full analysis pack. */
export function agreementExportFiles(result, { allGaps = null } = {}) {
  if (!result?.rows?.length) return [];
  const files = [
    { path: 'silicon_agreement.csv', content: agreementCsv(result.rows) },
    { path: 'silicon_agreement_gaps.csv', content: gapsCsv(allGaps || result.gaps) },
  ];
  if (result.calibration?.length) files.push({ path: 'silicon_calibration.csv', content: calibrationCsv(result.calibration) });
  return files;
}
