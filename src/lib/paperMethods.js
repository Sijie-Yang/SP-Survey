/**
 * Score derivations and diagnostics used by published urban perception studies.
 * Pure functions; every option is opt-in and the default TrueSkill path is untouched.
 */
import { expandQuestionAnswerUnits, normalizeBooleanAnswer } from './responseAnswerUnits.js';
import { isNoPreference } from './choiceTie.js';
import { mediaIdentityKey, stimulusUnitKey } from './mediaIdentity.js';
import { answerToSelectedKeys, computeTrueSkillRatings, matchesFromImagePickerAnswer } from './trueskill.js';
import { average, median, stdDev, wilsonCI } from './stats.js';
import {
  fCdf, fQuantile, normalCdf, normalPdfStd, normalQuantile, tQuantile, tTwoSidedP,
} from './statDistributions.js';

export const SCALE_RANGES = Object.freeze({ '0-10': [0, 10], '0-5': [0, 5], '0-1': [0, 1] });
export const COVERAGE_THRESHOLDS = Object.freeze({ likert: 12, qscore: 22, trueskill: 29 });

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function seededRandom(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded(items, rand) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sampleSd(values) {
  if (values.length < 2) return null;
  const m = average(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

function sampleVariance(values) {
  const sd = sampleSd(values);
  return sd == null ? null : sd * sd;
}

function quantileSorted(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function rankWithTies(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

function pearson(x, y) {
  const n = x.length;
  if (n < 2) return null;
  const mx = average(x);
  const my = average(y);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function spearman(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  return pearson(rankWithTies(x), rankWithTies(y));
}

/** Spearman correlation of two key→score maps over their shared keys. */
export function spearmanOfMaps(a, b) {
  const keys = [...a.keys()].filter((k) => b.has(k) && Number.isFinite(a.get(k)) && Number.isFinite(b.get(k)));
  return { rho: spearman(keys.map((k) => a.get(k)), keys.map((k) => b.get(k))), n: keys.length };
}

function rowAnswer(row, name) {
  const value = row?.responses?.[name];
  if (value && typeof value === 'object' && !Array.isArray(value) && 'answer' in value) return value.answer;
  return value;
}

function shownKeysOf(unit) {
  return (unit.shown_images || []).map((s) => mediaIdentityKey(typeof s === 'string' ? s : s?.url || s?.name || '')).filter(Boolean);
}

export function participantKey(row, index = 0) {
  return row?.participant_id || row?.id || `row_${index}`;
}

export function responseCondition(row) {
  return row?.survey_metadata?.condition ?? null;
}

export function responseUrlParam(row, name) {
  const value = row?.survey_metadata?.url_params?.[name];
  return value == null || value === '' ? null : String(value);
}

// ─── Pairwise outcomes (ties, legacy *_equal booleans, reverse coding) ───────

/**
 * reverseCoded: boolean, or (row) => boolean for per-condition wording.
 * One record per compared pair. Two-image trials keep ties; larger sets expand
 * into dependent decisive pairs (selected beats each non-selected).
 */
export function pairwiseOutcomes(responses, questionName, { reverseCoded = false, equalQuestionName } = {}) {
  const equalName = equalQuestionName === undefined ? `${questionName}_equal` : equalQuestionName;
  const out = [];
  (responses || []).forEach((row, rowIndex) => {
    const units = expandQuestionAnswerUnits(row, questionName, { requireAnswer: true });
    const legacyTie = equalName && units.length === 1 && normalizeBooleanAnswer(rowAnswer(row, equalName)) === 1;
    const participant = participantKey(row, rowIndex);
    const condition = responseCondition(row);
    const reversed = typeof reverseCoded === 'function' ? reverseCoded(row) : reverseCoded;
    units.forEach((unit) => {
      const shown = shownKeysOf(unit);
      if (shown.length < 2) return;
      const categories = Array.isArray(unit.shown_media_categories) ? unit.shown_media_categories : [];
      const base = {
        participant, trial: unit.trial_index ?? 0, condition, question: questionName,
        category: categories.length === 1 ? String(categories[0]) : null,
        positionTags: categories.length === shown.length ? categories.map(String) : null,
      };
      if (shown.length === 2 && (isNoPreference(unit.answer) || legacyTie)) {
        out.push({ ...base, a: shown[0], b: shown[1], tie: true, winner: null, loser: null, chosenPosition: null });
        return;
      }
      matchesFromImagePickerAnswer(unit.answer, unit.shown_images).forEach(({ winner, loser }) => {
        const w = reversed ? loser : winner;
        const l = reversed ? winner : loser;
        out.push({
          ...base, a: shown[0], b: shown[1], tie: false, winner: w, loser: l,
          chosenPosition: shown.length === 2 ? shown.indexOf(winner) : null,
        });
      });
    });
  });
  return out;
}

// ─── A1. Q-score (Strength of Schedule; Salesses et al. 2013) ────────────────

export function qScores(outcomes, { minComparisons = 4 } = {}) {
  const stats = new Map();
  const get = (k) => {
    if (!stats.has(k)) stats.set(k, { w: 0, l: 0, t: 0, beat: [], beatenBy: [] });
    return stats.get(k);
  };
  outcomes.forEach((o) => {
    if (o.tie) { get(o.a).t += 1; get(o.b).t += 1; return; }
    if (!o.winner || !o.loser) return;
    const w = get(o.winner); const l = get(o.loser);
    w.w += 1; w.beat.push(o.loser);
    l.l += 1; l.beatenBy.push(o.winner);
  });
  const W = new Map(); const L = new Map();
  stats.forEach((s, k) => {
    const n = s.w + s.l + s.t;
    W.set(k, n ? s.w / n : 0);
    L.set(k, n ? s.l / n : 0);
  });
  const rows = [...stats.entries()].map(([key, s]) => {
    const n = s.w + s.l + s.t;
    const meanW = s.beat.length ? average(s.beat.map((j) => W.get(j))) : 0;
    const meanL = s.beatenBy.length ? average(s.beatenBy.map((j) => L.get(j))) : 0;
    const sufficient = n >= minComparisons;
    return {
      imageKey: key, wins: s.w, losses: s.l, ties: s.t, comparisons: n,
      W: W.get(key), L: L.get(key), sufficient,
      qScore: sufficient ? (10 / 3) * (W.get(key) + meanW - meanL + 1) : null,
    };
  });
  return rows.sort((a, b) => (b.qScore ?? -1) - (a.qScore ?? -1));
}

// ─── A2 / A3. TrueSkill with draws and order-averaged runs ───────────────────

const TS_MU = 25;
const TS_SIGMA = TS_MU / 3;
const TS_BETA = TS_SIGMA / 2;
const TS_TAU = TS_SIGMA / 100;

function vWin(t, e) {
  const x = t - e;
  if (x < -8) { const y = -x; return y + 1 / y - 2 / y ** 3 + 10 / y ** 5; }
  return normalPdfStd(x) / normalCdf(x);
}
function wWin(t, e) {
  const v = vWin(t, e);
  return Math.min(1, Math.max(0, v * (v + t - e)));
}
function vDraw(t, e) {
  const denom = normalCdf(e - t) - normalCdf(-e - t);
  if (denom < 1e-12) return t < 0 ? -t - e : -t + e;
  return (normalPdfStd(-e - t) - normalPdfStd(e - t)) / denom;
}
function wDraw(t, e) {
  const denom = normalCdf(e - t) - normalCdf(-e - t);
  if (denom < 1e-12) return 1;
  const v = vDraw(t, e);
  return Math.min(1, Math.max(0, v * v + ((e - t) * normalPdfStd(e - t) + (e + t) * normalPdfStd(e + t)) / denom));
}

export function drawMarginFromProbability(p) {
  const clamped = Math.min(0.9, Math.max(0.001, p));
  return normalQuantile((clamped + 1) / 2) * Math.SQRT2 * TS_BETA;
}

/** TrueSkill over outcomes, treating ties as draws with the given draw margin. */
export function trueSkillDraws(outcomes, { drawMargin = 0 } = {}) {
  const players = new Map();
  const get = (k) => {
    if (!players.has(k)) players.set(k, { mu: TS_MU, sigma: TS_SIGMA, wins: 0, losses: 0, ties: 0, games: 0 });
    return players.get(k);
  };
  outcomes.forEach((o) => {
    const p1 = get(o.tie ? o.a : o.winner);
    const p2 = get(o.tie ? o.b : o.loser);
    const s1 = p1.sigma ** 2 + TS_TAU ** 2;
    const s2 = p2.sigma ** 2 + TS_TAU ** 2;
    const c = Math.sqrt(2 * TS_BETA * TS_BETA + s1 + s2);
    const t = (p1.mu - p2.mu) / c;
    const e = drawMargin / c;
    const v = o.tie ? vDraw(t, e) : vWin(t, e);
    const w = o.tie ? wDraw(t, e) : wWin(t, e);
    p1.mu += (s1 / c) * v;
    p2.mu -= (s2 / c) * v;
    p1.sigma = Math.sqrt(Math.max(s1 * (1 - (s1 / (c * c)) * w), 1e-6));
    p2.sigma = Math.sqrt(Math.max(s2 * (1 - (s2 / (c * c)) * w), 1e-6));
    p1.games += 1; p2.games += 1;
    if (o.tie) { p1.ties += 1; p2.ties += 1; } else { p1.wins += 1; p2.losses += 1; }
  });
  return players;
}

export function tieRate(outcomes) {
  const ties = outcomes.filter((o) => o.tie).length;
  return { ties, total: outcomes.length, rate: outcomes.length ? ties / outcomes.length : 0 };
}

/**
 * tieHandling 'exclude' with runs = 1 reproduces the existing TrueSkill exactly.
 * runs > 1 refits on seeded permutations and reports mean μ, SD of μ, and mean σ.
 */
export function trueSkillScores(outcomes, { tieHandling = 'exclude', drawProbability = null, runs = 1, seed = 1 } = {}) {
  const draw = tieHandling === 'draw';
  const used = draw ? outcomes.filter((o) => o.tie || (o.winner && o.loser)) : outcomes.filter((o) => !o.tie && o.winner && o.loser);
  const observed = tieRate(outcomes);
  const p = drawProbability ?? observed.rate;
  const margin = draw && p > 0 ? drawMarginFromProbability(p) : 0;
  const fit = (list) => (draw && margin > 0
    ? trueSkillDraws(list, { drawMargin: margin })
    : computeTrueSkillRatings(list.filter((o) => !o.tie)));
  const nRuns = Math.max(1, Math.floor(runs));
  const rand = seededRandom(seed);
  const acc = new Map();
  for (let r = 0; r < nRuns; r += 1) {
    const order = nRuns === 1 ? used : shuffleSeeded(used, rand);
    fit(order).forEach((s, key) => {
      if (!acc.has(key)) acc.set(key, { mus: [], sigmas: [], wins: s.wins, losses: s.losses, ties: s.ties || 0 });
      acc.get(key).mus.push(s.mu);
      acc.get(key).sigmas.push(s.sigma);
    });
  }
  const tieCounts = new Map();
  outcomes.forEach((o) => { if (o.tie) { tieCounts.set(o.a, (tieCounts.get(o.a) || 0) + 1); tieCounts.set(o.b, (tieCounts.get(o.b) || 0) + 1); } });
  const rows = [...acc.entries()].map(([imageKey, a]) => {
    const mu = average(a.mus);
    const sigma = average(a.sigmas);
    const ties = tieCounts.get(imageKey) || 0;
    const comparisons = a.wins + a.losses + ties;
    return {
      imageKey, mu, sigma, muSd: a.mus.length > 1 ? stdDev(a.mus) : 0, conservative: mu - 3 * sigma,
      wins: a.wins, losses: a.losses, ties, comparisons, tieRate: comparisons ? ties / comparisons : 0,
    };
  }).sort((x, y) => y.mu - x.mu).map((row, i) => ({ rank: i + 1, ...row }));
  return { rows, runs: nRuns, tieHandling: draw && margin > 0 ? 'draw' : 'exclude', drawProbability: draw ? p : null, observedTies: observed };
}

// ─── A4. Scaling ──────────────────────────────────────────────────────────────

export function scaleScores(rows, key, range = '0-10', outKey = 'scaled') {
  const [lo, hi] = SCALE_RANGES[range] || SCALE_RANGES['0-10'];
  const vals = rows.map((r) => r[key]).filter(Number.isFinite);
  const min = Math.min(...vals); const max = Math.max(...vals);
  const span = max - min;
  return rows.map((r) => ({
    ...r,
    [outKey]: Number.isFinite(r[key]) ? (span <= 1e-12 ? (lo + hi) / 2 : lo + ((r[key] - min) / span) * (hi - lo)) : null,
  }));
}

// ─── A5. Coverage and reliability ─────────────────────────────────────────────

export function comparisonCounts(outcomes) {
  const counts = new Map();
  outcomes.forEach((o) => {
    const keys = o.tie ? [o.a, o.b] : [o.winner, o.loser];
    keys.forEach((k) => { if (k) counts.set(k, (counts.get(k) || 0) + 1); });
  });
  return counts;
}

export function coverageSummary(counts, threshold) {
  const values = [...counts.values()].sort((a, b) => a - b);
  if (!values.length) return { images: 0, min: null, median: null, max: null, threshold, below: 0, shareBelow: null };
  const below = values.filter((v) => v < threshold).length;
  return { images: values.length, min: values[0], median: median(values), max: values[values.length - 1], threshold, below, shareBelow: below / values.length };
}

/** Score map key → value, for reuse in split-half and subgroup comparisons. */
export function scoreMap(outcomes, method = 'trueskill', options = {}) {
  if (method === 'qscore') return new Map(qScores(outcomes, options).filter((r) => r.qScore != null).map((r) => [r.imageKey, r.qScore]));
  if (method === 'share') return new Map(sharesFromOutcomes(outcomes).map((r) => [r.imageKey, r.share]));
  return new Map(trueSkillScores(outcomes, options).rows.map((r) => [r.imageKey, r.mu]));
}

/** Random participant halves; Spearman ρ of per-image scores with Spearman–Brown correction. */
export function splitHalfReliability(outcomes, { method = 'trueskill', splits = 100, seed = 1, options = {} } = {}) {
  const participants = [...new Set(outcomes.map((o) => o.participant))];
  if (participants.length < 4) return { mean: null, low: null, high: null, valid: 0, splits };
  const rand = seededRandom(seed);
  const values = [];
  for (let s = 0; s < splits; s += 1) {
    const order = shuffleSeeded(participants, rand);
    const half = new Set(order.slice(0, Math.floor(order.length / 2)));
    const a = scoreMap(outcomes.filter((o) => half.has(o.participant)), method, options);
    const b = scoreMap(outcomes.filter((o) => !half.has(o.participant)), method, options);
    const { rho } = spearmanOfMaps(a, b);
    if (rho != null && rho > -1) values.push((2 * rho) / (1 + rho));
  }
  const sorted = [...values].sort((x, y) => x - y);
  return { mean: values.length ? average(values) : null, low: quantileSorted(sorted, 0.025), high: quantileSorted(sorted, 0.975), valid: values.length, splits };
}

export function cohensKappa(pairs) {
  if (!pairs.length) return null;
  const cats = [...new Set(pairs.flat())];
  const n = pairs.length;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe >= 1 ? null : (po - pe) / (1 - pe);
}

/** Quadratic-weighted kappa for ordinal ratings given as [first, second] pairs. */
export function weightedKappa(pairs, categories = null) {
  if (!pairs.length) return null;
  const cats = (categories || [...new Set(pairs.flat())]).map(Number).sort((a, b) => a - b);
  const k = cats.length;
  if (k < 2) return null;
  const idx = new Map(cats.map((c, i) => [c, i]));
  const obs = Array.from({ length: k }, () => new Array(k).fill(0));
  pairs.forEach(([a, b]) => { if (idx.has(Number(a)) && idx.has(Number(b))) obs[idx.get(Number(a))][idx.get(Number(b))] += 1; });
  const n = obs.flat().reduce((s, v) => s + v, 0);
  if (!n) return null;
  const rowM = obs.map((r) => r.reduce((s, v) => s + v, 0));
  const colM = cats.map((_, j) => obs.reduce((s, r) => s + r[j], 0));
  let num = 0; let den = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const w = ((i - j) ** 2) / ((k - 1) ** 2);
      num += w * obs[i][j];
      den += w * (rowM[i] * colM[j]) / n;
    }
  }
  return den === 0 ? null : 1 - num / den;
}

/** Repeated pairs within a participant → Cohen's kappa on the chosen image. */
export function choiceRetestKappa(outcomes) {
  const seen = new Map();
  const pairs = [];
  outcomes.forEach((o) => {
    const [x, y] = [o.a, o.b].sort();
    const key = `${o.participant}|${x}|${y}`;
    const label = o.tie ? 'tie' : (o.winner === x ? 'first' : 'second');
    if (seen.has(key)) pairs.push([seen.get(key), label]); else seen.set(key, label);
  });
  return { kappa: cohensKappa(pairs), pairs: pairs.length };
}

// ─── A6. Per-stimulus statistics for ratings, sliders, matrices ───────────────

function columnNumeric(question, value) {
  const n = Number(value);
  if (Number.isFinite(n) && value !== '' && value !== null && typeof value !== 'boolean') return n;
  const cols = (question?.columns || []).map((c) => (typeof c === 'object' ? c.value ?? c.text : c));
  const i = cols.findIndex((c) => String(c) === String(value));
  return i >= 0 ? i + 1 : null;
}

/** Numeric value of one answer unit for an optional slider dimension or matrix row. */
export function numericUnitValue(question, answer, { dimension = null, row = null } = {}) {
  if (answer == null) return null;
  if (dimension != null) { const v = Number(answer?.[dimension]); return Number.isFinite(v) ? v : null; }
  if (row != null) return columnNumeric(question, answer?.[row]);
  if (typeof answer === 'boolean') return answer ? 1 : 0;
  const b = normalizeBooleanAnswer(answer);
  if (['boolean', 'imageboolean', 'mediaboolean'].includes(question?.type) && b !== '') return b;
  const v = Number(answer);
  return Number.isFinite(v) && answer !== '' ? v : null;
}

export function stimulusObservations(responses, question, opts = {}) {
  const obs = [];
  (responses || []).forEach((row, rowIndex) => {
    expandQuestionAnswerUnits(row, question.name, { requireAnswer: true }).forEach((unit) => {
      const value = numericUnitValue(question, unit.answer, opts);
      if (value == null) return;
      obs.push({
        stimulus: unit.shown_images?.length ? stimulusUnitKey(unit.shown_images) : question.name,
        participant: participantKey(row, rowIndex), row, value,
      });
    });
  });
  return obs;
}

export function perStimulusStats(observations) {
  const groups = new Map();
  observations.forEach((o) => { if (!groups.has(o.stimulus)) groups.set(o.stimulus, []); groups.get(o.stimulus).push(o.value); });
  return [...groups.entries()].map(([stimulus, values]) => ({
    stimulus, n: values.length, mean: average(values), sd: sampleSd(values), median: median(values),
    min: Math.min(...values), max: Math.max(...values),
  })).sort((a, b) => b.mean - a.mean);
}

/** Same participant rating the same stimulus twice → quadratic-weighted kappa. */
export function ratingRetestKappa(observations, categories = null) {
  const seen = new Map();
  const pairs = [];
  observations.forEach((o) => {
    const key = `${o.participant}|${o.stimulus}`;
    if (seen.has(key)) pairs.push([seen.get(key), o.value]); else seen.set(key, o.value);
  });
  return { kappa: weightedKappa(pairs, categories), pairs: pairs.length };
}

// ─── A7 / A12. Subgroups, conditions, Welch tests ─────────────────────────────

export function welchTTest(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const va = sampleVariance(a) / a.length;
  const vb = sampleVariance(b) / b.length;
  if (va + vb === 0) return null;
  const t = (average(a) - average(b)) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / ((va ** 2) / (a.length - 1) + (vb ** 2) / (b.length - 1));
  return { t, df, p: tTwoSidedP(t, df), meanA: average(a), meanB: average(b), nA: a.length, nB: b.length };
}

export function welchAnova(groups) {
  const gs = groups.filter((g) => g.length >= 2);
  const k = gs.length;
  if (k < 2) return null;
  const w = gs.map((g) => { const v = sampleVariance(g); return v > 0 ? g.length / v : null; });
  if (w.some((x) => x == null)) return null;
  const means = gs.map(average);
  const sw = w.reduce((s, x) => s + x, 0);
  const grand = w.reduce((s, x, i) => s + x * means[i], 0) / sw;
  const a = w.reduce((s, x, i) => s + x * (means[i] - grand) ** 2, 0) / (k - 1);
  const lambda = w.reduce((s, x, i) => s + ((1 - x / sw) ** 2) / (gs[i].length - 1), 0);
  const b = 1 + (2 * (k - 2) * lambda) / (k * k - 1);
  const F = a / b;
  const df1 = k - 1;
  const df2 = (k * k - 1) / (3 * lambda);
  return { F, df1, df2, p: 1 - fCdf(F, df1, df2), groups: k };
}

export const BFI10_KEY = Object.freeze({
  extraversion: [[1, true], [6, false]],
  agreeableness: [[2, false], [7, true]],
  conscientiousness: [[3, true], [8, false]],
  neuroticism: [[4, true], [9, false]],
  openness: [[5, true], [10, false]],
});

function choiceIndexValue(question, value) {
  const n = Number(value);
  if (Number.isFinite(n) && value !== '') return n;
  const choices = (question?.choices || []).map((c) => (typeof c === 'object' ? c.value ?? c.text : c));
  const i = choices.findIndex((c) => String(c) === String(value));
  return i >= 0 ? i + 1 : null;
}

/** BFI-10 trait score: mean of the two items on 1–5, reverse items as 6 − x. */
export function bfiTraitScore(row, trait, itemQuestions) {
  const items = BFI10_KEY[trait];
  if (!items) return null;
  const vals = items.map(([n, reverse]) => {
    const q = itemQuestions[n - 1];
    const v = q ? choiceIndexValue(q, rowAnswer(row, q.name)) : null;
    return v == null ? null : (reverse ? 6 - v : v);
  });
  return vals.some((v) => v == null) ? null : average(vals);
}

/**
 * groupBy: { type: 'question', name } | { type: 'condition' } | { type: 'urlParam', name }
 *        | { type: 'numeric', name, split: 'median'|'terciles' } | { type: 'bfi', trait, items, split }
 */
export function responseGroups(responses, groupBy, questionsByName = {}) {
  const raw = (responses || []).map((row) => {
    if (groupBy.type === 'condition') return responseCondition(row);
    if (groupBy.type === 'urlParam') return responseUrlParam(row, groupBy.name);
    if (groupBy.type === 'bfi') return bfiTraitScore(row, groupBy.trait, groupBy.items || []);
    const v = rowAnswer(row, groupBy.name);
    if (groupBy.type === 'numeric') return choiceIndexValue(questionsByName[groupBy.name], v);
    if (Array.isArray(v)) return v.join('|');
    return v == null || v === '' ? null : String(v);
  });
  const numeric = groupBy.type === 'numeric' || groupBy.type === 'bfi';
  if (!numeric) return raw;
  const vals = raw.filter(Number.isFinite).sort((a, b) => a - b);
  if (!vals.length) return raw.map(() => null);
  if (groupBy.split === 'terciles') {
    const t1 = quantileSorted(vals, 1 / 3); const t2 = quantileSorted(vals, 2 / 3);
    return raw.map((v) => (Number.isFinite(v) ? (v <= t1 ? 'low' : v <= t2 ? 'middle' : 'high') : null));
  }
  const m = median(vals);
  return raw.map((v) => (Number.isFinite(v) ? (v <= m ? 'low' : 'high') : null));
}

/** Share of a participant's decisive choices that agree with the pooled ranking. */
export function participantAgreement(outcomes, pooled) {
  const byP = new Map();
  outcomes.forEach((o) => {
    if (o.tie || !pooled.has(o.winner) || !pooled.has(o.loser)) return;
    const d = pooled.get(o.winner) - pooled.get(o.loser);
    if (d === 0) return;
    if (!byP.has(o.participant)) byP.set(o.participant, [0, 0]);
    const s = byP.get(o.participant);
    s[0] += d > 0 ? 1 : 0; s[1] += 1;
  });
  return new Map([...byP.entries()].map(([p, [a, n]]) => [p, a / n]));
}

/** Per-group pairwise scores, between-group Spearman, Welch test on participant agreement. */
export function pairwiseGroupComparison(outcomes, groupOfParticipant, { method = 'trueskill', options = {}, minPerImage = 0 } = {}) {
  const groups = new Map();
  outcomes.forEach((o) => {
    const g = groupOfParticipant.get(o.participant);
    if (g == null) return;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(o);
  });
  const pooled = scoreMap(outcomes, method, options);
  const agreement = participantAgreement(outcomes, pooled);
  const boards = [...groups.entries()].map(([group, outs]) => {
    const counts = comparisonCounts(outs);
    return {
      group, outcomes: outs.length, participants: new Set(outs.map((o) => o.participant)).size,
      scores: scoreMap(outs, method, options),
      lowCoverage: minPerImage > 0 && [...counts.values()].some((c) => c < minPerImage),
    };
  }).sort((a, b) => String(a.group).localeCompare(String(b.group)));
  const correlations = [];
  for (let i = 0; i < boards.length; i += 1) {
    for (let j = i + 1; j < boards.length; j += 1) {
      correlations.push({ a: boards[i].group, b: boards[j].group, ...spearmanOfMaps(boards[i].scores, boards[j].scores) });
    }
  }
  const agreementGroups = boards.map((b) => [...agreement.entries()].filter(([p]) => groupOfParticipant.get(p) === b.group).map(([, v]) => v));
  const test = boards.length === 2 ? { kind: 'welch_t', ...welchTTest(agreementGroups[0], agreementGroups[1]) } : { kind: 'welch_anova', ...welchAnova(agreementGroups) };
  return { boards, correlations, test, pooled };
}

/** Per-group per-stimulus means and Welch test on participant mean ratings. */
export function ratingGroupComparison(observations, groupOfParticipant) {
  const groups = new Map();
  observations.forEach((o) => {
    const g = groupOfParticipant.get(o.participant);
    if (g == null) return;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(o);
  });
  const boards = [...groups.entries()].map(([group, obs]) => ({
    group, n: obs.length, participants: new Set(obs.map((o) => o.participant)).size,
    scores: new Map(perStimulusStats(obs).map((r) => [r.stimulus, r.mean])),
    participantMeans: [...obs.reduce((m, o) => m.set(o.participant, [...(m.get(o.participant) || []), o.value]), new Map()).values()].map(average),
  })).sort((a, b) => String(a.group).localeCompare(String(b.group)));
  const correlations = [];
  for (let i = 0; i < boards.length; i += 1) {
    for (let j = i + 1; j < boards.length; j += 1) correlations.push({ a: boards[i].group, b: boards[j].group, ...spearmanOfMaps(boards[i].scores, boards[j].scores) });
  }
  const test = boards.length === 2 ? { kind: 'welch_t', ...welchTTest(boards[0].participantMeans, boards[1].participantMeans) } : { kind: 'welch_anova', ...welchAnova(boards.map((b) => b.participantMeans)) };
  return { boards, correlations, test };
}

export function participantGroupMap(responses, groups) {
  const map = new Map();
  (responses || []).forEach((row, i) => { if (groups[i] != null) map.set(participantKey(row, i), groups[i]); });
  return map;
}

// ─── A8 / A14 / A16. Choice shares, long export, threshold labels ─────────────

export function pairChoiceShares(outcomes, { groupKey = (o) => o.category } = {}) {
  const pairs = new Map();
  outcomes.forEach((o) => {
    const [x, y] = [o.a, o.b].sort();
    const group = groupKey(o) ?? '';
    const key = `${group}|${x}|${y}`;
    if (!pairs.has(key)) pairs.set(key, { group, first: x, second: y, firstChosen: 0, secondChosen: 0, ties: 0 });
    const p = pairs.get(key);
    if (o.tie) p.ties += 1; else if (o.winner === x) p.firstChosen += 1; else p.secondChosen += 1;
  });
  return [...pairs.values()].map((p) => {
    const decisive = p.firstChosen + p.secondChosen;
    const ci = wilsonCI(p.firstChosen, decisive);
    return { ...p, n: decisive + p.ties, share: decisive ? p.firstChosen / decisive : null, low: decisive ? ci.low : null, high: decisive ? ci.high : null };
  });
}

/** Share chosen per image from answer units: chosen ÷ shown; ties count as shown only. */
export function imageChoiceShares(responses, questionName, { reverseCoded = false } = {}) {
  const stats = new Map();
  const get = (k) => { if (!stats.has(k)) stats.set(k, { shown: 0, chosen: 0 }); return stats.get(k); };
  (responses || []).forEach((row) => {
    const reversed = typeof reverseCoded === 'function' ? reverseCoded(row) : reverseCoded;
    expandQuestionAnswerUnits(row, questionName, { requireAnswer: true }).forEach((unit) => {
      const shown = shownKeysOf(unit);
      if (shown.length < 2) return;
      shown.forEach((k) => { get(k).shown += 1; });
      if (isNoPreference(unit.answer)) return;
      const selected = answerToSelectedKeys(unit.answer, unit.shown_images);
      if (!selected.length) return;
      const chosen = reversed ? shown.filter((k) => !selected.includes(k)) : selected;
      chosen.forEach((k) => { get(k).chosen += 1; });
    });
  });
  return [...stats.entries()].map(([imageKey, s]) => {
    const ci = wilsonCI(s.chosen, s.shown);
    return { imageKey, shown: s.shown, chosen: s.chosen, share: s.shown ? s.chosen / s.shown : null, low: ci.low, high: ci.high };
  }).sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
}

export function sharesFromOutcomes(outcomes) {
  const stats = new Map();
  const get = (k) => { if (!stats.has(k)) stats.set(k, { shown: 0, chosen: 0 }); return stats.get(k); };
  outcomes.forEach((o) => {
    get(o.a).shown += 1; get(o.b).shown += 1;
    if (!o.tie && o.winner) get(o.winner).chosen += 1;
  });
  return [...stats.entries()].map(([imageKey, s]) => ({ imageKey, ...s, share: s.shown ? s.chosen / s.shown : null }));
}

export function thresholdLabels(shareRows, k = 3) {
  return shareRows.map((r) => ({ ...r, threshold: k, label: r.chosen >= k ? 1 : 0 }));
}

const COVARIATE_TYPES = new Set(['radiogroup', 'dropdown', 'text', 'comment', 'boolean', 'rating', 'checkbox', 'number', 'consent', 'tagbox']);

function flatQuestions(surveyConfig) {
  const out = [];
  const walk = (els) => (els || []).forEach((e) => { out.push(e); if (e.elements) walk(e.elements); });
  (surveyConfig?.pages || []).forEach((p) => walk(p.elements));
  return out;
}

/** One row per compared pair, with participant answers as covariates (Ramírez, Lopes, Wang). */
export function longFormatRows(responses, surveyConfig, questionName, { reverseCoded = false } = {}) {
  const covariates = flatQuestions(surveyConfig).filter((q) => COVARIATE_TYPES.has(q.type) && q.name !== questionName);
  const paramNames = [...new Set((responses || []).flatMap((r) => Object.keys(r?.survey_metadata?.url_params || {})))];
  const rows = [];
  (responses || []).forEach((row, rowIndex) => {
    const reversed = typeof reverseCoded === 'function' ? reverseCoded(row) : reverseCoded;
    const outs = pairwiseOutcomes([row], questionName, { reverseCoded: reversed });
    const trials = row?.responses?.[questionName]?.trials;
    const extra = {};
    covariates.forEach((q) => { const v = rowAnswer(row, q.name); extra[q.name] = Array.isArray(v) ? v.join('|') : (v ?? ''); });
    paramNames.forEach((p) => { extra[`url_${p}`] = responseUrlParam(row, p) ?? ''; });
    outs.forEach((o) => {
      const trial = Array.isArray(trials) ? trials[o.trial] : null;
      const shownAt = Date.parse(trial?.shown_at || '');
      const answeredAt = Date.parse(trial?.answered_at || '');
      rows.push({
        participant_id: participantKey(row, rowIndex),
        trial_index: o.trial,
        question: questionName,
        pair_id: [o.a, o.b].sort().join(' | '),
        left_media: o.a,
        right_media: o.b,
        left_tag: o.positionTags?.[0] ?? o.category ?? '',
        right_tag: o.positionTags?.[1] ?? o.category ?? '',
        chosen_media: o.tie ? '' : o.winner,
        outcome: o.tie ? 'tie' : (o.winner === o.a ? 'A' : 'B'),
        chosen_position: o.chosenPosition == null ? '' : (o.chosenPosition === 0 ? 'left' : 'right'),
        response_ms: Number.isFinite(shownAt) && Number.isFinite(answeredAt) ? answeredAt - shownAt : '',
        condition: o.condition ?? '',
        reverse_coded: reversed ? 1 : 0,
        ...extra,
      });
    });
  });
  return rows;
}

/** Participants who always picked the same screen position (Peng et al. 2026). */
export function samePositionParticipants(outcomes, minTrials = 5) {
  const byP = new Map();
  outcomes.forEach((o) => {
    if (o.tie || o.chosenPosition == null) return;
    if (!byP.has(o.participant)) byP.set(o.participant, new Set());
    byP.get(o.participant).add(o.chosenPosition);
    byP.get(o.participant).n = (byP.get(o.participant).n || 0) + 1;
  });
  return [...byP.entries()].filter(([, s]) => s.size === 1 && s.n >= minTrials).map(([p]) => p);
}

// ─── A10. Rater agreement (ICC, weighted kappa, Fleiss' kappa) ───────────────

/** stimulus → Map(rater → value); repeated ratings by one rater are averaged. */
export function raterTable(observations, raterOf = (o) => o.participant) {
  const table = new Map();
  observations.forEach((o) => {
    const rater = raterOf(o);
    if (rater == null || rater === '') return;
    if (!table.has(o.stimulus)) table.set(o.stimulus, new Map());
    const m = table.get(o.stimulus);
    m.set(rater, [...(m.get(rater) || []), o.value]);
  });
  table.forEach((m) => m.forEach((vals, r) => m.set(r, average(vals))));
  return table;
}

/** Largest complete stimulus × rater matrix, dropping the least-covering raters first. */
export function completeMatrix(table) {
  let raters = [...new Set([...table.values()].flatMap((m) => [...m.keys()]))];
  const build = () => [...table.entries()].filter(([, m]) => raters.every((r) => m.has(r))).map(([s, m]) => ({ stimulus: s, values: raters.map((r) => m.get(r)) }));
  let rows = build();
  while (raters.length > 2 && rows.length < 2) {
    const cover = raters.map((r) => [r, [...table.values()].filter((m) => m.has(r)).length]).sort((a, b) => a[1] - b[1]);
    raters = raters.filter((r) => r !== cover[0][0]);
    rows = build();
  }
  return { raters, rows };
}

/** Two-way random, absolute agreement ICC(2,1) and ICC(2,k) with McGraw & Wong 95% CIs. */
export function iccTwoWay(matrix) {
  const n = matrix.length;
  const k = matrix[0]?.length || 0;
  if (n < 2 || k < 2) return null;
  const grand = average(matrix.flat());
  const rowM = matrix.map(average);
  const colM = Array.from({ length: k }, (_, j) => average(matrix.map((r) => r[j])));
  const ssr = k * rowM.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssc = n * colM.reduce((s, m) => s + (m - grand) ** 2, 0);
  const sst = matrix.flat().reduce((s, v) => s + (v - grand) ** 2, 0);
  const sse = sst - ssr - ssc;
  const msr = ssr / (n - 1);
  const msc = ssc / (k - 1);
  const mse = sse / ((n - 1) * (k - 1));
  const icc1 = (msr - mse) / (msr + (k - 1) * mse + (k * (msc - mse)) / n);
  const iccK = (msr - mse) / (msr + (msc - mse) / n);
  let low1 = null; let high1 = null;
  if (icc1 < 1 && mse > 0) {
    const a = (k * icc1) / (n * (1 - icc1));
    const b = 1 + (k * icc1 * (n - 1)) / (n * (1 - icc1));
    const v = (a * msc + b * mse) ** 2 / ((a * msc) ** 2 / (k - 1) + (b * mse) ** 2 / ((n - 1) * (k - 1)));
    const fu = fQuantile(0.975, n - 1, v);
    const fl = fQuantile(0.975, v, n - 1);
    low1 = (n * (msr - fu * mse)) / (fu * (k * msc + (k * n - k - n) * mse) + n * msr);
    high1 = (n * (fl * msr - mse)) / (k * msc + (k * n - k - n) * mse + n * fl * msr);
  }
  const sb = (x) => (x == null ? null : (k * x) / (1 + (k - 1) * x));
  return { n, k, icc1, iccK, icc1Low: low1, icc1High: high1, iccKLow: sb(low1), iccKHigh: sb(high1), msr, msc, mse };
}

/** Fleiss' kappa from per-stimulus category labels (unequal rater counts allowed). */
export function fleissKappa(labelLists) {
  const items = labelLists.filter((l) => l.length >= 2);
  if (items.length < 2) return null;
  const cats = [...new Set(items.flat())];
  let totalN = 0;
  const catTotals = new Map(cats.map((c) => [c, 0]));
  const pis = items.map((labels) => {
    const n = labels.length;
    totalN += n;
    const counts = cats.map((c) => labels.filter((x) => x === c).length);
    counts.forEach((c, i) => catTotals.set(cats[i], catTotals.get(cats[i]) + c));
    return (counts.reduce((s, c) => s + c * c, 0) - n) / (n * (n - 1));
  });
  const pBar = average(pis);
  const pe = cats.reduce((s, c) => s + (catTotals.get(c) / totalN) ** 2, 0);
  return pe >= 1 ? null : (pBar - pe) / (1 - pe);
}

export function raterAgreement(observations, { raterOf, categorical = false } = {}) {
  const table = raterTable(observations, raterOf);
  const { raters, rows } = completeMatrix(table);
  const icc = categorical ? null : iccTwoWay(rows.map((r) => r.values));
  const fleiss = categorical ? fleissKappa([...table.values()].map((m) => [...m.values()].map(String))) : null;
  const wk = raters.length === 2 && rows.length >= 2 ? weightedKappa(rows.map((r) => r.values.map((v) => Math.round(v)))) : null;
  return { raters: raters.length, stimuli: rows.length, totalStimuli: table.size, icc, weightedKappa: wk, fleissKappa: fleiss };
}

// ─── A11. Median with MAD screening ───────────────────────────────────────────

export function madScreen(values, threshold = 3) {
  const med = median(values);
  if (med == null) return { median: null, mad: null, kept: [], removed: [] };
  const mad = median(values.map((v) => Math.abs(v - med)));
  if (!mad) return { median: med, mad: 0, kept: [...values], removed: [] };
  const kept = []; const removed = [];
  values.forEach((v) => (Math.abs(v - med) > threshold * mad ? removed : kept).push(v));
  return { median: med, mad, kept, removed };
}

export function robustStimulusStats(observations, { threshold = 3 } = {}) {
  const groups = new Map();
  observations.forEach((o) => { if (!groups.has(o.stimulus)) groups.set(o.stimulus, []); groups.get(o.stimulus).push(o.value); });
  return [...groups.entries()].map(([stimulus, values]) => {
    const s = madScreen(values, threshold);
    return { stimulus, nBefore: values.length, nAfter: s.kept.length, removed: s.removed.length, median: median(s.kept), mean: average(s.kept), mad: s.mad };
  }).sort((a, b) => (b.median ?? -Infinity) - (a.median ?? -Infinity));
}

// ─── A13. Aggregation by URL parameter ────────────────────────────────────────

export function aggregateByParam(observations, paramName) {
  const groups = new Map();
  observations.forEach((o) => {
    const key = responseUrlParam(o.row, paramName);
    if (key == null) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o.value);
  });
  return [...groups.entries()].map(([value, vals]) => {
    const m = average(vals);
    const sd = sampleSd(vals);
    const half = sd != null && vals.length > 1 ? tQuantile(0.975, vals.length - 1) * sd / Math.sqrt(vals.length) : null;
    return { param: paramName, value, n: vals.length, mean: m, sd, low: half == null ? null : m - half, high: half == null ? null : m + half };
  }).sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { numeric: true }));
}

// ─── A15. Evaluative map (liked − disliked annotation density) ───────────────

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const xi = pts[i].x; const yi = pts[i].y; const xj = pts[j].x; const yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function shapeCells(shape, grid) {
  const pts = (shape?.points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  const cells = new Set();
  const cellOf = (p) => `${Math.min(grid - 1, Math.max(0, Math.floor(p.y * grid)))},${Math.min(grid - 1, Math.max(0, Math.floor(p.x * grid)))}`;
  const tool = shape?.tool || (pts.length === 1 ? 'point' : 'polygon');
  if (tool === 'point' || pts.length === 1 || tool === 'line') { pts.forEach((p) => cells.add(cellOf(p))); return cells; }
  let poly = pts;
  if (tool === 'bbox' && pts.length >= 2) {
    const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    poly = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  }
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      if (pointInPolygon((j + 0.5) / grid, (i + 0.5) / grid, poly)) cells.add(`${i},${j}`);
    }
  }
  if (!cells.size) pts.forEach((p) => cells.add(cellOf(p)));
  return cells;
}

/** Share of annotation units covering each grid cell; each unit counts once per cell. */
export function annotationDensity(responses, questionName, { grid = 40, label = null } = {}) {
  const counts = new Map();
  let units = 0;
  (responses || []).forEach((row) => {
    expandQuestionAnswerUnits(row, questionName, { requireAnswer: true }).forEach((unit) => {
      const shapes = (unit.answer?.shapes || []).filter((s) => !label || s.label === label);
      if (!shapes.length) return;
      units += 1;
      const covered = new Set();
      shapes.forEach((s) => shapeCells(s, grid).forEach((c) => covered.add(c)));
      covered.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1));
    });
  });
  return { grid, units, density: new Map([...counts.entries()].map(([c, n]) => [c, n / units])) };
}

export function evaluativeMap(responses, likedQuestion, dislikedQuestion, { grid = 40, likedLabel = null, dislikedLabel = null } = {}) {
  const liked = annotationDensity(responses, likedQuestion, { grid, label: likedLabel });
  const disliked = annotationDensity(responses, dislikedQuestion, { grid, label: dislikedLabel });
  const cells = [];
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const key = `${i},${j}`;
      const l = liked.density.get(key) || 0;
      const d = disliked.density.get(key) || 0;
      if (l || d) cells.push({ row: i, col: j, liked: l, disliked: d, diff: l - d });
    }
  }
  return { grid, likedUnits: liked.units, dislikedUnits: disliked.units, cells };
}

/** Most frequently shown image for an annotation question (the base map when it comes from the media pool). */
export function annotationBaseImage(responses, questionName) {
  const counts = new Map();
  (responses || []).forEach((row) => {
    expandQuestionAnswerUnits(row, questionName, { requireAnswer: false }).forEach((unit) => {
      const first = unit.shown_images?.[0];
      const url = typeof first === 'string' ? first : first?.url || first?.imageLink || '';
      if (url) counts.set(url, (counts.get(url) || 0) + 1);
    });
  });
  let best = '';
  let max = 0;
  counts.forEach((n, url) => { if (n > max) { best = url; max = n; } });
  return best;
}

/** Annotation notes (S5) grouped by label for text review. */
export function annotationNotes(responses, questionName) {
  const notes = [];
  (responses || []).forEach((row, i) => {
    expandQuestionAnswerUnits(row, questionName, { requireAnswer: true }).forEach((unit) => {
      (unit.answer?.shapes || []).forEach((s) => {
        if (s?.note) notes.push({ participant_id: participantKey(row, i), label: s.label || '', note: String(s.note) });
      });
    });
  });
  return notes;
}
