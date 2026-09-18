/** Recomputed summaries can change while the original answers remain unchanged. */
export const ANALYSIS_ALGORITHM_VERSION = '2026-09-10.1';
export const ANALYSIS_NOTES = [
  'TrueSkill uses sequential decisive pairwise updates. Multiway choices/rankings are expanded into dependent pairs; rankings are exploratory, not significance tests.',
  'muStd5 is min-max scaling within the current question/sample; it is not a cross-study rating scale.',
  'Krippendorff alpha uses coincidence weighting for unequal coder counts; absent overlap or zero expected disagreement yields no alpha.',
  'Kendall W requires complete strict rankings of the same items. Borda and mean ranks with varying sets are descriptive within those sets.',
  'Video segments use half-open intervals with at most one contribution per response per bucket. Continuous ratings average within response/bucket before averaging across responses.',
  'Video response units may include repeated trials/submissions from a participant; they are not independent participant counts.',
  'budget_compliance_rate permits partial spending; budget_full_use_rate reports complete spending.',
];
