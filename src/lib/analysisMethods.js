import { ANALYSIS_ALGORITHM_VERSION, ANALYSIS_NOTES } from './analysisVersion.js';
import { exportFamilyForQuestion } from './questionSummaryExport.js';

const NOTE = (key) => ANALYSIS_NOTES.find((line) => line.toLowerCase().includes(key)) || null;

export const ANALYSIS_METHOD_CATALOG = Object.freeze([
  {
    id: 'scalar_distribution',
    families: ['scalar', 'image_rating'],
    charts: ['histogram', 'density'],
    metrics: ['n', 'mean', 'median', 'sd', 'min', 'max'],
    averageable: true,
    notes: 'Numeric ratings and counts only. Do not average IDs, ranks, or categorical codes.',
  },
  {
    id: 'slider_dimensions',
    families: ['slider', 'image_slider', 'pairwise_slider'],
    charts: ['dimension_histogram'],
    metrics: ['n', 'mean', 'median', 'sd'],
    averageable: true,
    notes: 'Analyze each dimension separately. Slider values are continuous within the declared scale.',
  },
  {
    id: 'choice_frequency',
    families: ['choice', 'boolean', 'image_boolean', 'image_checkbox'],
    charts: ['bar'],
    metrics: ['count', 'rate', 'denominator'],
    averageable: false,
    notes: 'Report frequencies with an explicit denominator. false and 0 are valid answers.',
  },
  {
    id: 'matrix_rows',
    families: ['matrix', 'image_matrix'],
    charts: ['matrix_bars'],
    metrics: ['count', 'rate', 'row_n'],
    averageable: false,
    notes: 'Summarize each row or dimension separately.',
  },
  {
    id: 'ranking_borda',
    families: ['ranking', 'image_ranking'],
    charts: ['rank_table'],
    metrics: ['avg_rank', 'borda', 'kendall_w'],
    averageable: false,
    notes: NOTE('kendall') || 'Borda and mean ranks are descriptive. Kendall W needs complete strict rankings.',
  },
  {
    id: 'trueskill_pairwise',
    families: ['imagepicker'],
    charts: ['trueskill_mu'],
    metrics: ['rank', 'mu', 'sigma', 'conservative', 'muStd5', 'wins', 'losses', 'shown', 'comparisons'],
    averageable: false,
    notes: NOTE('trueskill') || 'TrueSkill sequential pairwise updates. Ties do not update ratings.',
  },
  {
    id: 'trueskill_forced_choice',
    families: ['imagepicker'],
    skillFamilies: ['forced_choice'],
    charts: ['trueskill_mu'],
    metrics: ['rank', 'mu', 'sigma', 'conservative', 'muStd5', 'wins', 'losses', 'shown', 'comparisons'],
    averageable: false,
    notes: NOTE('trueskill'),
  },
  {
    id: 'trueskill_maxdiff',
    families: ['maxdiff'],
    charts: ['trueskill_mu', 'best_worst'],
    metrics: ['rank', 'mu', 'sigma', 'best_count', 'worst_count'],
    averageable: false,
    notes: 'Best–Worst expands into dependent pairs. Do not treat pair count as independent participants.',
  },
  {
    id: 'allocation_budget',
    families: ['points', 'image_points'],
    charts: ['allocation'],
    metrics: ['mean_share', 'budget_compliance_rate', 'budget_full_use_rate'],
    averageable: true,
    notes: NOTE('budget') || 'Allocation shares are within a budget; do not treat leftover points as missing data.',
  },
  {
    id: 'annotation_overlay',
    families: ['annotation'],
    charts: ['annotation_overlay'],
    metrics: ['n', 'shape_count'],
    averageable: false,
    notes: 'Reuse existing annotation overlays. Perception correlations stay an on-demand deep dive.',
  },
  {
    id: 'video_timeline',
    families: ['video_moments', 'continuous_video'],
    charts: ['video_timeline'],
    metrics: ['n', 'bucket_mean'],
    averageable: false,
    notes: NOTE('video') || 'Video units may include repeated trials from one participant.',
  },
  {
    id: 'text_inventory',
    families: ['text', 'emotion_color', 'composite_blocks', 'skill'],
    charts: ['text_list'],
    metrics: ['n_answered', 'n_empty'],
    averageable: false,
    notes: 'First version reports counts and a view entry. Theme induction is a separate sampled action.',
  },
]);

export function analysisFamilyForQuestion(question) {
  return exportFamilyForQuestion(question) || 'text';
}

export function methodsForQuestion(question) {
  const family = analysisFamilyForQuestion(question);
  const skillId = String(question?.skillId || '');
  return ANALYSIS_METHOD_CATALOG.filter((method) => {
    if (method.skillFamilies?.length) {
      if (skillId.includes('forced') || skillId.includes('pairwiseChoice') || skillId.includes('preset_forced')) {
        return method.id === 'trueskill_forced_choice';
      }
      if (skillId.includes('maxdiff') || skillId.includes('bestworst') || skillId.includes('bestWorst')) {
        return method.id === 'trueskill_maxdiff';
      }
    }
    return method.families.includes(family);
  });
}

export function defaultMethodForQuestion(question) {
  const methods = methodsForQuestion(question);
  if (!methods.length) return ANALYSIS_METHOD_CATALOG.find((item) => item.id === 'text_inventory');
  if (methods.some((item) => item.id.startsWith('trueskill'))) {
    return methods.find((item) => item.id.startsWith('trueskill'));
  }
  return methods[0];
}

export function methodCatalogPublic() {
  return ANALYSIS_METHOD_CATALOG.map((method) => ({
    ...method,
    algorithmVersion: ANALYSIS_ALGORITHM_VERSION,
  }));
}

export function methodNotApplicable(question, reason) {
  return {
    applicable: false,
    questionName: question?.name || null,
    family: analysisFamilyForQuestion(question),
    reason,
    algorithmVersion: ANALYSIS_ALGORITHM_VERSION,
  };
}
