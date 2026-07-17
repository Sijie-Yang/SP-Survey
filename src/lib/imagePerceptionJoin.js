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
  computeTrueSkillFromMatches,
  matchesFromOrderedRanking,
  filenameKey,
} from './trueskill';
import { expandQuestionAnswerUnits } from './responseAnswerUnits';

export { L0_MODEL, SEG_MODEL, SAM_PREANNOT_MODEL };

/** Types that produce a single perception score per image (no attribute picker). */
export const SINGLE_SCORE_TYPES = new Set([
  'imagepicker',
  'imagerating', 'image_rating',
  'imageboolean', 'image_boolean',
  'imageranking', 'image_ranking',
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

/** Media-* question types are not supported in Image × Perception yet. */
function isMediaQuestionType(type) {
  return typeof type === 'string' && type.startsWith('media');
}

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

function imageKeyFromShown(entry) {
  if (!entry) return '';
  const s = typeof entry === 'string' ? entry : (entry.url || entry.name || '');
  return s.split('?')[0].split('/').pop() || s;
}

function resolveImageChoiceKey(value, shownImages) {
  if (value == null || value === '') return '';
  const str = String(value);
  const match = str.match(/^image_(\d+)$/);
  if (match && Array.isArray(shownImages) && shownImages.length) {
    const img = shownImages[Number(match[1])];
    if (img != null) return imageKeyFromShown(img) || String(img);
  }
  return imageKeyFromShown(str) || str;
}

function resolveMediaIdFromKey(keyOrUrl, pool = []) {
  if (!keyOrUrl) return null;
  const key = filenameKey(String(keyOrUrl));
  const hit = (pool || []).find((m) => {
    const id = getMediaId(m);
    return id === keyOrUrl || id === key
      || m.name === key || m.key === key
      || filenameKey(m.url || '') === key;
  });
  return hit ? getMediaId(hit) : key;
}

/** Resolve media_ids for a response question payload. */
export function resolveShownMediaIds(qData, pool = []) {
  if (Array.isArray(qData?.shown_media_ids) && qData.shown_media_ids.length) {
    return qData.shown_media_ids.filter(Boolean);
  }
  const shown = qData?.shown_images || [];
  return shown.map((u) => {
    if (!u) return null;
    const hit = (pool || []).find((img) => img.url === u || img.name === u || img.key === u || img.media_id === u);
    return hit ? getMediaId(hit) : String(u).split('?')[0].split('/').pop() || u;
  }).filter(Boolean);
}

/** One payload per answered trial (or a single payload for non-trial questions). */
function extractAnswerPayloads(row, questionName) {
  return expandQuestionAnswerUnits(row, questionName, { requireAnswer: true }).map((u) => ({
    answer: u.answer,
    shown: u.shown_images,
    shownIds: u.shown_media_ids?.length ? u.shown_media_ids : null,
    trial_index: u.trial_index,
    qData: {
      answer: u.answer,
      shown_images: u.shown_images,
      shown_media_ids: u.shown_media_ids,
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
  let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!den) return null;
  return num / den;
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
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const bt = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  const contFrac = (aa, bb, xx) => {
    const maxIt = 200;
    const eps = 3e-7;
    let am = 1;
    let bm = 1;
    let az = 1;
    const qab = aa + bb;
    const qap = aa + 1;
    const qam = aa - 1;
    let bz = 1 - (qab * xx) / qap;
    for (let m = 1; m <= maxIt; m += 1) {
      const em = m;
      const tem = em + em;
      let d = (em * (bb - em) * xx) / ((qam + tem) * (aa + tem));
      const ap = az + d * am;
      const bp = bz + d * bm;
      d = -((aa + em) * (qab + em) * xx) / ((aa + tem) * (qap + tem));
      const app = ap + d * az;
      const bpp = bp + d * bz;
      const aold = az;
      am = ap / bpp;
      bm = bp / bpp;
      az = app / bpp;
      bz = 1;
      if (Math.abs(az - aold) < eps * Math.abs(az)) return az;
    }
    return az;
  };
  if (x < (a + 1) / (a + b + 2)) return (bt * contFrac(a, b, x)) / a;
  return 1 - (bt * contFrac(b, a, 1 - x)) / b;
}

/** Complementary error function (Abramowitz & Stegun 7.1.26). */
function erfc(x) {
  if (typeof Math.erfc === 'function') return Math.erfc(x);
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans = t * Math.exp(
    -z * z
    - 1.26551223
    + t * (1.00002368
      + t * (0.37409196
        + t * (0.09678418
          + t * (-0.18628806
            + t * (0.27886807
              + t * (-1.13520398
                + t * (1.48851587
                  + t * (-0.82215223
                    + t * 0.17087277)))))))),
  );
  return x >= 0 ? ans : 2 - ans;
}

/** Two-tailed p-value for Pearson r (H0: ρ=0). */
export function pearsonPValue(r, n) {
  if (!(n >= 3) || !Number.isFinite(r)) return null;
  if (Math.abs(r) >= 1) return 0;
  const df = n - 2;
  const t = Math.abs(r) * Math.sqrt(df / (1 - r * r));
  if (!Number.isFinite(t)) return null;
  // Incomplete beta is unstable for large df; use normal approx (t ≈ Z).
  if (df > 60) {
    return Math.min(1, Math.max(0, erfc(t / Math.SQRT2)));
  }
  const x = df / (df + t * t);
  const p = betai(df / 2, 0.5, x);
  if (p == null || !Number.isFinite(p)) {
    return Math.min(1, Math.max(0, erfc(t / Math.SQRT2)));
  }
  return Math.min(1, Math.max(0, p));
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
  if (t === 'imagepicker' || t === 'imageranking' || t === 'image_ranking' || t === 'mediaranking') {
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

/** All image questions eligible for Image × Perception. */
export function listPerceptionScoreQuestions(questions, responses = null) {
  return (questions || [])
    .filter((q) => q?.name && PERCEPTION_IMAGE_TYPES.has(q.type) && !isMediaQuestionType(q.type))
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
      ids.forEach((mediaId) => {
        ensureMediaRow(byMedia, mediaId, pool).scores.push(score);
      });
    }
  }
  return byMedia;
}

function aggregateTrueSkillPicker(responses, questionName, pool) {
  const { rankings } = computeQuestionTrueSkill(responses || [], questionName);
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

function aggregateTrueSkillRanking(responses, questionName, pool) {
  const allMatches = [];
  for (const row of responses || []) {
    for (const payload of extractAnswerPayloads(row, questionName)) {
      const ranked = Array.isArray(payload.answer) ? payload.answer : [];
      if (ranked.length < 2) continue;
      const keys = ranked
        .map((v) => resolveImageChoiceKey(v, payload.shown))
        .filter(Boolean);
      if (keys.length < 2) continue;
      allMatches.push(...matchesFromOrderedRanking(keys));
    }
  }
  const { rankings } = computeTrueSkillFromMatches(allMatches);
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
      const mediaId = ids[0];
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
      const score = Number(raw);
      if (Number.isNaN(score)) continue;
      const ids = mediaIdsForTrial(payload, pool);
      ids.forEach((mediaId) => {
        ensureMediaRow(byMedia, mediaId, pool).scores.push(score);
      });
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
      const mediaId = imgRef
        ? resolveMediaIdFromKey(imgRef, pool)
        : mediaIdsForTrial(payload, pool)[0];
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
    return aggregateTrueSkillPicker(responses, name, pool);
  }
  if (type === 'imageranking' || type === 'image_ranking' || type === 'mediaranking') {
    return aggregateTrueSkillRanking(responses, name, pool);
  }
  if (type === 'imagerating' || type === 'image_rating' || type === 'mediarating') {
    return finalizeMediaScores(
      aggregateRatingLike(responses, name, pool, (a) => {
        const n = Number(a);
        return Number.isNaN(n) ? null : n;
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
    return findFeatureRecord(featureMap, entry, model)
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

export function correlateFeaturesWithPerception(rows, modelFilter = 'all') {
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
  return [...keys]
    .map((key) => {
      const pairs = scored
        .map((r, i) => {
          const x = perceptionFeatureValue(r, key);
          return Number.isFinite(x) ? { x, y: ys[i] } : null;
        })
        .filter(Boolean);
      if (pairs.length < 3) return null;
      const r = pearson(pairs.map((p) => p.x), pairs.map((p) => p.y));
      if (r == null) return null;
      const p = pearsonPValue(r, pairs.length);
      return {
        feature: key,
        r,
        n: pairs.length,
        p,
        stars: significanceStars(p),
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export function exportImagePerceptionCsv(rows) {
  if (!rows?.length) return;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = keys.join(',');
  const lines = rows.map((r) => keys.map((k) => {
    const v = r[k];
    if (v == null) return '';
    if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `image_x_perception_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
