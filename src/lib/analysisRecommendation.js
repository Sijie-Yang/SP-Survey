/**
 * Template-level analysis recommendations stored in survey config as
 * `spAnalysisRecommendation`. Either one item or { citation, items: [...] }.
 * Item: { questions, method, tieHandling, runs, scale, minPerImage, reverseCoded,
 *         param, threshold, madThreshold, likedQuestion, dislikedQuestion,
 *         raterQuestion, groupBy, labels, citation }
 */

import { reverseCodedConditions } from './conditionVariants.js';

export const PAPER_REFERENCES = Object.freeze({
  trueskill: 'Herbrich, R., Minka, T., & Graepel, T. (2006). TrueSkill: A Bayesian skill rating system. NIPS.',
  qscore: 'Salesses, P., Schechtner, K., & Hidalgo, C. A. (2013). The collaborative image of the city. PLoS ONE, 8(7), e68400.',
  streetscore: 'Naik, N., Philipoom, J., Raskar, R., & Hidalgo, C. (2014). Streetscore. CVPR Workshops.',
  coverage: 'Gu, Y., et al. (2025). Designing effective image-based surveys for urban visual perception.',
  icc: 'McGraw, K. O., & Wong, S. P. (1996). Forming inferences about some intraclass correlation coefficients. Psychological Methods, 1(1), 30–46.',
  evaluative: 'Nasar, J. L. (1990). The evaluative image of the city. JAPA, 56(1), 41–53.',
});

export function normalizeRecommendation(surveyConfig) {
  const rec = surveyConfig?.spAnalysisRecommendation;
  if (!rec || typeof rec !== 'object') return { citation: null, items: [] };
  const items = Array.isArray(rec.items) ? rec.items : [rec];
  return {
    citation: rec.citation || null,
    items: items.filter((item) => item && typeof item === 'object' && item.method).map((item) => ({
      ...item,
      questions: Array.isArray(item.questions) ? item.questions : (item.questions ? [item.questions] : []),
      reverseCoded: Array.isArray(item.reverseCoded) ? item.reverseCoded : [],
      citation: item.citation || rec.citation || null,
    })),
  };
}

/** Recommendation items naming this question (or applying to all questions when none are listed). */
export function recommendationsForQuestion(surveyConfig, questionName) {
  return normalizeRecommendation(surveyConfig).items.filter((item) => !item.questions.length || item.questions.includes(questionName));
}

export function isReverseCoded(surveyConfig, question) {
  if (question?.reverseCoded === true) return true;
  return normalizeRecommendation(surveyConfig).items.some((item) => item.reverseCoded.includes(question?.name));
}

/** Reverse coding for analysis: a boolean, or a per-response predicate when only some conditions use reversed wording. */
export function reverseCodingFor(surveyConfig, question) {
  if (isReverseCoded(surveyConfig, question)) return true;
  const reversed = new Set(reverseCodedConditions(question));
  return reversed.size ? (row) => reversed.has(row?.survey_metadata?.condition) : false;
}

/** Questions pooled with this one after reverse-coding (e.g. "safe" and "less safe" framings). */
export function pooledQuestions(surveyConfig, questionName) {
  const item = normalizeRecommendation(surveyConfig).items.find((it) => it.pool && it.questions.includes(questionName));
  return item ? item.questions : [questionName];
}

export function questionLabel(surveyConfig, questionName) {
  for (const item of normalizeRecommendation(surveyConfig).items) {
    if (item.labels?.[questionName]) return item.labels[questionName];
  }
  return null;
}

const METHOD_TEXT = {
  qscore_pairwise: (it) => `Q-scores (Strength of Schedule; Salesses et al. 2013) on a 0–10 scale${it.minPerImage ? `, scoring images with at least ${it.minPerImage} comparisons` : ''}; ties counted in the denominator only`,
  trueskill_pairwise: (it) => `TrueSkill ratings${it.runs > 1 ? ` averaged over ${it.runs} seeded orderings` : ''}${it.tieHandling === 'draw' ? ', with ties treated as draws' : ', using decisive outcomes only'}${it.scale ? `, min–max scaled to ${it.scale.replace('-', '–')}` : ''}`,
  choice_share: (it) => `choice shares (times chosen ÷ times shown) with Wilson 95% intervals${it.threshold ? `; images chosen at least ${it.threshold} times were labelled positive` : ''}`,
  scalar_distribution: (it) => `per-image mean ratings${it.minPerImage ? ` (at least ${it.minPerImage} ratings per image)` : ''}`,
  slider_dimensions: () => 'per-image means for each slider dimension',
  matrix_rows: () => 'per-image means for each matrix row',
  robust_median: (it) => `per-image medians after removing ratings more than ${it.madThreshold || 3} × MAD from the image median`,
  rater_agreement: () => 'inter-rater agreement (two-way random, absolute-agreement ICC(2,1) and ICC(2,k))',
  param_aggregation: (it) => `means with 95% confidence intervals per ${it.param || 'site'}`,
  evaluative_map: () => 'a composite evaluative map (share of participants marking each area as liked minus disliked)',
  geographic_evaluative_map: () => 'a fixed-meter geographic evaluative grid (paired participants; explicit none counts, unanswered does not)',
  long_export: () => 'a long-format choice export (one row per comparison with participant covariates) for discrete choice models',
};

function questionsByName(surveyConfig) {
  const out = {};
  const walk = (els) => (els || []).forEach((e) => { if (e?.name) out[e.name] = e; walk(e?.elements); });
  (surveyConfig?.pages || []).forEach((p) => walk(p.elements));
  return out;
}

export function describeRecommendation(surveyConfig) {
  const { items } = normalizeRecommendation(surveyConfig);
  const byName = questionsByName(surveyConfig);
  const lines = items.map((it) => {
    const text = (METHOD_TEXT[it.method] || (() => it.method))(it);
    const qs = it.questions.length ? ` for ${it.questions.map((q) => `"${q}"`).join(', ')}` : '';
    const byCondition = it.questions.flatMap((q) => reverseCodedConditions(byName[q]).map((c) => `"${q}" under condition ${c}`));
    const rev = (it.reverseCoded.length ? ` Reverse-coded: ${it.reverseCoded.join(', ')}.` : '')
      + (byCondition.length ? ` Answers to the reversed wording were reverse-coded (${byCondition.join('; ')}) and pooled.` : '');
    const cite = it.citation ? ` (as in ${it.citation})` : '';
    return `Scores were derived as ${text}${qs}${cite}.${rev}`;
  });
  const refs = new Set(['trueskill']);
  items.forEach((it) => {
    if (it.method === 'qscore_pairwise') refs.add('qscore');
    if (it.minPerImage) refs.add('coverage');
    if (it.method === 'rater_agreement') refs.add('icc');
    if (it.method === 'evaluative_map') refs.add('evaluative');
  });
  return { lines, references: items.length ? [...refs].map((k) => PAPER_REFERENCES[k]) : [] };
}
