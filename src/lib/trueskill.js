import { mediaIdentityKey, resolveMediaAnswerKey } from './mediaIdentity.js';
import { normalizeMediaAssignmentMode } from './mediaUtils.js';
import { isNoPreference } from './choiceTie.js';
/** TrueSkill-style 1v1 rating for imagepicker (any count, single or multi-select). */

import { expandQuestionAnswerUnits } from './responseAnswerUnits.js';

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

// Decisive win: t is winner minus loser. Unexpected wins must update more.
function v(t) {
  if (t < -8) {
    const x = -t;
    return x + 1 / x - 2 / x ** 3 + 10 / x ** 5;
  }
  return pdf(t) / cdf(t);
}

function wFactor(t) {
  const vv = v(t);
  return Math.min(1, Math.max(0, vv * (vv + t)));
}

function ensurePlayer(players, key) {
  if (!players.has(key)) {
    players.set(key, { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA, wins: 0, losses: 0, games: 0 });
  }
  return players.get(key);
}

export function filenameKey(val) { return mediaIdentityKey(val); }

export function categoryList(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return String(value).split('|').map((item) => item.trim()).filter(Boolean);
}

/** The trial's folder tag when exactly one category was shown. */
export function singleCategoryLabel(value) {
  const list = categoryList(value);
  return list.length === 1 ? list[0] : null;
}

/** One-category-per-trial sampling. Other modes keep a single ranking. */
export function splitsTrueSkillByCategory(question) {
  return normalizeMediaAssignmentMode(question?.mediaAssignmentMode) === 'category'
    && question?.mediaCategoryMode === 'single';
}

export function attachMatchCategory(matches, categories) {
  const category = singleCategoryLabel(categories);
  if (!category || !matches?.length) return matches || [];
  return matches.map((match) => ({ ...match, category }));
}

/**
 * Map imagepicker/mediapicker answer(s) to filename keys from the shown set.
 * Handles enriched filenames/URLs and legacy image_0 / media_0 indices.
 */
export function answerToSelectedKeys(answer, shownImages) {
  if (isNoPreference(answer)) return [];
  if (answer === null || answer === undefined || answer === '') return [];
  const shown = (shownImages || []).map((s) => (typeof s === 'string' ? s : s?.url || s?.name || ''));
  const shownKeys = shown.map(filenameKey);
  const values = Array.isArray(answer) ? answer : [answer];
  const selected = new Set();

  values.forEach((val) => {
    if (val === null || val === undefined || val === '') return;
    const str = String(val);
    const indexMatch = str.match(/^(?:image|media)_(\d+)$/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10);
      if (shownKeys[idx]) selected.add(shownKeys[idx]);
      return;
    }
    const resolved = resolveMediaAnswerKey(str, shown);
    if (resolved && (!shownKeys.length || shownKeys.includes(resolved))) selected.add(resolved);
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
 * Multi-trial responses contribute one match set per answered trial.
 */
export function extractPairwiseMatches(responses, questionName) {
  const matches = [];
  for (const row of responses) {
    const units = expandQuestionAnswerUnits(row, questionName, { requireAnswer: true });
    for (const unit of units) {
      matches.push(...attachMatchCategory(
        matchesFromImagePickerAnswer(unit.answer, unit.shown_images),
        unit.shown_media_categories,
      ));
    }
  }
  return matches;
}

/**
 * Run TrueSkill updates over all matches.
 */
export function computeTrueSkillRatings(matches) {
  const players = new Map();

  matches.forEach(({ winner, loser }) => {
    if (!winner || !loser || winner === loser) return;
    const winnerP = ensurePlayer(players, winner);
    const loserP = ensurePlayer(players, loser);

    const wSigma2 = winnerP.sigma ** 2 + TAU ** 2;
    const lSigma2 = loserP.sigma ** 2 + TAU ** 2;
    const c = Math.sqrt(2 * BETA * BETA + wSigma2 + lSigma2);
    const t = (winnerP.mu - loserP.mu) / c;
    const vw = v(t);
    const ww = wFactor(t);

    winnerP.mu += (wSigma2 / c) * vw;
    winnerP.sigma = Math.sqrt(Math.max(wSigma2 * (1 - (wSigma2 / (c * c)) * ww), 1e-6));
    loserP.mu -= (lSigma2 / c) * vw;
    loserP.sigma = Math.sqrt(Math.max(lSigma2 * (1 - (lSigma2 / (c * c)) * ww), 1e-6));

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

export function computeQuestionTrueSkill(responses, questionName, question = null) {
  const matches = extractPairwiseMatches(responses, questionName);
  return computeTrueSkillFromMatches(matches, { splitByCategory: splitsTrueSkillByCategory(question) });
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
 * Forced-choice A/B skill → pairwise TrueSkill matches (chosen image beats the other).
 * answer: { choice: 'A'|'B', chosenIndex?, imageA?, imageB?, chosenUrl?, shownUrls? }
 * shownImages: trial media list (preferred)
 */
export function matchesFromForcedChoiceAnswer(answer, shownImages) {
  if (isNoPreference(answer)) return [];
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return [];

  let rawShown = Array.isArray(shownImages) && shownImages.length ? shownImages : [];
  if (rawShown.length < 2) {
    const fromAnswer = [];
    if (answer.imageA) fromAnswer.push(answer.imageA);
    if (answer.imageB) fromAnswer.push(answer.imageB);
    if (Array.isArray(answer.shownUrls) && answer.shownUrls.length) {
      fromAnswer.push(...answer.shownUrls);
    }
    rawShown = fromAnswer;
  }
  const shownKeys = rawShown
    .map((s) => filenameKey(typeof s === 'string' ? s : s?.url || s?.name || ''))
    .filter(Boolean);
  if (shownKeys.length < 2) return [];

  let winnerIdx = answer.chosenIndex;
  if (winnerIdx == null) {
    if (answer.choice === 'A') winnerIdx = 0;
    else if (answer.choice === 'B') winnerIdx = 1;
  }
  if (
    (winnerIdx == null || winnerIdx < 0 || winnerIdx >= shownKeys.length)
    && answer.chosenUrl
  ) {
    const fk = filenameKey(answer.chosenUrl);
    const byUrl = shownKeys.findIndex((k) => k === fk);
    if (byUrl >= 0) winnerIdx = byUrl;
  }
  if (winnerIdx == null || winnerIdx < 0 || winnerIdx >= shownKeys.length) return [];

  const winner = shownKeys[winnerIdx];
  if (!winner) return [];
  const matches = [];
  shownKeys.forEach((key) => {
    if (key && key !== winner) matches.push({ winner, loser: key });
  });
  return matches;
}

/**
 * Extract all pairwise outcomes from Forced-Choice A/B skill responses.
 */
export function extractForcedChoiceMatches(responses, questionName) {
  const matches = [];
  for (const row of responses) {
    const units = expandQuestionAnswerUnits(row, questionName, { requireAnswer: true });
    for (const unit of units) {
      matches.push(...attachMatchCategory(
        matchesFromForcedChoiceAnswer(unit.answer, unit.shown_images),
        unit.shown_media_categories,
      ));
    }
  }
  return matches;
}

export function computeForcedChoiceTrueSkill(responses, questionName, question = null) {
  const matches = extractForcedChoiceMatches(responses, questionName);
  return computeTrueSkillFromMatches(matches, { splitByCategory: splitsTrueSkillByCategory(question) });
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

/** Extract all MaxDiff / Best–Worst pairwise outcomes from responses. */
export function extractMaxDiffMatches(responses, questionName) {
  const matches = [];
  for (const row of responses) {
    const units = expandQuestionAnswerUnits(row, questionName, { requireAnswer: true });
    for (const unit of units) {
      matches.push(...attachMatchCategory(
        matchesFromMaxDiffAnswer(unit.answer, unit.shown_images),
        unit.shown_media_categories,
      ));
    }
  }
  return matches;
}

export function computeMaxDiffTrueSkill(responses, questionName, question = null) {
  const matches = extractMaxDiffMatches(responses, questionName);
  return computeTrueSkillFromMatches(matches, { splitByCategory: splitsTrueSkillByCategory(question) });
}

function categoryBoardsFromMatches(matches) {
  const groups = new Map();
  for (const match of matches) {
    const key = match?.category || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (!a && b) return 1;
      if (a && !b) return -1;
      return String(a).localeCompare(String(b));
    })
    .map(([category, groupMatches]) => {
      const label = category || 'Uncategorized';
      const ratings = computeTrueSkillRatings(groupMatches);
      const rankings = attachMuStd5(rankTrueSkillPlayers(ratings)).map((row) => ({
        ...row,
        category: category || null,
        categoryLabel: label,
      }));
      return {
        category: category || null,
        label,
        matches: groupMatches,
        rankings,
      };
    });
}

/**
 * Run TrueSkill on { winner, loser } matches.
 * splitByCategory fits each one-category trial group on its own scale.
 * Rank and muStd5 are min-maxed inside that group. Matches with no category
 * stay one pooled ranking when every match is unlabeled.
 */
export function computeTrueSkillFromMatches(matches, { splitByCategory = false } = {}) {
  if (!matches?.length) return { matches: [], rankings: [], splitByCategory: false, categories: [] };
  const canSplit = splitByCategory && matches.some((match) => match?.category);
  if (!canSplit) {
    const ratings = computeTrueSkillRatings(matches);
    return {
      matches,
      rankings: attachMuStd5(rankTrueSkillPlayers(ratings)),
      splitByCategory: false,
      categories: [],
    };
  }
  const categories = categoryBoardsFromMatches(matches);
  return {
    matches,
    rankings: categories.flatMap((board) => board.rankings),
    splitByCategory: true,
    categories,
  };
}

/** One board per category when split, otherwise the single ranking. */
export function trueSkillBoards(result) {
  if (result?.splitByCategory && result.categories?.length) return result.categories;
  return [{
    category: null,
    label: null,
    matches: result?.matches || [],
    rankings: result?.rankings || [],
  }];
}
