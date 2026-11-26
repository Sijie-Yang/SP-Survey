/** Recomputed summaries can change while the original answers remain unchanged. */
export const ANALYSIS_ALGORITHM_VERSION = '2026-10-02.1';
export const ANALYSIS_NOTES = [
  'TrueSkill uses sequential decisive pairwise updates. Multiway choices/rankings are expanded into dependent pairs; rankings are exploratory, not significance tests.',
  'muStd5 is min-max scaling within the current question/sample; it is not a cross-study rating scale.',
  'When a question samples one category per trial, TrueSkill, Q-score and choice share are each fit separately per category. Rank and the within-category scale stay inside that category. Other sampling modes keep one ranking.',
  'Krippendorff alpha uses coincidence weighting for unequal coder counts; absent overlap or zero expected disagreement yields no alpha.',
  'Kendall W requires complete strict rankings of the same items. Borda and mean ranks with varying sets are descriptive within those sets.',
  'Video segments use half-open intervals with at most one contribution per response per bucket. Continuous ratings average within response/bucket before averaging across responses.',
  'Video response units may include repeated trials/submissions from a participant; they are not independent participant counts.',
  'budget_compliance_rate permits partial spending; budget_full_use_rate reports complete spending.',
  'Q-score follows Salesses et al. (2013): ties enter the denominator only, and images below the minimum comparison count are not scored. The comparison chart starts on decisive TrueSkill; Q-score, draws, extra runs and min–max scaling are selected on that same chart. Tie-aware TrueSkill treats ties as draws; order-averaged TrueSkill refits on seeded permutations. Min–max scaling is sample-relative.',
  'Rater agreement uses two-way random, absolute-agreement ICC(2,1) and ICC(2,k) on the largest complete stimulus × rater matrix; median aggregation can screen ratings beyond k × MAD from the image median.',
  'Reverse-coded pairwise questions count the chosen image as the loser before scoring. Condition and subgroup comparisons report between-group Spearman correlations of image scores and Welch tests on participant-level agreement with the pooled ranking.',
];
