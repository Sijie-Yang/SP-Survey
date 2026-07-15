/** TrueSkill-style 1v1 rating for imagepicker (any count, single or multi-select). */

const DEFAULT_MU = 25;
const DEFAULT_SIGMA = DEFAULT_MU / 3;
const BETA = DEFAULT_SIGMA / 2;
const TAU = DEFAULT_SIGMA / 100;

function cdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function pdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function v(t, eps) {
  const denom = cdf(eps - t);
  if (denom < 1e-10) return -t - eps;
  return pdf(eps - t) / denom;
}

function wFactor(t, eps) {
  const denom = cdf(eps - t);
  if (denom < 1e-10) return 1;
  const vv = v(t, eps);
  return vv * (vv + eps - t);
}

function ensurePlayer(players, key) {
  if (!players.has(key)) {
    players.set(key, { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA, wins: 0, losses: 0, games: 0 });
  }
  return players.get(key);
}

export function filenameKey(val) {
  if (!val || typeof val !== 'string') return String(val ?? '');
  return val.split('?')[0].split('/').pop();
}

/**
 * Map imagepicker answer(s) to filename keys from the shown set.
 * Handles enriched filenames/URLs and legacy image_0 indices.
 */
export function answerToSelectedKeys(answer, shownImages) {
  if (answer === null || answer === undefined || answer === '') return [];
  const shown = (shownImages || []).map((s) => (typeof s === 'string' ? s : s?.url || s?.name || ''));
  const shownKeys = shown.map(filenameKey);
  const values = Array.isArray(answer) ? answer : [answer];
  const selected = new Set();

  values.forEach((val) => {
    if (val === null || val === undefined || val === '') return;
    const str = String(val);
    const indexMatch = str.match(/^image_(\d+)$/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10);
      if (shownKeys[idx]) selected.add(shownKeys[idx]);
      return;
    }
    const fk = filenameKey(str);
    const exact = shownKeys.find((k) => k === fk);
    if (exact) {
      selected.add(exact);
      return;
    }
    const byUrl = shown.find((s) => filenameKey(s) === fk || s === str || s.includes(fk));
    if (byUrl) selected.add(filenameKey(byUrl));
    else if (fk) selected.add(fk);
  });

  return [...selected];
}

/**
 * From one imagepicker response: each selected image wins against each non-selected shown image.
 * @returns {Array<{ winner: string, loser: string }>}
 */
export function matchesFromImagePickerAnswer(answer, shownImages) {
  const shownKeys = (shownImages || []).map((s) => filenameKey(typeof s === 'string' ? s : s?.url || s?.name || ''))
    .filter(Boolean);
  if (shownKeys.length < 2) return [];

  const winnerKeys = answerToSelectedKeys(answer, shownImages);
  if (!winnerKeys.length) return [];

  const loserKeys = shownKeys.filter((k) => !winnerKeys.includes(k));
  if (!loserKeys.length) return [];

  const matches = [];
  winnerKeys.forEach((winner) => {
    loserKeys.forEach((loser) => {
      if (winner !== loser) matches.push({ winner, loser });
    });
  });
  return matches;
}

/**
 * Extract all pairwise outcomes from imagepicker responses (any imageCount, single/multi-select).
 */
export function extractPairwiseMatches(responses, questionName) {
  const matches = [];
  for (const row of responses) {
    const qData = row.responses?.[questionName];
    if (!qData) continue;
    const ans = typeof qData === 'object' && 'answer' in qData ? qData.answer : qData;
    const shown = qData.shown_images?.length
      ? qData.shown_images
      : (row.displayed_images?.[questionName] || []);
    matches.push(...matchesFromImagePickerAnswer(ans, shown));
  }
  return matches;
}

/**
 * Run TrueSkill updates over all matches.
 */
export function computeTrueSkillRatings(matches) {
  const players = new Map();

  matches.forEach(({ winner, loser }) => {
    const winnerP = ensurePlayer(players, winner);
    const loserP = ensurePlayer(players, loser);

    const c = Math.sqrt(2 * BETA * BETA + winnerP.sigma * winnerP.sigma + loserP.sigma * loserP.sigma);
    const t = (winnerP.mu - loserP.mu) / c;
    const eps = 0;

    const vw = v(t, eps);
    const ww = wFactor(t, eps);

    const wSigma2 = winnerP.sigma * winnerP.sigma;
    const lSigma2 = loserP.sigma * loserP.sigma;

    winnerP.mu += (wSigma2 / c) * vw;
    winnerP.sigma = Math.sqrt(Math.max(wSigma2 * (1 - (wSigma2 / (c * c)) * ww) + TAU * TAU, 1e-6));
    loserP.mu -= (lSigma2 / c) * vw;
    loserP.sigma = Math.sqrt(Math.max(lSigma2 * (1 - (lSigma2 / (c * c)) * ww) + TAU * TAU, 1e-6));

    winnerP.wins += 1;
    winnerP.games += 1;
    loserP.losses += 1;
    loserP.games += 1;
  });

  const result = new Map();
  players.forEach((p, key) => {
    result.set(key, {
      ...p,
      conservative: p.mu - 3 * p.sigma,
    });
  });
  return result;
}

export function rankTrueSkillPlayers(ratings) {
  return [...ratings.entries()]
    .sort((a, b) => b[1].conservative - a[1].conservative)
    .map(([key, stats], idx) => ({ rank: idx + 1, imageKey: key, ...stats }));
}

/** Min-max scale μ within one question to 0–5 (highest μ → 5, lowest → 0). */
export function attachMuStd5(rankings) {
  if (!rankings?.length) return [];
  const mus = rankings.map((r) => r.mu);
  const minMu = Math.min(...mus);
  const maxMu = Math.max(...mus);
  const span = maxMu - minMu;
  return rankings.map((r) => ({
    ...r,
    muStd5: span <= 1e-9 ? 2.5 : ((r.mu - minMu) / span) * 5,
  }));
}

export function computeQuestionTrueSkill(responses, questionName) {
  const matches = extractPairwiseMatches(responses, questionName);
  return computeTrueSkillFromMatches(matches);
}

/**
 * From a full ranking (best → worst): each higher-ranked image beats every lower-ranked one.
 * e.g. [A,B,C] → A≻B, A≻C, B≻C
 */
export function matchesFromOrderedRanking(orderedKeys) {
  const keys = (orderedKeys || []).filter(Boolean);
  const matches = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      if (keys[i] !== keys[j]) matches.push({ winner: keys[i], loser: keys[j] });
    }
  }
  return matches;
}

/**
 * MaxDiff / Best–Worst → pairwise TrueSkill matches.
 * For shown set with best B and worst W:
 *   - B beats every other shown image (including W)
 *   - every middle image (neither B nor W) beats W
 * e.g. {A,B,C,D} best=A worst=D → A≻B, A≻C, A≻D, B≻D, C≻D
 *
 * answer: { bestIndex, worstIndex, shownUrls? }
 * shownImages: trial media list (preferred over answer.shownUrls)
 */
export function matchesFromMaxDiffAnswer(answer, shownImages) {
  if (!answer || typeof answer !== 'object') return [];
  const { bestIndex, worstIndex } = answer;
  if (bestIndex == null || worstIndex == null || bestIndex === worstIndex) return [];

  const rawShown = (shownImages?.length ? shownImages : (answer.shownUrls || []));
  const shownKeys = rawShown
    .map((s) => filenameKey(typeof s === 'string' ? s : s?.url || s?.name || ''))
    .filter(Boolean);
  if (shownKeys.length < 2) return [];
  if (bestIndex < 0 || bestIndex >= shownKeys.length) return [];
  if (worstIndex < 0 || worstIndex >= shownKeys.length) return [];

  const best = shownKeys[bestIndex];
  const worst = shownKeys[worstIndex];
  if (!best || !worst || best === worst) return [];

  const matches = [];
  shownKeys.forEach((key) => {
    if (key !== best) matches.push({ winner: best, loser: key });
  });
  shownKeys.forEach((key) => {
    if (key !== best && key !== worst) matches.push({ winner: key, loser: worst });
  });
  return matches;
}

/** Run TrueSkill on an arbitrary list of { winner, loser } matches. */
export function computeTrueSkillFromMatches(matches) {
  if (!matches?.length) return { matches: [], rankings: [] };
  const ratings = computeTrueSkillRatings(matches);
  return { matches, rankings: attachMuStd5(rankTrueSkillPlayers(ratings)) };
}
