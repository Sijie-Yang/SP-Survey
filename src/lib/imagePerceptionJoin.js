import { surveyResponseContract } from './surveyRevision';
import { mediaIdentityKey, mediaDisplayName, resolveMediaAnswerKey } from './mediaIdentity';
/**
 * Join survey perception scores with image features (L0 / streetscape seg / SAM preannot).
 * Supports all image-like question types; multi-attribute questions require an attribute key.
 */
import { getMediaId, normalizeMediaEntry } from './mediaUtils';
import { featureStorageKey, getFeaturesMap, findFeatureRecord } from './imageFeaturesStore';
import { L0_MODEL } from './imageFeaturesL0';
import { SEG_MODEL } from './falInference';
import { SAM_PREANNOT_MODEL } from './imageFeaturesR2';
import {
  computeQuestionTrueSkill,
  computeForcedChoiceTrueSkill,
  computeMaxDiffTrueSkill,
  computeTrueSkillFromMatches,
  matchesFromOrderedRanking,
  attachMatchCategory,
  splitsTrueSkillByCategory,
} from './trueskill';
import { expandQuestionAnswerUnits } from './responseAnswerUnits';
import { isForcedChoiceSkill, isMaxDiffSkill } from './skillMediaUtils';

export { L0_MODEL, SEG_MODEL, SAM_PREANNOT_MODEL };

/** Types that produce a single perception score per image (no attribute picker). */
export const SINGLE_SCORE_TYPES = new Set([
  'imagepicker',
  'imagerating', 'image_rating',
  'imageboolean', 'image_boolean',
  'imageranking', 'image_ranking',
  'mediarating', 'mediaboolean', 'mediaranking',
]);

/** Types that need an attribute / dimension / row / label. */
export const MULTI_ATTR_TYPES = new Set([
  'imagematrix', 'image_matrix',
  'imageslidergroup',
  'imagepointallocation',
  'imageannotation',
]);

export const PERCEPTION_IMAGE_TYPES = new Set([
  ...SINGLE_SCORE_TYPES,
  ...MULTI_ATTR_TYPES,
]);

const ANNOTATION_COUNT_ATTR = '__count__';

function optionValue(opt) {
  if (opt == null) return null;
  if (typeof opt === 'string' || typeof opt === 'number') return String(opt);
  return String(opt.value ?? opt.text ?? opt.name ?? '');
}

function optionLabel(opt) {
  if (opt == null) return '';
  if (typeof opt === 'string' || typeof opt === 'number') return String(opt);
  return String(opt.text ?? opt.label ?? opt.value ?? opt.name ?? '');
}

function resolveImageChoiceKey(value, shownImages) {
  return resolveMediaAnswerKey(value, shownImages);
}

export function resolveMediaIdFromKey(keyOrUrl, pool = []) {
  if (!keyOrUrl) return null;
  const key = mediaIdentityKey(keyOrUrl);
  const exact = pool.filter((m) => getMediaId(m) === key || m.key === key || mediaIdentityKey(m.url) === key);
  if (exact.length === 1) return getMediaId(exact[0]);
  if (exact.length > 1) return null;
  if (!key.includes('/')) {
    const named = pool.filter((m) => m.name === key || mediaDisplayName(m.url) === key);
    if (named.length === 1) return getMediaId(named[0]);
    if (named.length > 1) return null;
  }
  return key; // Keep an unmatched historical identity visible, never guess a same-name image.
}

/** Resolve media_ids for a response question payload. */
export function resolveShownMediaIds(qData, pool = []) {
  if (Array.isArray(qData?.shown_media_ids) && qData.shown_media_ids.length) {
    return qData.shown_media_ids.filter(Boolean);
  }
  return (qData?.shown_images || []).map((entry) => resolveMediaIdFromKey(entry, pool)).filter(Boolean);
}

/** One payload per answered trial (or a single payload for non-trial questions). */
function extractAnswerPayloads(row, questionName) {
  return expandQuestionAnswerUnits(row, questionName, { requireAnswer: true }).map((u) => ({
    answer: u.answer,
    shown: u.shown_images,
    shownIds: u.shown_media_ids?.length ? u.shown_media_ids : null,
    shown_media_categories: u.shown_media_categories,
    trial_index: u.trial_index,
    qData: {
      answer: u.answer,
      shown_images: u.shown_images,
      shown_media_ids: u.shown_media_ids,
      shown_media_categories: u.shown_media_categories,
    },
  }));
}

function mediaIdsForTrial(payload, pool) {
  if (payload.shownIds?.length) return payload.shownIds.filter(Boolean);
  return resolveShownMediaIds(payload.qData, pool);
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = xs.reduce((sum, x) => sum + x, 0) / n;
  const my = ys.reduce((sum, y) => sum + y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const denominator = Math.sqrt(sxx) * Math.sqrt(syy);
  return denominator ? Math.max(-1, Math.min(1, sxy / denominator)) : null;
}

/** Regularized incomplete beta I_x(a,b) — enough for Student-t tails. */
function logGamma(z) {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.984369654078761e-6, 1.5056327351493116e-7,
  ];
  const z0 = z - 1;
  let x0 = c[0];
  for (let i = 1; i < g + 2; i += 1) x0 += c[i] / (z0 + i);
  const t0 = z0 + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z0 + 0.5) * Math.log(t0) - t0 + Math.log(x0);
}

function betai(a, b, x) {
  if (x < 0 || x > 1 || !(a > 0) || !(b > 0)) return null;
  if (x === 0 || x === 1) return x;
  const logBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const bt = Math.exp(-logBeta + a * Math.log(x) + b * Math.log1p(-x));
  const fraction = (aa, bb, xx) => {
    const tiny = 1e-300;
    const nonzero = (v) => Math.abs(v) < tiny ? (v < 0 ? -tiny : tiny) : v;
    const qab = aa + bb, qap = aa + 1, qam = aa - 1;
    let c = 1, d = 1 / nonzero(1 - qab * xx / qap), h = d;
    for (let m = 1; m <= 10000; m += 1) {
      const m2 = 2 * m;
      let coefficient = m * (bb - m) * xx / ((qam + m2) * (aa + m2));
      d = 1 / nonzero(1 + coefficient * d);
      c = nonzero(1 + coefficient / c); h *= d * c;
      coefficient = -(aa + m) * (qab + m) * xx / ((aa + m2) * (qap + m2));
      d = 1 / nonzero(1 + coefficient * d);
      c = nonzero(1 + coefficient / c);
      const delta = d * c; h *= delta;
      if (Math.abs(delta - 1) < 1e-14) return h;
    }
    return NaN;
  };
  return x < (a + 1) / (a + b + 2)
    ? bt * fraction(a, b, x) / a
    : 1 - bt * fraction(b, a, 1 - x) / b;
}

/** Two-sided null p-value, using the exact beta distribution of Pearson r. */
export function pearsonPValue(r, n) {
  if (!(n >= 3) || !Number.isFinite(r)) return null;
  if (Math.abs(r) >= 1) return 0;
  const p = betai((n - 2) / 2, 0.5, 1 - r * r);
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null;
}

/** Classic stars: *** p<.001, ** p<.01, * p<.05, · p<.1 */
export function significanceStars(p) {
  if (p == null || !Number.isFinite(p)) return '';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  if (p < 0.1) return '·';
  return '';
}

/** Numeric feature for a row; missing seg_ratio_* on seg-ready → 0. */
export function perceptionFeatureValue(row, key) {
  if (!row || !key) return null;
  const v = row[key];
  if (Number.isFinite(v)) return v;
  if (key.startsWith('seg_ratio_') && row.seg_status === 'ready') return 0;
  const samLabel = key.match(/^sam_(?:count|ratio|area_sum)_(.+)$/)?.[1];
  if (samLabel && row.sam_status === 'ready' && row.sam_feature_version === '2' && Object.prototype.hasOwnProperty.call(row.sam_label_dictionary || {}, samLabel)) return 0;
  return null;
}

function ensureMediaRow(byMedia, mediaId, pool) {
  if (!byMedia[mediaId]) {
    const hit = (pool || []).find((m) => getMediaId(m) === mediaId);
    byMedia[mediaId] = {
      mediaId,
      url: hit?.url || null,
      name: hit?.name || mediaId,
      scores: [],
    };
  }
  return byMedia[mediaId];
}

function finalizeMediaScores(byMedia, scoreKind) {
  return Object.values(byMedia).map((row) => {
    const mean = row.scores.length
      ? row.scores.reduce((a, b) => a + b, 0) / row.scores.length
      : null;
    return {
      ...row,
      meanScore: mean,
      n: row.scores.length,
      scoreKind,
    };
  });
}

/** Human-readable score kind for UI. */
export function scoreKindLabel(type, attributeId) {
  const t = String(type || '');
  if (
    t === 'imagepicker'
    || t === 'imageranking'
    || t === 'image_ranking'
    || t === 'mediaranking'
    || t === 'skillquestion'
  ) {
    return 'μ std (0–5)';
  }
  if (t === 'imagerating' || t === 'image_rating' || t === 'mediarating') return 'Mean rating';
  if (t === 'imageboolean' || t === 'image_boolean' || t === 'mediaboolean') return 'Yes rate (0–1)';
  if (t === 'imagematrix' || t === 'image_matrix') return attributeId ? `Matrix · ${attributeId}` : 'Matrix row score';
  if (t === 'imageslidergroup') return attributeId ? `Slider · ${attributeId}` : 'Slider score';
  if (t === 'imagepointallocation') return attributeId ? `Points · ${attributeId}` : 'Points';
  if (t === 'imageannotation') {
    return attributeId === ANNOTATION_COUNT_ATTR || !attributeId
      ? 'Annotation count'
      : `Label count · ${attributeId}`;
  }
  return 'Score';
}

/** Attributes for multi-score question types. */
export function listPerceptionAttributes(question) {
  if (!question) return [];
  const t = question.type;
  if (t === 'imagematrix' || t === 'image_matrix') {
    return (question.rows || []).map((r) => ({
      id: optionValue(r),
      label: optionLabel(r) || optionValue(r),
    })).filter((a) => a.id);
  }
  if (t === 'imageslidergroup') {
    return (question.dimensions || []).map((d) => ({
      id: String(d.id || d.value || d.label || ''),
      label: String(d.label || d.id || d.value || ''),
    })).filter((a) => a.id);
  }
  if (t === 'imagepointallocation') {
    return (question.choices || []).map((c) => ({
      id: optionValue(c),
      label: optionLabel(c) || optionValue(c),
    })).filter((a) => a.id);
  }
  if (t === 'imageannotation') {
    const labels = (question.annotationLabels || []).map((l) => String(l).trim()).filter(Boolean);
    return [
      { id: ANNOTATION_COUNT_ATTR, label: 'Total annotation count' },
      ...labels.map((l) => ({ id: l, label: `Count: ${l}` })),
    ];
  }
  return [];
}

/** Discover annotation labels from responses (when question has no predefined labels). */
export function discoverAnnotationLabels(responses, questionName) {
  const set = new Set();
  for (const row of responses || []) {
    for (const payload of extractAnswerPayloads(row, questionName)) {
      const shapes = payload?.answer?.shapes;
      if (!Array.isArray(shapes)) continue;
      shapes.forEach((s) => {
        const lab = String(s?.label || '').trim();
        if (lab) set.add(lab);
      });
    }
  }
  return [...set].sort();
}

function isPerceptionScoreQuestion(q) {
  if (!q?.name) return false;
  if (q.type === 'skillquestion') {
    return isForcedChoiceSkill(q.skillId) || isMaxDiffSkill(q.skillId);
  }
  return PERCEPTION_IMAGE_TYPES.has(q.type);
}

/** All image questions eligible for Image × Perception. */
export function listPerceptionScoreQuestions(questions, responses = null) {
  return (questions || [])
    .filter(isPerceptionScoreQuestion)
    .map((q) => {
      let attributes = listPerceptionAttributes(q);
      if (q.type === 'imageannotation' && responses) {
        const discovered = discoverAnnotationLabels(responses, q.name);
        const existing = new Set(attributes.map((a) => a.id));
        discovered.forEach((lab) => {
          if (!existing.has(lab)) {
            attributes = [...attributes, { id: lab, label: `Count: ${lab}` }];
          }
        });
      }
      return {
        name: q.name,
        title: q.title || q.name,
        type: q.type,
        attributes,
        needsAttribute: attributes.length > 0,
        scoreKind: scoreKindLabel(q.type, null),
      };
    });
}

/** @deprecated use listPerceptionScoreQuestions */
export function listPerceptionRatingQuestions(questions) {
  return listPerceptionScoreQuestions(questions).filter((q) => (
    q.type === 'imagerating' || q.type === 'image_rating'
  ));
}

function aggregateRatingLike(responses, questionName, pool, toScore) {
  const byMedia = {};
  for (const row of responses || []) {
    for (const payload of extractAnswerPayloads(row, questionName)) {
      const score = toScore(payload.answer);
      if (score == null || Number.isNaN(score)) continue;
      const ids = mediaIdsForTrial(payload, pool);
      if (ids.length === 1) ensureMediaRow(byMedia, ids[0], pool).scores.push(score);
    }
  }
  return byMedia;
}

function aggregateTrueSkillPicker(responses, questionName, pool, { mode = 'picker', question = null } = {}) {
  let rankings;
  if (mode === 'forcedChoice') {
    ({ rankings } = computeForcedChoiceTrueSkill(responses || [], questionName, question));
  } else if (mode === 'maxdiff') {
    ({ rankings } = computeMaxDiffTrueSkill(responses || [], questionName, question));
  } else {
    ({ rankings } = computeQuestionTrueSkill(responses || [], questionName, question));
  }
  return (rankings || []).map((r) => {
    const mediaId = resolveMediaIdFromKey(r.imageKey, pool);
    const hit = (pool || []).find((m) => getMediaId(m) === mediaId);
    return {
      mediaId,
      url: hit?.url || null,
      name: hit?.name || r.imageKey,
      scores: [r.muStd5],
      meanScore: r.muStd5,
      n: r.games || 0,
      scoreKind: 'mu_std5',
    };
  }).filter((r) => r.mediaId);
}

function aggregateTrueSkillRanking(responses, questionName, pool, question = null) {
  const allMatches = [];
  for (const row of responses || []) {
    for (const payload of extractAnswerPayloads(row, questionName)) {
      const ranked = Array.isArray(payload.answer) ? payload.answer : [];
      if (ranked.length < 2) continue;
      const keys = ranked
        .map((v) => resolveImageChoiceKey(v, payload.shown))
        .filter(Boolean);
      if (keys.length < 2) continue;
      allMatches.push(...attachMatchCategory(matchesFromOrderedRanking(keys), payload.shown_media_categories));
    }
  }
  const { rankings } = computeTrueSkillFromMatches(allMatches, {
    splitByCategory: splitsTrueSkillByCategory(question),
  });
  return (rankings || []).map((r) => {
    const mediaId = resolveMediaIdFromKey(r.imageKey, pool);
    const hit = (pool || []).find((m) => getMediaId(m) === mediaId);
    return {
      mediaId,
      url: hit?.url || null,
      name: hit?.name || r.imageKey,
      scores: [r.muStd5],
      meanScore: r.muStd5,
      n: r.games || 0,
      scoreKind: 'mu_std5',
    };
  }).filter((r) => r.mediaId);
}

function aggregateMatrixAttribute(responses, question, pool, attributeId) {
  const byMedia = {};
  const cols = (question.columns || []).map(optionValue);
  const numericCols = cols.length > 0 && cols.every((c) => c !== '' && !Number.isNaN(Number(c)));

  for (const row of responses || []) {
    for (const payload of extractAnswerPayloads(row, question.name)) {
      if (!payload.answer || typeof payload.answer !== 'object') continue;
      const colVal = payload.answer[attributeId];
      if (colVal == null || colVal === '') continue;
      let score = null;
      if (numericCols || !Number.isNaN(Number(colVal))) {
        score = Number(colVal);
        if (Number.isNaN(score)) continue;
      } else {
        continue; // non-numeric matrix columns: skip for correlation join
      }
      // Match ResultsAnalysis: attribute score to first shown image primarily
      const ids = mediaIdsForTrial(payload, pool);
      const mediaId = ids.length === 1 ? ids[0] : null;
      if (!mediaId) continue;
      ensureMediaRow(byMedia, mediaId, pool).scores.push(score);
    }
  }
  return finalizeMediaScores(byMedia, 'matrix_row');
}

function aggregateObjectAttribute(responses, questionName, pool, attributeId, scoreKind) {
  const byMedia = {};
  for (const row of responses || []) {
    for (const payload of extractAnswerPayloads(row, questionName)) {
      if (!payload.answer || typeof payload.answer !== 'object') continue;
      const raw = payload.answer[attributeId];
      if (raw == null || raw === '') continue;
      const score = Number(raw);
      if (!Number.isFinite(score)) continue;
      const ids = mediaIdsForTrial(payload, pool);
      if (ids.length === 1) ensureMediaRow(byMedia, ids[0], pool).scores.push(score);
    }
  }
  return finalizeMediaScores(byMedia, scoreKind);
}

function aggregateAnnotation(responses, questionName, pool, attributeId) {
  const byMedia = {};
  const attr = attributeId || ANNOTATION_COUNT_ATTR;
  for (const row of responses || []) {
    for (const payload of extractAnswerPayloads(row, questionName)) {
      const ans = payload.answer;
      const shapes = Array.isArray(ans?.shapes) ? ans.shapes : [];
      let score;
      if (attr === ANNOTATION_COUNT_ATTR) {
        score = shapes.length;
      } else {
        score = shapes.filter((s) => String(s?.label || '') === attr).length;
      }
      const imgRef = ans?.image || payload.shown?.[0];
      const mediaId = payload.shownIds?.[0] || (imgRef
        ? resolveMediaIdFromKey(imgRef, pool)
        : mediaIdsForTrial(payload, pool)[0]);
      if (!mediaId) continue;
      ensureMediaRow(byMedia, mediaId, pool).scores.push(score);
    }
  }
  return finalizeMediaScores(byMedia, attr === ANNOTATION_COUNT_ATTR ? 'annotation_count' : 'annotation_label_count');
}

/**
 * Aggregate per-media perception scores for one question (+ optional attribute).
 */
export function aggregatePerceptionByMedia(responses, question, pool = [], attributeId = null) {
  if (!question?.name) return [];
  const type = question.type;
  const name = question.name;

  if (type === 'imagepicker') {
    return aggregateTrueSkillPicker(responses, name, pool, { question });
  }
  if (type === 'skillquestion' && isForcedChoiceSkill(question.skillId)) {
    return aggregateTrueSkillPicker(responses, name, pool, { mode: 'forcedChoice', question });
  }
  if (type === 'skillquestion' && isMaxDiffSkill(question.skillId)) {
    return aggregateTrueSkillPicker(responses, name, pool, { mode: 'maxdiff', question });
  }
  if (type === 'imageranking' || type === 'image_ranking' || type === 'mediaranking') {
    return aggregateTrueSkillRanking(responses, name, pool, question);
  }
  if (type === 'imagerating' || type === 'image_rating' || type === 'mediarating') {
    return finalizeMediaScores(
      aggregateRatingLike(responses, name, pool, (a) => {
        if (a == null || a === '') return null;
        const n = Number(a);
        return Number.isFinite(n) ? n : null;
      }),
      'rating',
    );
  }
  if (type === 'imageboolean' || type === 'image_boolean' || type === 'mediaboolean') {
    return finalizeMediaScores(
      aggregateRatingLike(responses, name, pool, (a) => {
        if (a === true || a === 'true') return 1;
        if (a === false || a === 'false') return 0;
        return null;
      }),
      'yes_rate',
    );
  }
  if (type === 'imagematrix' || type === 'image_matrix') {
    if (!attributeId) return [];
    return aggregateMatrixAttribute(responses, question, pool, attributeId);
  }
  if (type === 'imageslidergroup') {
    if (!attributeId) return [];
    return aggregateObjectAttribute(responses, name, pool, attributeId, 'slider');
  }
  if (type === 'imagepointallocation') {
    if (!attributeId) return [];
    return aggregateObjectAttribute(responses, name, pool, attributeId, 'points');
  }
  if (type === 'imageannotation') {
    return aggregateAnnotation(responses, name, pool, attributeId || ANNOTATION_COUNT_ATTR);
  }
  return [];
}

/**
 * Wide join: one row per project media (plus any perception-only ids).
 * Feature map stores both media_id and name aliases — never enumerate raw map keys
 * or the same image is counted twice.
 */
export function buildImagePerceptionRows(
  project,
  responses,
  questions,
  featureMapOverride = null,
  questionName = null,
  attributeId = null,
) {
  const pool = (project?.preloadedImages || []).map(normalizeMediaEntry).filter(Boolean);
  const featureMap = featureMapOverride && typeof featureMapOverride === 'object'
    ? featureMapOverride
    : getFeaturesMap(project);

  const question = (questions || []).find((q) => q.name === questionName) || null;
  const needsAttr = question && listPerceptionAttributes(question).length > 0;
  const perception = question && (!needsAttr || attributeId)
    ? aggregatePerceptionByMedia(responses, question, pool, attributeId)
    : [];
  const perceptionById = Object.fromEntries(perception.map((p) => [p.mediaId, p]));

  const ids = new Set(pool.map((m) => getMediaId(m)).filter(Boolean));
  perception.forEach((p) => {
    if (p.mediaId) ids.add(p.mediaId);
  });

  const lookupFeature = (mediaId, hit, model) => {
    const entry = hit || { media_id: mediaId, name: mediaId };
    const safeEntry = pool.filter((m) => m.name === entry.name).length > 1 ? { ...entry, name: '' } : entry;
    return findFeatureRecord(featureMap, safeEntry, model)
      || featureMap[featureStorageKey(mediaId, model)]
      || null;
  };

  const rows = [];
  for (const mediaId of ids) {
    if (!mediaId) continue;
    const hit = pool.find((m) => getMediaId(m) === mediaId);
    const perc = perceptionById[mediaId];
    const l0 = lookupFeature(mediaId, hit, L0_MODEL);
    const seg = lookupFeature(mediaId, hit, SEG_MODEL);
    const sam = lookupFeature(mediaId, hit, SAM_PREANNOT_MODEL);
    rows.push({
      media_id: mediaId,
      name: hit?.name || perc?.name || mediaId,
      url: hit?.url || perc?.url || null,
      question_name: questionName || null,
      attribute_id: attributeId || null,
      score_kind: perc?.scoreKind || (question ? scoreKindLabel(question.type, attributeId) : null),
      mean_score: perc?.meanScore ?? null,
      n_ratings: perc?.n ?? 0,
      l0_status: l0?.status || (l0?.features ? 'ready' : 'missing'),
      seg_status: seg?.status || (seg?.features ? 'ready' : 'missing'),
      sam_status: sam?.status || (sam?.features ? 'ready' : 'missing'),
      media_matched: !!hit,
      media_folder: hit?.folder || '',
      sam_review_status: sam?.review_status || 'unknown',
      sam_feature_version: sam?.feature_version || 'legacy',
      sam_computed_at: sam?.computed_at || null,
      l0_computed_at: l0?.computed_at || null,
      seg_computed_at: seg?.computed_at || null,
      sam_label_dictionary: sam?.label_dictionary || {},
      ...(l0?.features || {}),
      ...(seg?.features || {}),
      ...(sam?.features || {}),
    });
  }
  return rows.sort((a, b) => (b.n_ratings || 0) - (a.n_ratings || 0));
}

export function featureKeyMatchesModelFilter(key, modelFilter = 'all') {
  if (!key) return false;
  if (modelFilter === 'l0') return !key.startsWith('seg_') && !key.startsWith('sam_');
  if (modelFilter === 'seg') return key.startsWith('seg_');
  if (modelFilter === 'sam') return key.startsWith('sam_');
  return true;
}

export function correlateFeaturesWithPerception(rows, modelFilter = 'all', method = 'pearson') {
  const scored = (rows || []).filter((r) => r.mean_score != null && r.n_ratings > 0);
  if (scored.length < 3) return [];
  const skip = new Set([
    'media_id', 'name', 'url', 'mean_score', 'n_ratings', 'question_name',
    'attribute_id', 'score_kind',
    'l0_status', 'seg_status', 'sam_status', 'seg_vocab',
  ]);
  const keys = new Set();
  scored.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (skip.has(k)) return;
      if (!featureKeyMatchesModelFilter(k, modelFilter)) return;
      if (typeof r[k] === 'number' && Number.isFinite(r[k])) keys.add(k);
    });
  });
  // Seg class ratios: missing key on a seg-ready image means that class is absent → 0,
  // not "exclude from correlation".
  const ys = scored.map((r) => r.mean_score);
  const correlations = [...keys]
    .map((key) => {
      const pairs = scored
        .map((r, i) => {
          const x = perceptionFeatureValue(r, key);
          return Number.isFinite(x) ? { x, y: ys[i] } : null;
        })
        .filter(Boolean);
      if (pairs.length < 3) return null;
      const xs = pairs.map((p) => p.x), pairedYs = pairs.map((p) => p.y);
      const r = method === 'spearman' ? pearson(averageRanks(xs), averageRanks(pairedYs)) : pearson(xs, pairedYs);
      if (r == null) return null;
      const p = pearsonPValue(r, pairs.length);
      return {
        feature: key,
        r,
        ci_low: method === 'pearson' && pairs.length > 3 && Math.abs(r) < 1 ? Math.tanh(Math.atanh(r) - 1.959963984540054 / Math.sqrt(pairs.length - 3)) : null,
        ci_high: method === 'pearson' && pairs.length > 3 && Math.abs(r) < 1 ? Math.tanh(Math.atanh(r) + 1.959963984540054 / Math.sqrt(pairs.length - 3)) : null,
        n: pairs.length,
        p,
        stars: significanceStars(p),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const adjusted = adjustFdr(correlations.map((c) => c.p));
  return correlations.map((c, i) => ({ ...c, method, p_adjusted: adjusted[i], stars: significanceStars(adjusted[i]) }));
}

export function averageRanks(values) {
  const sorted = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end].value === sorted[i].value) end += 1;
    for (let k = i; k < end; k += 1) ranks[sorted[k].i] = (i + 1 + end) / 2;
    i = end;
  }
  return ranks;
}

/** Benjamini–Hochberg across all features tested in the selected analysis. */
export function adjustFdr(values) {
  const sorted = values.map((p, i) => ({ p, i })).filter((v) => Number.isFinite(v.p)).sort((a, b) => a.p - b.p);
  const adjusted = values.map(() => null);
  let previous = 1;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    previous = Math.min(previous, sorted[i].p * sorted.length / (i + 1));
    adjusted[sorted[i].i] = previous;
  }
  return adjusted;
}

export function materializePerceptionRows(rows, modelFilter = 'all') {
  const featureKeys = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => typeof r[k] === 'number' && !['mean_score', 'n_ratings'].includes(k))))]
    .filter((k) => featureKeyMatchesModelFilter(k, modelFilter));
  return rows.map((row) => {
    const copy = { ...row };
    Object.keys(copy).forEach((key) => {
      if (typeof copy[key] === 'number' && !['mean_score', 'n_ratings'].includes(key) && !featureKeyMatchesModelFilter(key, modelFilter)) delete copy[key];
    });
    featureKeys.forEach((key) => { copy[key] = perceptionFeatureValue(row, key); });
    return copy;
  });
}

export function imagePerceptionCsv(rows, modelFilter = 'all') {
  const data = materializePerceptionRows(rows, modelFilter);
  const keys = [...new Set(data.flatMap((r) => Object.keys(r)))];
  const cell = (value) => {
    if (value == null) return '';
    let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value === 'string' && /^[=+@\-\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [keys.map(cell).join(','), ...data.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\n');
}

export function downloadPerceptionFile(contents, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportImagePerceptionCsv(rows, modelFilter = 'all') {
  if (rows?.length) downloadPerceptionFile(imagePerceptionCsv(rows, modelFilter), `image_x_perception_${Date.now()}.csv`, 'text/csv;charset=utf-8');
}

export function perceptionAnalysisSnapshot({ rows, modelFilter, method, reviewFilter, responses, question, attributeId, projectId }) {
  return {
    format: 'sp_annotation_perception_snapshot_v1', exported_at: new Date().toISOString(), project_id: projectId,
    question: question ? surveyResponseContract({ pages: [{ elements: [question] }] }).questions[0] : null, attribute_id: attributeId || null, model_filter: modelFilter, review_filter: reviewFilter,
    response_ids: responses.map((r) => r.id).filter(Boolean),
    questionnaire_revisions: [...new Set(responses.map((r) => r.survey_metadata?.survey_revision || 'historical_unknown'))],
    feature_source: 'Current annotation and feature records at export time; not frozen by questionnaire releases.',
    methods: {
      correlation: method, significance: method === 'pearson' ? 'Two-sided exact Pearson null beta distribution; Benjamini–Hochberg FDR across all tested features.' : 'Spearman asymptotic t approximation on average ranks; Benjamini–Hochberg FDR across all tested features. Small-sample inference is exploratory.',
      confidence_interval: method === 'pearson' ? '95% Fisher z interval for n > 3; undefined intervals are null.' : 'Not computed for rank correlation.',
      unit: 'One image; group-level ratings are excluded. Repeated participant/scene dependence is not modeled. Exploratory, not causal.',
      area: 'v2 ratio: union of annotation polygons and boxes; area_sum: sum including overlaps. Boxes represent box area, not segmented pixels.',
      missing: 'Missing segmentation classes are zero only on ready images. SAM zeros require a known label in v2 completed annotation records. Other missing values stay null.',
    },
    rows: materializePerceptionRows(rows, modelFilter), correlations: correlateFeaturesWithPerception(rows, modelFilter, method),
  };
}
