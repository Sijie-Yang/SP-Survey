/**
 * Platform reference pack for AI skill authors.
 * Describes how each resultSchema type is analyzed and exported natively,
 * so GPT/Codex skills match platform conventions without a custom result layer.
 */

import {
  NATIVE_SKILL_RESULT_TYPE_IDS,
  SKILL_RESULT_TYPES,
  skillResultTypesCatalogText,
} from '../skillResultTypes';

export const SKILL_ANALYSIS_VISUAL_CONVENTIONS = [
  'Tabs per stimulus (imageUrl / shown_images) when multiple media items appear.',
  'Show n= response counts; prefer mean ± SD for numeric aggregates.',
  'Use plain HTML/CSS/JS only — no external CDNs, no network fetches.',
  'Labels should work in English; Chinese optional via simple locale sniff.',
  'Keep layout compact; report height via parent postMessage {source:"sp-survey-skill", type:"height", px}.',
  'Do not create a Skill-authored analysis view; the matched native Results Analysis component is authoritative.',
];

/** Per-type analysis + export conventions mirroring native question types. */
export const SKILL_TYPE_ANALYSIS_GUIDE = {
  number: {
    shape: SKILL_RESULT_TYPES.number.shape,
    analysis: 'Histogram + mean/median/SD (same as rating / numeric).',
    longExport: 'One row per response: value=<number>',
    summaryExport: 'mean, sd, min, max, n',
    exampleLong: { value: 72 },
  },
  rating: {
    shape: SKILL_RESULT_TYPES.rating.shape,
    analysis: 'Native rating distribution; with media, mean rating by stimulus.',
    longExport: 'One row per response/trial: value=<rating>',
    summaryExport: 'mean, sd, median, min, max, count',
    exampleLong: { value: 4 },
  },
  boolean: {
    shape: SKILL_RESULT_TYPES.boolean.shape,
    analysis: 'Yes/No frequency bars.',
    longExport: 'One row: value=true|false',
    summaryExport: 'yes_count, no_count, yes_pct',
    exampleLong: { value: true },
  },
  choice: {
    shape: SKILL_RESULT_TYPES.choice.shape,
    analysis: 'Choice frequency bars (same as radiogroup).',
    longExport: 'One row: value=<choice>',
    summaryExport: 'per-choice count + pct',
    exampleLong: { value: 'park' },
  },
  text: {
    shape: SKILL_RESULT_TYPES.text.shape,
    analysis: 'Scrollable text answer list.',
    longExport: 'One row: value=<text>',
    summaryExport: 'n_nonempty',
    exampleLong: { value: 'busy sidewalk' },
  },
  count: {
    shape: SKILL_RESULT_TYPES.count.shape,
    analysis: 'Total / mean count (array length or number).',
    longExport: 'One row: value=<count>',
    summaryExport: 'mean_count, total',
    exampleLong: { value: 3 },
  },
  color: {
    shape: SKILL_RESULT_TYPES.color.shape,
    analysis: 'Emotion-color distribution (same module as the color preset).',
    longExport: 'One row: hex, hue/intensity/option when available',
    summaryExport: 'color/hue/intensity metrics',
    exampleLong: { value: '#4A90D9' },
  },
  scaleGroup: {
    shape: SKILL_RESULT_TYPES.scaleGroup.shape,
    analysis: 'Per-dimension average bars (semantic differential / slider group).',
    longExport: 'One row per dimension: attribute=<key>, value=<number>',
    summaryExport: 'per-dimension mean ± SD',
    exampleLong: { attribute: 'pleasant', value: 68 },
  },
  points: {
    shape: SKILL_RESULT_TYPES.points.shape,
    analysis: 'ANNOTATION family — density / point overlay on stimulus; tabs per image (same as imageannotation point tool).',
    longExport: 'One row per point: x, y, label (optional), image_url',
    summaryExport: 'per-image label_count; total points',
    exampleLong: { x: 0.42, y: 0.31, label: 'entrance', image_url: 'https://…/scene.jpg' },
  },
  path: {
    shape: SKILL_RESULT_TYPES.path.shape,
    analysis: 'ANNOTATION family — polyline overlay + length/directness (imageannotation line tool).',
    longExport: 'One row per vertex: x, y, t (optional), seq, image_url',
    summaryExport: 'mean path length, mean directness, n',
    exampleLong: { x: 0.1, y: 0.8, t: 0, seq: 0, image_url: 'https://…/scene.jpg' },
  },
  polygon: {
    shape: SKILL_RESULT_TYPES.polygon.shape,
    analysis: 'ANNOTATION family — closed region overlay (imageannotation polygon tool).',
    longExport: 'One row per vertex: x, y, seq, label, image_url',
    summaryExport: 'per-image polygon_count / label_count',
    exampleLong: { x: 0.2, y: 0.3, seq: 0, label: 'plaza', image_url: 'https://…/scene.jpg' },
  },
  bbox: {
    shape: SKILL_RESULT_TYPES.bbox.shape,
    analysis: 'ANNOTATION family — bounding box overlay (imageannotation bbox/box tool). Alias type: box.',
    longExport: 'One row per corner: x, y, seq (0|1), label, image_url',
    summaryExport: 'per-image bbox_count / label_count',
    exampleLong: { x: 0.1, y: 0.2, seq: 0, label: 'sign', image_url: 'https://…/scene.jpg' },
  },
  allocation: {
    shape: SKILL_RESULT_TYPES.allocation.shape,
    analysis: 'Mean bars per budget item (same as point-allocation).',
    longExport: 'One row per item: choice_key, choice_label, points',
    summaryExport: 'per-item mean points, n',
    exampleLong: { choice_key: 'trees', choice_label: 'Trees', points: 40 },
  },
  rankedList: {
    shape: SKILL_RESULT_TYPES.rankedList.shape,
    analysis: 'Ranking distribution + Borda scores (same as ranking questions).',
    longExport: 'One row per rank position: rank (1-based), option, value=pipe-joined full order',
    summaryExport: 'avg_rank, borda, count per option; kendall_w when enough raters',
    exampleLong: { rank: 1, option: 'Scene A', value: 'Scene A|Scene B|Scene C' },
  },
  multiChoice: {
    shape: SKILL_RESULT_TYPES.multiChoice.shape,
    analysis: 'Text-only → checkbox frequency. With imageUrl/media → imagecheckbox select_rate by stimulus × tag.',
    longExport: 'One row per selected option: value/label (+ shown_* when media)',
    summaryExport: 'choice_count / select_rate per option (per stimulus when media)',
    exampleLong: { option: 'trees' },
  },
  matrix: {
    shape: SKILL_RESULT_TYPES.matrix.shape,
    analysis: 'Matrix cell frequency (same as matrix / imagematrix).',
    longExport: 'One row per cell: choice_key=row, option=column, points=optional numeric',
    summaryExport: 'cell_count per row×column',
    exampleLong: { choice_key: 'comfort', option: 'agree', points: '' },
  },
  mediaMatrix: {
    shape: SKILL_RESULT_TYPES.mediaMatrix.shape,
    analysis: 'Native image/media matrix tabs by stimulus and attribute.',
    longExport: 'One row per stimulus × matrix cell',
    summaryExport: 'per-stimulus attribute percentages or numeric stats',
    exampleLong: { choice_key: 'comfort', option: 'agree', image_url: 'https://…/scene.jpg' },
  },
  mediaChoice: {
    shape: SKILL_RESULT_TYPES.mediaChoice.shape,
    analysis: 'Media pick frequency with thumbnails (imagepicker / mediapicker).',
    longExport: 'One row: option=<media key/url>',
    summaryExport: 'choice_count per media',
    exampleLong: { option: 'scene_a.jpg' },
  },
  mediaRankedList: {
    shape: SKILL_RESULT_TYPES.mediaRankedList.shape,
    analysis: 'Media ranking + Borda (imageranking / mediaranking).',
    longExport: 'One row per rank: rank, option=<media key>, value=pipe-joined order',
    summaryExport: 'avg_rank, borda per media',
    exampleLong: { rank: 1, option: 'scene_a.jpg', value: 'scene_a.jpg|scene_b.jpg' },
  },
  timeRanges: {
    shape: SKILL_RESULT_TYPES.timeRanges.shape,
    analysis: 'Video moment timeline density (video-moments preset).',
    longExport: 'One row per segment: x=start, y=end, label?, seq',
    summaryExport: 'segment_count, mean seg_duration per video',
    exampleLong: { x: 12.5, y: 18.0, label: 'peak', seq: 0 },
  },
  timeSeries: {
    shape: SKILL_RESULT_TYPES.timeSeries.shape,
    analysis: 'Continuous video rating mean±SD timeline (continuous-rating preset).',
    longExport: 'One row per sample: x=t, y=v (or points=v)',
    summaryExport: 'mean/sd of sample values per video',
    exampleLong: { x: 5, y: 62, seq: 5 },
  },
  pairwise: {
    shape: SKILL_RESULT_TYPES.pairwise.shape,
    analysis: 'Pairwise preference histogram + per-image score (A/B preset).',
    longExport: 'One row: value=preference (−100…+100), option=imageA|imageB',
    summaryExport: 'mean preference; hard_count via answer_json when present',
    exampleLong: { value: 35, option: 'a.jpg|b.jpg' },
  },
  pairwiseChoice: {
    shape: SKILL_RESULT_TYPES.pairwiseChoice.shape,
    analysis: 'Forced-choice outcomes + TrueSkill.',
    longExport: 'winner/loser pair per trial',
    summaryExport: 'TrueSkill mu/sigma/rank/wins/losses',
  },
  pairwisePreference: {
    shape: SKILL_RESULT_TYPES.pairwisePreference.shape,
    analysis: 'Continuous A/B preference distribution.',
    longExport: 'One row with numeric preference',
    summaryExport: 'mean/sd preference by pair/media',
  },
  bestWorst: {
    shape: SKILL_RESULT_TYPES.bestWorst.shape,
    analysis: 'MaxDiff BWS + TrueSkill (best-worst preset).',
    longExport: 'One row: option=best, choice_key=worst',
    summaryExport: 'best_count / worst_count per option',
    exampleLong: { option: 'scene_a.jpg', choice_key: 'scene_c.jpg', value: 'best' },
  },
  compositeBlocks: {
    shape: SKILL_RESULT_TYPES.compositeBlocks.shape,
    analysis: 'Composite attribute tabs (ratings, word frequency, choice frequency, and text).',
    longExport: 'One row per rating dimension with choice/words/text repeated',
    summaryExport: 'per-dimension media stats plus choice/word/text summaries',
    exampleLong: { value: 5, option: 'visit', label: 'safe' },
  },
};

/**
 * Full prompt / MCP text: catalog + per-type analysis/export + visual conventions.
 */
export function buildSkillAnalysisGuideText() {
  const lines = [
    'HOW TO PICK resultSchema[].type (YOU must decide — do not default everything to text):',
    '1) ANNOTATION / drawing on a scene → points | path | polygon | bbox (alias box). Always imageUrl.',
    '2) Rating scale → rating. Free numeric measurement/count → number/count. Add imageUrl for native media rating.',
    '3) Picker / ranking of media → mediaChoice | mediaRankedList (imagepicker / imageranking).',
    '4) Text checkbox multi-select (no stimulus) → multiChoice. Stimulus + text tags → prefer native imagecheckbox/mediacheckbox, or multiChoice+imageUrl. Matrix → matrix; stimulus matrix → mediaMatrix. Text ranking → rankedList.',
    '5) Budget split → allocation. Forced A/B → pairwiseChoice. A/B slider → pairwisePreference. MaxDiff → bestWorst.',
    '6) Video key moments → timeRanges. Continuous video rating → timeSeries.',
    '7) Color response → color. Combined ratings/words/choice/text block → compositeBlocks.',
    '8) Free text → text. If a result cannot map exactly to a listed native family, redesign the answer shape; do not use json.',
    '',
    'RESULT SCHEMA TYPE CATALOG:',
    skillResultTypesCatalogText({ nativeOnly: true }),
    '',
    'PLATFORM ANALYSIS + EXPORT CONVENTIONS BY TYPE:',
  ];
  for (const [id, g] of Object.entries(SKILL_TYPE_ANALYSIS_GUIDE)) {
    if (!NATIVE_SKILL_RESULT_TYPE_IDS.includes(id)) continue;
    lines.push(
      `• ${id} — shape: ${g.shape}`,
      `  analysis: ${g.analysis}`,
      `  long CSV: ${g.longExport}`,
      `  summary: ${g.summaryExport}`,
      `  example: ${JSON.stringify(g.exampleLong)}`,
    );
  }
  lines.push('', 'VISUAL CONVENTIONS FOR THE INTERACTIVE SKILL QUESTION ONLY:');
  for (const c of SKILL_ANALYSIS_VISUAL_CONVENTIONS) {
    lines.push(`- ${c}`);
  }
  lines.push(
    '',
    'Never emit string-only resultSchema keys. Always objects with key+label+type.',
    'A new Skill revision MUST declare exactly one resultSchema field, so its analysis and export are identical to one native family. Use compositeBlocks or separate Skills when appropriate.',
    'Every field MUST map exactly to an existing native question/results/export family. Never use json, legacy pairwise, or analysisHtml for a new revision.',
    'Use pairwiseChoice or pairwisePreference explicitly. Include native settings such as options, rows, columns, dimensions, min/max, and budget in resultSchema.',
    'Media-linked answers MUST include imageUrl (or shown_images) so Results Analysis can rank/overlay by stimulus.',
  );
  return lines.join('\n');
}

/** Compact blurb for survey_capabilities / skill_save descriptions. */
export function skillAnalysisGuideBlurb() {
  return (
    'Declare resultSchema[].type from: '
    + NATIVE_SKILL_RESULT_TYPE_IDS.join(', ')
    + '. Every new field must reuse the exact native analysis/export family; json, legacy pairwise, and analysisHtml are forbidden. '
    + 'Always include imageUrl for media-linked answers.'
  );
}
