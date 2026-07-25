/**
 * Unified Results Analysis export: per-question __long / __summary CSVs,
 * data_quality, manifest, README, and full ZIP file list.
 *
 * Long prefix (all types):
 *   participant_id, created_at, session_id, attempt_index, practice_mode, quality_flags,
 *   question_name, question_type,
 *   shown_images, shown_media_set, shown_media_categories
 *   (shown_media_ids stay in stored responses for internal joins; not exported)
 *
 * Summary (all types, tidy):
 *   question_name, question_type, n_responses,
 *   attribute_key, attribute_label,  ← matrix row / slider dim / etc. (empty when N/A)
 *   unit_key, unit_label,            ← image or choice unit (no image__attr concatenation)
 *   metric, value, n
 */

import { average, descriptiveStats } from './stats.js';
import { computeBordaScores, kendallW } from './rankingStats.js';
import {
  computeQuestionTrueSkill,
  computeForcedChoiceTrueSkill,
  computeMaxDiffTrueSkill,
  computeTrueSkillFromMatches,
  matchesFromOrderedRanking,
  matchesFromForcedChoiceAnswer,
  filenameKey,
} from './trueskill.js';
import {
  evaluateResponseQuality,
  QUALITY_FLAG_LABELS,
} from './quality.js';
import {
  stripSkillAnswerContext,
  extractSkillShownImages,
  isForcedChoiceSkill,
  isMaxDiffSkill,
  isVideoMomentSkill,
  isPairwiseSliderSkill,
  isEmotionColorSkill,
  isContinuousVideoSkill,
  isCompositeBlocksSkill,
  videoStimulusKey,
  imageStimulusKey,
  pairwiseShownKeys,
  mediaFilenameKey,
} from './skillMediaUtils.js';
import { computeMaxDiffScores } from './maxdiff.js';
import { expandQuestionAnswerUnits } from './responseAnswerUnits.js';
import { summarizeVideoMomentsByVideo } from './videoStats.js';
import { objectsToCsv, rowsToCsv, exportDateStamp } from './csvUtil.js';
import { downloadZip } from './zipDownload.js';
import { downloadTextFile, generateMethodsText } from './methodsExport.js';
import {
  annotationToolLabel,
  inferShapeTool,
  normalizeAnnotationTool,
} from './annotationTools.js';
import { checkAnswerAgainstResultSchema } from './skillResultTypes.js';
import {
  adaptResponsesForSkillField,
  skillFieldNativeQuestion,
} from './skillNativeAdapter.mjs';

// ─── Shared constants ─────────────────────────────────────────────────────────

export const LONG_PREFIX = [
  'participant_id',
  'created_at',
  'session_id',
  'attempt_index',
  'practice_mode',
  'quality_flags',
  'question_name',
  'question_type',
  'trial_index',
  'shown_images',
  'shown_media_set',
  'shown_media_categories',
];

export const SUMMARY_HEADERS = [
  'question_name',
  'question_type',
  'n_responses',
  'attribute_key',
  'attribute_label',
  'unit_key',
  'unit_label',
  'metric',
  'value',
  'n',
];

const DISPLAY_ONLY = new Set(['expression', 'image', 'html', 'mediadisplay']);

// Long-CSV extras = the answer only. What was displayed lives in LONG_PREFIX
// (shown_images / …), not duplicated here.
const LONG_EXTRA_BY_FAMILY = {
  scalar: ['value'],
  boolean: ['value', 'value_norm'],
  choice: ['value', 'label'],
  text: ['text'],
  matrix: ['row_key', 'row_label', 'column_key', 'column_label', 'value'],
  image_matrix: ['row_key', 'row_label', 'column_key', 'column_label', 'value'],
  // Text ranking: value + label (choice text). Image/media ranking: value only (filenames).
  ranking: ['value', 'label'],
  image_ranking: ['value'],
  image_rating: ['value'],
  image_boolean: ['value', 'value_norm'],
  // Stimulus + text multi-select: one row per selected tag
  image_checkbox: ['value', 'label'],
  // value = media key the participant chose (options are in shown_*)
  imagepicker: ['value'],
  // Best–Worst MaxDiff: one row per trial with both picks (media keys)
  maxdiff: ['best', 'worst'],
  // Video key moments: one row per marked segment (video in shown_*)
  video_moments: ['segment_index', 'start', 'end'],
  // Pairwise A/B slider: one row per trial
  pairwise_slider: ['preference', 'hard_to_decide', 'interpretation'],
  // Emotion color: one row per trial
  emotion_color: ['hex', 'hue', 'intensity', 'option_id', 'option_label', 'source'],
  // Continuous video rating: one row per time sample
  continuous_video: ['time_s', 'value'],
  // Composite blocks: one row per slider dimension (choice/words/text repeated)
  composite_blocks: ['dimension_id', 'dimension_label', 'value', 'choice', 'words', 'text'],
  slider: ['dimension_id', 'dimension_label', 'value'],
  // Same long shape as slider; summary breaks out by shown image × dimension.
  image_slider: ['dimension_id', 'dimension_label', 'value'],
  points: ['choice_key', 'choice_label', 'points'],
  // Same long shape as points; summary breaks out by shown image × allocation choice.
  image_points: ['choice_key', 'choice_label', 'points'],
  // Generic / custom skills: answer_json + expanded archetype rows (points/path/…/pairwise/bestWorst)
  skill: [
    'field_key', 'field_type',
    'x', 'y', 't', 'label', 'seq',
    'choice_key', 'choice_label', 'points',
    'rank', 'option', 'value',
    'answer_json',
  ],
  annotation: ['tool', 'label', 'annotation_json'],
};

function shownKeysFromLongRow(row) {
  return String(row?.shown_images || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

function questionFamily(type) {
  const t = type || '';
  if (t === 'rating' || t === 'number') return 'scalar';
  if (t === 'boolean' || t === 'consent') return 'boolean';
  if (t === 'radiogroup' || t === 'dropdown' || t === 'checkbox') return 'choice';
  if (t === 'text' || t === 'comment') return 'text';
  if (t === 'matrix') return 'matrix';
  // Image/media matrix: same cell answer shape, but summary must break out by shown stimulus.
  if (t === 'imagematrix' || t === 'image_matrix' || t === 'mediamatrix') return 'image_matrix';
  if (t === 'ranking') return 'ranking';
  if (t === 'imageranking' || t === 'image_ranking' || t === 'mediaranking') return 'image_ranking';
  if (t === 'imagerating' || t === 'image_rating' || t === 'mediarating') return 'image_rating';
  if (t === 'imageboolean' || t === 'image_boolean' || t === 'mediaboolean') return 'image_boolean';
  if (t === 'imagecheckbox' || t === 'image_checkbox' || t === 'mediacheckbox') return 'image_checkbox';
  if (t === 'imagepicker' || t === 'mediapicker') return 'imagepicker';
  if (t === 'slidergroup') return 'slider';
  if (t === 'imageslidergroup' || t === 'mediaslidergroup') return 'image_slider';
  if (t === 'pointallocation') return 'points';
  if (t === 'imagepointallocation' || t === 'mediapointallocation') return 'image_points';
  if (t === 'skillquestion') return 'skill';
  if (t === 'imageannotation') return 'annotation';
  return 'text';
}

/** Effective long/summary family for skill presets / skillquestion. */
function exportFamilyForQuestion(question) {
  if (isForcedChoiceSkill(question?.skillId)) return 'imagepicker';
  if (isMaxDiffSkill(question?.skillId)) return 'maxdiff';
  if (isVideoMomentSkill(question?.skillId)) return 'video_moments';
  if (isPairwiseSliderSkill(question?.skillId)) return 'pairwise_slider';
  if (isEmotionColorSkill(question?.skillId)) return 'emotion_color';
  if (isContinuousVideoSkill(question?.skillId)) return 'continuous_video';
  if (isCompositeBlocksSkill(question?.skillId)) return 'composite_blocks';
  const nativeSkillField = singleNativeSkillField(question);
  if (nativeSkillField) {
    const nativeQuestion = skillFieldNativeQuestion(question, nativeSkillField);
    if (nativeQuestion) return exportFamilyForQuestion(nativeQuestion);
  }
  if (question?.type === 'text' && question?.inputType === 'number') return 'scalar';
  return questionFamily(question?.type);
}

/** Ensure skill long rows carry stimulus filenames in shown_images. */
function enrichShownForSkill(answer, shownImages, preferredKeys = null) {
  if (Array.isArray(preferredKeys) && preferredKeys.length) {
    return preferredKeys.filter(Boolean).join('|');
  }
  const fromAnswer = extractSkillShownImages(answer).map(mediaFilenameKey).filter(Boolean);
  if (fromAnswer.length) return fromAnswer.join('|');
  return joinPipe(shownImages);
}

function longHeadersForType(type, question = null) {
  const fam = question ? exportFamilyForQuestion(question) : questionFamily(type);
  return [...LONG_PREFIX, ...(LONG_EXTRA_BY_FAMILY[fam] || LONG_EXTRA_BY_FAMILY.text)];
}

/** Chosen image filename key from a Forced-Choice A/B skill answer. */
function chosenKeyFromForcedChoice(answer, shownImages) {
  const matches = matchesFromForcedChoiceAnswer(answer, shownImages);
  if (matches[0]?.winner) return matches[0].winner;
  let idx = answer?.chosenIndex;
  if (idx == null) {
    if (answer?.choice === 'A') idx = 0;
    else if (answer?.choice === 'B') idx = 1;
  }
  const shown = (Array.isArray(shownImages) && shownImages.length)
    ? shownImages
    : [answer?.imageA, answer?.imageB].filter(Boolean);
  if (idx != null && shown[idx] != null) {
    return filenameKey(typeof shown[idx] === 'string' ? shown[idx] : shown[idx]?.url || shown[idx]?.name || '');
  }
  if (answer?.chosenUrl) return filenameKey(answer.chosenUrl);
  return '';
}

/** Best / worst media keys from a MaxDiff skill answer (one trial). */
function bestWorstKeysFromAnswer(answer, shownImages) {
  if (!answer || typeof answer !== 'object') return { best: '', worst: '' };
  const rawShown = (Array.isArray(shownImages) && shownImages.length)
    ? shownImages
    : (answer.shownUrls || []);
  const keys = rawShown
    .map((s) => filenameKey(typeof s === 'string' ? s : s?.url || s?.name || ''))
    .filter(Boolean);

  let bestIdx = answer.bestIndex;
  let worstIdx = answer.worstIndex;
  if ((bestIdx == null || bestIdx < 0 || bestIdx >= keys.length) && answer.bestUrl) {
    const fk = filenameKey(answer.bestUrl);
    const i = keys.findIndex((k) => k === fk);
    if (i >= 0) bestIdx = i;
  }
  if ((worstIdx == null || worstIdx < 0 || worstIdx >= keys.length) && answer.worstUrl) {
    const fk = filenameKey(answer.worstUrl);
    const i = keys.findIndex((k) => k === fk);
    if (i >= 0) worstIdx = i;
  }

  return {
    best: (bestIdx != null && keys[bestIdx]) || (answer.bestUrl ? filenameKey(answer.bestUrl) : ''),
    worst: (worstIdx != null && keys[worstIdx]) || (answer.worstUrl ? filenameKey(answer.worstUrl) : ''),
  };
}

function pushTrueSkillSummary(out, question, nResponses, rankings, longObjs, {
  valueKey = 'value',
} = {}) {
  const sortedTs = [...(rankings || [])].sort((a, b) => (b.mu ?? -Infinity) - (a.mu ?? -Infinity));
  sortedTs.forEach((r, idx) => {
    out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'rank', idx + 1, r.games));
    out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'mu', r.mu, r.games));
    out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'sigma', r.sigma, r.games));
    out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'mu_std5', r.muStd5, r.games));
    out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'wins', r.wins, r.games));
    out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'losses', r.losses, r.games));
    out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'games', r.games, r.games));
  });
  const freq = {};
  longObjs.forEach((r) => {
    const k = r[valueKey];
    if (!k) return;
    freq[k] = (freq[k] || 0) + 1;
  });
  Object.entries(freq).forEach(([k, count]) => {
    out.push(summaryRow(question, nResponses, k, k, 'count', count, nResponses));
    out.push(summaryRow(question, nResponses, k, k, 'pct', nResponses ? count / nResponses : 0, nResponses));
  });
}

/** Video Key Moments summary: one unit per video stimulus. */
function pushVideoMomentSummary(out, question, eligible) {
  const answerUnits = [];
  for (const row of eligible) {
    answerUnits.push(...expandQuestionAnswerUnits(row, question.name, { requireAnswer: true }));
  }
  const rows = summarizeVideoMomentsByVideo(answerUnits);
  rows.forEach((r) => {
    const n = r.nResponses;
    out.push(summaryRow(question, n, r.videoKey, r.videoKey, 'n_responses', n, n));
    out.push(summaryRow(question, n, r.videoKey, r.videoKey, 'total_segments', r.totalSegments, n));
    out.push(summaryRow(question, n, r.videoKey, r.videoKey, 'mean_segments', r.meanSegments, n));
    if (r.meanSegDuration != null) {
      out.push(summaryRow(question, n, r.videoKey, r.videoKey, 'mean_seg_duration', r.meanSegDuration, n));
    }
    if (r.meanVideoDuration != null) {
      out.push(summaryRow(question, n, r.videoKey, r.videoKey, 'mean_video_duration', r.meanVideoDuration, n));
    }
    if (r.peakTime != null) {
      out.push(summaryRow(question, n, r.videoKey, r.videoKey, 'peak_time', r.peakTime, n));
      out.push(summaryRow(question, n, r.videoKey, r.videoKey, 'peak_proportion', r.peakProportion, n));
    }
  });
}

function collectAnswerUnits(eligible, questionName) {
  const units = [];
  for (const row of eligible) {
    units.push(...expandQuestionAnswerUnits(row, questionName, { requireAnswer: true }));
  }
  return units;
}

/** Pairwise slider: unit = image; signed preference (−A … +B). */
function pushPairwiseSliderSummary(out, question, eligible) {
  const units = collectAnswerUnits(eligible, question.name);
  const byImg = {};
  units.forEach(({ answer, shown_images: shown }) => {
    const p = Number(answer?.preference);
    if (Number.isNaN(p)) return;
    const pairs = [
      { key: mediaFilenameKey(answer?.imageA || ''), score: -p },
      { key: mediaFilenameKey(answer?.imageB || ''), score: p },
    ];
    const fallback = pairwiseShownKeys(answer, shown);
    if ((!pairs[0].key || pairs[0].key === 'null') && fallback[0]) pairs[0].key = fallback[0];
    if ((!pairs[1].key || pairs[1].key === 'null') && fallback[1]) pairs[1].key = fallback[1];
    pairs.forEach(({ key, score }) => {
      if (!key || key === 'null' || key === 'undefined') return;
      if (!byImg[key]) byImg[key] = [];
      byImg[key].push(score);
    });
  });
  const nResp = units.length;
  Object.entries(byImg)
    .sort((a, b) => {
      const ma = a[1].reduce((s, v) => s + v, 0) / a[1].length;
      const mb = b[1].reduce((s, v) => s + v, 0) / b[1].length;
      return mb - ma;
    })
    .forEach(([key, nums], idx) => {
      pushStats(out, question, nResp, key, key, nums);
      out.push(summaryRow(question, nResp, key, key, 'rank', idx + 1, nums.length));
      out.push(summaryRow(question, nResp, key, key, 'appearances', nums.length, nums.length));
    });
}

/** Emotion color: unit = image. */
function pushEmotionColorSummary(out, question, eligible) {
  const units = collectAnswerUnits(eligible, question.name);
  const byImg = {};
  units.forEach(({ answer, shown_images: shown }) => {
    const key = imageStimulusKey(answer, shown);
    if (!byImg[key]) byImg[key] = { hues: [], intensities: [], options: {} };
    const c = answer?.color;
    if (!c || typeof c !== 'object') return;
    const hue = Number(c.hue);
    if (!Number.isNaN(hue)) byImg[key].hues.push(hue);
    const inten = Number(c.intensity);
    if (!Number.isNaN(inten)) byImg[key].intensities.push(inten);
    const opt = c.optionId || c.label;
    if (opt) byImg[key].options[opt] = (byImg[key].options[opt] || 0) + 1;
  });
  Object.entries(byImg).forEach(([key, block]) => {
    const n = Math.max(block.hues.length, block.intensities.length, Object.values(block.options).reduce((s, v) => s + v, 0), 1);
    out.push(summaryRow(question, n, key, key, 'n_responses', n, n));
    if (block.hues.length) pushStats(out, question, n, key, key, block.hues, 'hue', 'hue');
    if (block.intensities.length) pushStats(out, question, n, key, key, block.intensities, 'intensity', 'intensity');
    Object.entries(block.options).forEach(([opt, count]) => {
      out.push(summaryRow(question, n, key, key, 'option_count', count, n, opt, opt));
    });
  });
}

/** Continuous video rating: unit = video. */
function pushContinuousVideoSummary(out, question, eligible) {
  const units = collectAnswerUnits(eligible, question.name);
  const byVid = {};
  units.forEach(({ answer, shown_images: shown }) => {
    const key = videoStimulusKey(answer, shown);
    if (!byVid[key]) byVid[key] = { means: [], sampleCounts: [], values: [] };
    const mean = Number(answer?.mean);
    if (!Number.isNaN(mean)) byVid[key].means.push(mean);
    const sc = Number(answer?.sampleCount);
    if (!Number.isNaN(sc)) byVid[key].sampleCounts.push(sc);
    (answer?.samples || []).forEach((s) => {
      const v = Number(s?.v);
      if (!Number.isNaN(v)) byVid[key].values.push(v);
    });
  });
  Object.entries(byVid).forEach(([key, block]) => {
    const n = Math.max(block.means.length, 1);
    out.push(summaryRow(question, n, key, key, 'n_responses', n, n));
    if (block.means.length) pushStats(out, question, n, key, key, block.means, 'trial_mean', 'trial_mean');
    if (block.values.length) pushStats(out, question, n, key, key, block.values, 'sample', 'sample');
    if (block.sampleCounts.length) {
      const total = block.sampleCounts.reduce((a, b) => a + b, 0);
      out.push(summaryRow(question, n, key, key, 'total_samples', total, n));
    }
  });
}

/** Composite blocks: unit = image × dimension (ratings); choice/words overall per image. */
function pushCompositeBlocksSummary(out, question, eligible) {
  const units = collectAnswerUnits(eligible, question.name);
  const byUnit = {}; // img||dim → nums
  const byImgChoice = {};
  const byImgWord = {};
  units.forEach(({ answer, shown_images: shown }) => {
    const img = imageStimulusKey(answer, shown);
    (answer?.ratings || []).forEach((d) => {
      const dim = d.id || d.label || `${d.left}/${d.right}` || 'dim';
      const key = `${img}||${dim}`;
      if (!byUnit[key]) byUnit[key] = { img, dim, label: d.label || dim, nums: [] };
      const n = Number(d.value);
      if (!Number.isNaN(n)) byUnit[key].nums.push(n);
    });
    if (answer?.choice != null && answer.choice !== '') {
      if (!byImgChoice[img]) byImgChoice[img] = {};
      const c = String(answer.choice);
      byImgChoice[img][c] = (byImgChoice[img][c] || 0) + 1;
    }
    (answer?.words || []).forEach((w) => {
      if (!byImgWord[img]) byImgWord[img] = {};
      const ww = String(w);
      byImgWord[img][ww] = (byImgWord[img][ww] || 0) + 1;
    });
  });
  const nResp = units.length;
  Object.values(byUnit).forEach((block) => {
    pushStats(out, question, nResp, block.img, block.img, block.nums, block.dim, block.label);
  });
  Object.entries(byImgChoice).forEach(([img, freq]) => {
    Object.entries(freq).forEach(([c, count]) => {
      out.push(summaryRow(question, nResp, img, img, 'choice_count', count, nResp, c, c));
    });
  });
  Object.entries(byImgWord).forEach(([img, freq]) => {
    Object.entries(freq).forEach(([w, count]) => {
      out.push(summaryRow(question, nResp, img, img, 'word_count', count, nResp, w, w));
    });
  });
}

/** Generic skill: unit = primary stimulus; numeric leaves → mean stats; archetypes → native-like metrics. */
function pushGenericSkillSummary(out, question, eligible, longObjs) {
  const nResponses = new Set(longObjs.map((r) => [
    r.participant_id, r.session_id, r.attempt_index, r.created_at, r.trial_index,
  ].join('|'))).size || collectAnswerUnits(eligible, question.name).length;
  const byMedia = {};
  const labelCounts = {}; // `${media}||${field}||${label}` → count
  const allocByMedia = {}; // `${media}||${field}||${item}` → nums[]
  const rankByOption = {}; // `${field}||${option}` → ranks[]
  const pathLens = {}; // `${media}||${field}` → lengths[]
  const choiceCounts = {}; // `${field}||${option}` → count (multiChoice/mediaChoice)
  const matrixCounts = {}; // `${field}||${row}||${col}` → count
  const segmentCounts = {}; // `${media}||${field}` → segment counts per response
  const seriesMeans = {}; // `${media}||${field}` → mean sample values
  const pairwisePrefs = {}; // `${field}` → preference nums
  const bestWorstCounts = {}; // `${field}||best|worst||option` → count

  const ARCHETYPE_EXPORT_TYPES = new Set([
    'points', 'path', 'polygon', 'bbox', 'box',
    'allocation', 'rankedList', 'mediaRankedList',
    'multiChoice', 'matrix', 'mediaChoice',
    'timeRanges', 'timeSeries', 'pairwise', 'bestWorst',
  ]);

  longObjs.forEach((r) => {
    const media = shownKeysFromLongRow(r)[0] || '(no_media)';
    if (r.field_type === 'points' || r.field_type === 'polygon' || r.field_type === 'bbox') {
      const label = String(r.label || '').trim() || '(unlabeled)';
      const key = `${media}||${r.field_key || r.field_type}||${label}`;
      labelCounts[key] = (labelCounts[key] || 0) + 1;
      return;
    }
    if (r.field_type === 'path') {
      // Path length aggregated from answer_json pass below.
      return;
    }
    if (r.field_type === 'allocation') {
      const key = `${media}||${r.field_key || 'allocation'}||${r.choice_key || ''}`;
      if (!allocByMedia[key]) allocByMedia[key] = [];
      const n = Number(r.points);
      if (!Number.isNaN(n)) allocByMedia[key].push(n);
      return;
    }
    if (r.field_type === 'rankedList' || r.field_type === 'mediaRankedList') {
      const key = `${r.field_key || r.field_type}||${r.option || ''}`;
      if (!rankByOption[key]) rankByOption[key] = [];
      const rank = Number(r.rank);
      if (!Number.isNaN(rank)) rankByOption[key].push(rank);
      return;
    }
    if (r.field_type === 'multiChoice' || r.field_type === 'mediaChoice') {
      const key = `${r.field_key || r.field_type}||${r.option || ''}`;
      choiceCounts[key] = (choiceCounts[key] || 0) + 1;
      return;
    }
    if (r.field_type === 'matrix') {
      const key = `${r.field_key || 'matrix'}||${r.choice_key || ''}||${r.option || ''}`;
      matrixCounts[key] = (matrixCounts[key] || 0) + 1;
      return;
    }
    if (r.field_type === 'timeRanges') {
      const key = `${media}||${r.field_key || 'timeRanges'}`;
      if (!segmentCounts[key]) segmentCounts[key] = { nSeg: 0, durations: [] };
      segmentCounts[key].nSeg += 1;
      const dur = Number(r.y) - Number(r.x);
      if (Number.isFinite(dur) && dur >= 0) segmentCounts[key].durations.push(dur);
      return;
    }
    if (r.field_type === 'timeSeries') {
      const key = `${media}||${r.field_key || 'timeSeries'}`;
      if (!seriesMeans[key]) seriesMeans[key] = [];
      const v = Number(r.y ?? r.value ?? r.points);
      if (!Number.isNaN(v)) seriesMeans[key].push(v);
      return;
    }
    if (r.field_type === 'pairwise' || r.field_type === 'pairwisePreference') {
      const key = r.field_key || 'pairwise';
      if (!pairwisePrefs[key]) pairwisePrefs[key] = [];
      const n = Number(r.value);
      if (!Number.isNaN(n)) pairwisePrefs[key].push(n);
      return;
    }
    if (r.field_type === 'pairwiseChoice') {
      const key = `${r.field_key || 'pairwiseChoice'}||${r.option || ''}`;
      choiceCounts[key] = (choiceCounts[key] || 0) + 1;
      return;
    }
    if (r.field_type === 'bestWorst') {
      const field = r.field_key || 'bestWorst';
      if (r.option) {
        const bk = `${field}||best||${r.option}`;
        bestWorstCounts[bk] = (bestWorstCounts[bk] || 0) + 1;
      }
      if (r.choice_key) {
        const wk = `${field}||worst||${r.choice_key}`;
        bestWorstCounts[wk] = (bestWorstCounts[wk] || 0) + 1;
      }
      return;
    }
    if (['number', 'scaleGroup'].includes(r.field_type)) {
      if (!byMedia[media]) byMedia[media] = { n: 0, nums: {} };
      const n = Number(r.value);
      if (Number.isFinite(n)) {
        if (!byMedia[media].nums[r.field_key]) byMedia[media].nums[r.field_key] = [];
        byMedia[media].nums[r.field_key].push(n);
      }
      return;
    }
    if (['boolean', 'choice', 'text', 'json'].includes(r.field_type)) {
      const key = `${r.field_key || r.field_type}||${String(r.option || r.value || '')}`;
      choiceCounts[key] = (choiceCounts[key] || 0) + 1;
      return;
    }
    if (!byMedia[media]) byMedia[media] = { n: 0, nums: {} };
    if (r.field_type === 'answer' || r.answer_json) {
      byMedia[media].n += 1;
      let obj = null;
      try { obj = r.answer_json ? JSON.parse(r.answer_json) : null; } catch { obj = null; }
      if (!obj || typeof obj !== 'object') return;
      const schema = Array.isArray(question.skillResultSchema) ? question.skillResultSchema : [];
      const archetypeKeys = new Set(
        schema.filter((f) => ARCHETYPE_EXPORT_TYPES.has(f.type) || f.type === 'box').map((f) => f.key),
      );
      // Path length from answer object
      schema.filter((f) => f.type === 'path').forEach((f) => {
        const pts = obj[f.key];
        if (!Array.isArray(pts) || pts.length < 2) return;
        let len = 0;
        for (let i = 1; i < pts.length; i += 1) {
          const dx = Number(pts[i].x) - Number(pts[i - 1].x);
          const dy = Number(pts[i].y) - Number(pts[i - 1].y);
          if (Number.isFinite(dx) && Number.isFinite(dy)) len += Math.hypot(dx, dy);
        }
        const pk = `${media}||${f.key}`;
        if (!pathLens[pk]) pathLens[pk] = [];
        pathLens[pk].push(len);
      });
      const walk = (node, prefix) => {
        if (node == null) return;
        if (typeof node === 'number' && !Number.isNaN(node)) {
          if (!byMedia[media].nums[prefix]) byMedia[media].nums[prefix] = [];
          byMedia[media].nums[prefix].push(node);
          return;
        }
        if (typeof node !== 'object' || Array.isArray(node)) return;
        Object.entries(node).forEach(([k, v]) => {
          if (archetypeKeys.has(k)) return; // covered by archetype summaries
          walk(v, prefix ? `${prefix}.${k}` : k);
        });
      };
      walk(obj, '');
    }
  });
  // Fallback: rebuild from eligible if long empty
  if (!Object.keys(byMedia).length && !Object.keys(labelCounts).length
    && !Object.keys(allocByMedia).length && !Object.keys(rankByOption).length) {
    collectAnswerUnits(eligible, question.name).forEach(({ answer, shown_images: shown }) => {
      const media = imageStimulusKey(answer, shown);
      const key = media === '(unknown_image)' ? videoStimulusKey(answer, shown) : media;
      if (!byMedia[key]) byMedia[key] = { n: 0, nums: {} };
      byMedia[key].n += 1;
    });
  }
  Object.entries(byMedia).forEach(([media, block]) => {
    out.push(summaryRow(question, block.n, media, media, 'n_responses', block.n, block.n));
    Object.entries(block.nums).forEach(([attr, nums]) => {
      pushStats(out, question, block.n, media, media, nums, attr, attr);
    });
  });
  Object.entries(labelCounts).forEach(([key, count]) => {
    const [media, field, label] = key.split('||');
    out.push(summaryRow(question, nResponses, media, media, 'label_count', count, count, `${field}:${label}`, `${field}:${label}`));
  });
  Object.entries(pathLens).forEach(([key, nums]) => {
    const [media, field] = key.split('||');
    pushStats(out, question, nums.length, media, media, nums, `${field}:path_length`, `${field}:path_length`);
  });
  Object.entries(allocByMedia).forEach(([key, nums]) => {
    const [media, field, item] = key.split('||');
    pushStats(out, question, nums.length, media, media, nums, `${field}:${item}`, `${field}:${item}`);
  });
  Object.entries(rankByOption).forEach(([key, ranks]) => {
    const [field, option] = key.split('||');
    const avg = average(ranks);
    out.push(summaryRow(question, nResponses, option, option, 'avg_rank', avg, ranks.length, field, field));
    const nItems = new Set(
      Object.keys(rankByOption).filter((k) => k.startsWith(`${field}||`)).map((k) => k.split('||')[1]),
    ).size;
    const bordaMap = computeBordaScores({ [option]: ranks }, nItems || ranks.length);
    out.push(summaryRow(
      question,
      nResponses,
      option,
      option,
      'borda',
      bordaMap[option]?.borda ?? null,
      ranks.length,
      field,
      field,
    ));
  });
  Object.entries(choiceCounts).forEach(([key, count]) => {
    const [field, option] = key.split('||');
    out.push(summaryRow(question, nResponses, option, option, 'choice_count', count, count, field, field));
  });
  Object.entries(matrixCounts).forEach(([key, count]) => {
    const [field, row, col] = key.split('||');
    out.push(summaryRow(question, nResponses, `${row}:${col}`, `${row}:${col}`, 'cell_count', count, count, field, field));
  });
  Object.entries(segmentCounts).forEach(([key, block]) => {
    const [media, field] = key.split('||');
    out.push(summaryRow(question, nResponses, media, media, 'segment_count', block.nSeg, block.nSeg, field, field));
    if (block.durations.length) {
      pushStats(out, question, block.durations.length, media, media, block.durations, `${field}:seg_duration`, `${field}:seg_duration`);
    }
  });
  Object.entries(seriesMeans).forEach(([key, nums]) => {
    const [media, field] = key.split('||');
    pushStats(out, question, nums.length, media, media, nums, `${field}:sample`, `${field}:sample`);
  });
  Object.entries(pairwisePrefs).forEach(([field, nums]) => {
    pushStats(out, question, nums.length, field, field, nums, 'preference', 'preference');
  });
  Object.entries(bestWorstCounts).forEach(([key, count]) => {
    const [field, role, option] = key.split('||');
    out.push(summaryRow(question, count, option, option, `${role}_count`, count, count, field, field));
  });
}

/** MaxDiff summary: TrueSkill (μ-sorted) + classical BWS columns per image. */
function pushMaxDiffSummary(out, question, nResponses, eligible) {
  const { rankings: tsRankings } = computeMaxDiffTrueSkill(eligible, question.name);
  const answerUnits = [];
  for (const row of eligible) {
    answerUnits.push(...expandQuestionAnswerUnits(row, question.name, { requireAnswer: true }));
  }
  const mediaCount = question.skillConfig?.mediaCount
    || question.imageCount
    || 4;
  const bwsRows = computeMaxDiffScores(answerUnits, mediaCount);
  const bwsByKey = new Map(bwsRows.map((r) => [r.imageKey, r]));
  const sortedTs = [...(tsRankings || [])].sort((a, b) => (b.mu ?? -Infinity) - (a.mu ?? -Infinity));

  // Prefer TrueSkill order; append BWS-only images with no matches.
  const seen = new Set();
  const ordered = [];
  sortedTs.forEach((r) => {
    seen.add(r.imageKey);
    ordered.push({ ts: r, bws: bwsByKey.get(r.imageKey) || null });
  });
  bwsRows.forEach((bws) => {
    if (!seen.has(bws.imageKey)) {
      ordered.push({ ts: null, bws });
    }
  });

  ordered.forEach((row, idx) => {
    const key = row.ts?.imageKey || row.bws?.imageKey;
    if (!key) return;
    const games = row.ts?.games ?? row.bws?.appearances ?? 0;
    out.push(summaryRow(question, nResponses, key, key, 'rank', idx + 1, games));
    if (row.ts) {
      out.push(summaryRow(question, nResponses, key, key, 'mu', row.ts.mu, row.ts.games));
      out.push(summaryRow(question, nResponses, key, key, 'sigma', row.ts.sigma, row.ts.games));
      out.push(summaryRow(question, nResponses, key, key, 'mu_std5', row.ts.muStd5, row.ts.games));
      out.push(summaryRow(question, nResponses, key, key, 'wins', row.ts.wins, row.ts.games));
      out.push(summaryRow(question, nResponses, key, key, 'losses', row.ts.losses, row.ts.games));
      out.push(summaryRow(question, nResponses, key, key, 'games', row.ts.games, row.ts.games));
    }
    if (row.bws) {
      out.push(summaryRow(question, nResponses, key, key, 'bws', row.bws.bws, row.bws.appearances));
      out.push(summaryRow(question, nResponses, key, key, 'score_std5', row.bws.scoreStd5, row.bws.appearances));
      out.push(summaryRow(question, nResponses, key, key, 'best', row.bws.best, row.bws.appearances));
      out.push(summaryRow(question, nResponses, key, key, 'worst', row.bws.worst, row.bws.appearances));
      out.push(summaryRow(question, nResponses, key, key, 'appearances', row.bws.appearances, row.bws.appearances));
      out.push(summaryRow(
        question,
        nResponses,
        key,
        key,
        'pct_best',
        row.bws.appearances ? row.bws.best / row.bws.appearances : 0,
        row.bws.appearances,
      ));
    }
  });
}

function isDisplayOnly(question) {
  return DISPLAY_ONLY.has(question?.type);
}

function responsesEligibleForQuestion(questionName, responses) {
  return (responses || []).filter((row) => {
    if (row.survey_metadata?.practice_mode) {
      return row.survey_metadata?.practice_question === questionName;
    }
    return true;
  });
}

function imageKeyFromShown(entry) {
  if (!entry) return '';
  const s = typeof entry === 'string' ? entry : (entry.url || entry.name || '');
  return s.split('?')[0].split('/').pop() || s;
}

function resolveImageChoiceKey(value, shownImages) {
  if (value == null || value === '') return '';
  const str = String(value);
  // SurveyJS choice values: image_N (image*) or media_N (media*)
  const match = str.match(/^(?:image|media)_(\d+)$/);
  if (match && Array.isArray(shownImages) && shownImages.length) {
    const img = shownImages[Number(match[1])];
    if (img != null) return imageKeyFromShown(img) || String(img);
  }
  return imageKeyFromShown(str) || str;
}

function joinPipe(arr) {
  if (!Array.isArray(arr)) return arr == null ? '' : String(arr);
  return arr.map((v) => (v == null ? '' : imageKeyFromShown(v) || String(v))).join('|');
}

function choiceLabelMap(choices) {
  const map = {};
  (choices || []).forEach((c) => {
    if (typeof c === 'object' && c !== null) {
      map[String(c.value)] = String(c.text ?? c.label ?? c.value);
    } else {
      map[String(c)] = String(c);
    }
  });
  return map;
}

function matrixLabelMap(items) {
  const map = {};
  (items || []).forEach((item) => {
    if (typeof item === 'object' && item !== null) {
      map[String(item.value)] = String(item.text ?? item.label ?? item.value);
    } else {
      map[String(item)] = String(item);
    }
  });
  return map;
}

function normalizeBool(v) {
  if (v === true || v === 'true' || v === 'yes' || v === 1 || v === '1') return 1;
  if (v === false || v === 'false' || v === 'no' || v === 0 || v === '0') return 0;
  return '';
}

function parsePayload(row, questionName) {
  const qData = row.responses?.[questionName];
  if (qData === undefined || qData === null) return null;

  // Multi-trial enriched shape: expand to one payload per trial
  if (typeof qData === 'object' && !Array.isArray(qData) && Array.isArray(qData.trials)) {
    return qData.trials.map((trial, trialIndex) => {
      const answer = trial?.answer ?? trial?.value;
      if (answer === null || answer === undefined || answer === '') return null;
      const shownImages = trial?.shown_images?.length
        ? trial.shown_images
        : (row.displayed_images?.[`${questionName}__trials`]?.[trialIndex]
          || row.displayed_images?.[questionName]
          || []);
      return {
        answer,
        shownImages,
        shownMediaIds: Array.isArray(trial?.shown_media_ids) ? trial.shown_media_ids : [],
        shownMediaGroup: '',
        shownMediaSet: '',
        shownMediaCategories: '',
        trialIndex,
      };
    }).filter(Boolean);
  }

  // Recovery: answer[] paired with displayed_images[name__trials]
  if (typeof qData === 'object' && !Array.isArray(qData) && Array.isArray(qData.answer) && !qData.trials) {
    const trialShown = row.displayed_images?.[`${questionName}__trials`];
    if (Array.isArray(trialShown) && trialShown.length >= 2 && qData.answer.length === trialShown.length) {
      return qData.answer.map((answer, trialIndex) => {
        if (answer === null || answer === undefined || answer === '') return null;
        return {
          answer,
          shownImages: trialShown[trialIndex] || [],
          shownMediaIds: [],
          shownMediaGroup: '',
          shownMediaSet: '',
          shownMediaCategories: '',
          trialIndex,
        };
      }).filter(Boolean);
    }
  }

  let answer;
  let shownImages = [];
  let shownMediaIds = [];
  let shownMediaSet = '';
  let shownMediaCategories = '';

  if (typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) {
    answer = qData.answer;
    // If answer is array from enrich multi-trial without trials key, keep as-is
    shownImages = qData.shown_images?.length
      ? qData.shown_images
      : (row.displayed_images?.[questionName] || []);
    shownMediaIds = Array.isArray(qData.shown_media_ids) ? qData.shown_media_ids : [];
    shownMediaSet = qData.shown_media_set
      || qData.shown_media_group
      || row.displayed_media_groups?.[questionName]
      || '';
    const cats = qData.shown_media_categories ?? row.displayed_media_categories?.[questionName];
    shownMediaCategories = Array.isArray(cats) ? cats.join('|') : (cats || '');
  } else {
    answer = qData;
    shownImages = row.displayed_images?.[questionName] || [];
  }

  if (answer === null || answer === undefined || answer === '') return null;

  return {
    answer,
    shownImages,
    shownMediaIds,
    shownMediaGroup: shownMediaSet,
    shownMediaSet,
    shownMediaCategories,
  };
}

function payloadsForQuestion(row, questionName) {
  const parsed = parsePayload(row, questionName);
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function baseLongFields(row, question, flags, payload = null) {
  const p = payload || (payloadsForQuestion(row, question.name)[0] || null);
  return {
    participant_id: row.participant_id || '',
    created_at: row.created_at || row.survey_metadata?.completion_time || '',
    session_id: row.survey_metadata?.session_id || '',
    attempt_index: row.survey_metadata?.attempt_index ?? '',
    practice_mode: row.survey_metadata?.practice_mode ? 'true' : 'false',
    quality_flags: (flags || []).join('|'),
    question_name: question.name,
    question_type: question.type || '',
    trial_index: p?.trialIndex ?? '',
    shown_images: joinPipe(p?.shownImages),
    shown_media_set: p?.shownMediaSet || p?.shownMediaGroup || '',
    shown_media_categories: p?.shownMediaCategories || '',
    _payload: p,
  };
}

function emptyExtra(fam) {
  const keys = LONG_EXTRA_BY_FAMILY[fam] || LONG_EXTRA_BY_FAMILY.text;
  const o = {};
  keys.forEach((k) => { o[k] = ''; });
  return o;
}

function summaryRow(
  question,
  nResponses,
  unitKey,
  unitLabel,
  metric,
  value,
  n,
  attributeKey = '',
  attributeLabel = '',
) {
  return {
    question_name: question.name,
    question_type: question.type || '',
    n_responses: nResponses,
    attribute_key: attributeKey || '',
    attribute_label: attributeLabel || '',
    unit_key: unitKey,
    unit_label: unitLabel,
    metric,
    value: value == null || Number.isNaN(value) ? '' : value,
    n: n == null ? '' : n,
  };
}

function pushStats(
  out,
  question,
  nResponses,
  unitKey,
  unitLabel,
  nums,
  attributeKey = '',
  attributeLabel = '',
) {
  const st = descriptiveStats(nums);
  if (!st.n) return;
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'mean', st.mean, st.n, attributeKey, attributeLabel));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'sd', st.sd, st.n, attributeKey, attributeLabel));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'median', st.median, st.n, attributeKey, attributeLabel));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'min', st.min, st.n, attributeKey, attributeLabel));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'max', st.max, st.n, attributeKey, attributeLabel));
  out.push(summaryRow(question, nResponses, unitKey, unitLabel, 'count', st.n, st.n, attributeKey, attributeLabel));
}

// ─── Long builders ────────────────────────────────────────────────────────────

function buildLongObjects(question, responses, surveyConfig) {
  const fam = exportFamilyForQuestion(question);
  const forcedChoice = isForcedChoiceSkill(question.skillId);
  const eligible = responsesEligibleForQuestion(question.name, responses);
  const objects = [];

  for (const row of eligible) {
    const flags = surveyConfig
      ? evaluateResponseQuality(row, surveyConfig, responses)
      : [];
    const payloads = payloadsForQuestion(row, question.name);
    for (const payload of payloads) {
    const base = baseLongFields(row, question, flags, payload);
    delete base._payload;
    if (!payload) continue;

    const { answer, shownImages } = payload;
    const extra = emptyExtra(fam);

    if (fam === 'scalar') {
      objects.push({ ...base, ...extra, value: answer });
    } else if (fam === 'boolean') {
      objects.push({
        ...base,
        ...extra,
        value: answer,
        value_norm: normalizeBool(answer),
      });
    } else if (fam === 'choice') {
      const labels = choiceLabelMap(question.choices);
      const vals = question.type === 'checkbox'
        ? (Array.isArray(answer) ? answer : [answer])
        : [answer];
      vals.forEach((v) => {
        objects.push({
          ...base,
          ...extra,
          value: v,
          label: labels[String(v)] || String(v ?? ''),
        });
      });
    } else if (fam === 'text') {
      objects.push({ ...base, ...extra, text: typeof answer === 'object' ? JSON.stringify(answer) : String(answer) });
    } else if (fam === 'matrix' || fam === 'image_matrix') {
      const rowLabels = matrixLabelMap(question.rows);
      const colLabels = matrixLabelMap(question.columns);
      const obj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      Object.entries(obj).forEach(([rowKey, colVal]) => {
        objects.push({
          ...base,
          ...extra,
          row_key: rowKey,
          row_label: rowLabels[String(rowKey)] || rowKey,
          column_key: colVal,
          column_label: colLabels[String(colVal)] || String(colVal ?? ''),
          value: colVal,
        });
      });
    } else if (fam === 'ranking') {
      const labels = choiceLabelMap(question.choices);
      const ranked = Array.isArray(answer) ? answer : [];
      const keys = ranked.map((item) => String(item ?? ''));
      const labs = keys.map((key) => labels[key] || key);
      objects.push({
        ...base,
        ...extra,
        value: keys.join('|'),
        label: labs.join('|'),
      });
    } else if (fam === 'image_ranking') {
      const ranked = Array.isArray(answer) ? answer : [];
      const keys = ranked.map((item) => resolveImageChoiceKey(item, shownImages));
      objects.push({
        ...base,
        ...extra,
        value: keys.join('|'),
      });
    } else if (fam === 'image_rating') {
      const rating = Number(answer);
      // One row per trial: stimulus is in shown_*; answer is value only.
      objects.push({
        ...base,
        ...extra,
        value: Number.isNaN(rating) ? answer : rating,
      });
    } else if (fam === 'image_boolean') {
      objects.push({
        ...base,
        ...extra,
        value: answer,
        value_norm: normalizeBool(answer),
      });
    } else if (fam === 'image_checkbox') {
      const selected = Array.isArray(answer) ? answer
        : (answer == null || answer === '' ? [] : [answer]);
      const labels = choiceLabelMap(question.choices || []);
      selected.forEach((v) => {
        const key = String(v);
        objects.push({
          ...base,
          ...extra,
          value: key,
          label: labels[key] || key,
        });
      });
    } else if (fam === 'imagepicker') {
      if (forcedChoice) {
        objects.push({
          ...base,
          ...extra,
          value: chosenKeyFromForcedChoice(answer, shownImages),
        });
      } else {
        const vals = Array.isArray(answer) ? answer : [answer];
        vals.forEach((v) => {
          objects.push({
            ...base,
            ...extra,
            value: resolveImageChoiceKey(v, shownImages),
          });
        });
      }
    } else if (fam === 'maxdiff') {
      const { best, worst } = bestWorstKeysFromAnswer(answer, shownImages);
      objects.push({
        ...base,
        ...extra,
        best,
        worst,
      });
    } else if (fam === 'video_moments') {
      const videoKey = videoStimulusKey(answer, shownImages);
      const shownPipe = enrichShownForSkill(answer, shownImages, [videoKey].filter((k) => k && k !== '(unknown_video)'));
      const segs = Array.isArray(answer?.segments) ? answer.segments : [];
      if (!segs.length) {
        objects.push({
          ...base,
          shown_images: shownPipe || base.shown_images,
          ...extra,
          segment_index: '',
          start: '',
          end: '',
        });
      } else {
        segs.forEach((seg, i) => {
          objects.push({
            ...base,
            shown_images: shownPipe || base.shown_images,
            ...extra,
            segment_index: i,
            start: seg?.start ?? '',
            end: seg?.end ?? '',
          });
        });
      }
    } else if (fam === 'pairwise_slider') {
      const pairKeys = pairwiseShownKeys(answer, shownImages);
      objects.push({
        ...base,
        shown_images: enrichShownForSkill(answer, shownImages, pairKeys),
        ...extra,
        preference: answer?.preference ?? '',
        hard_to_decide: answer?.hardToDecide ? 'true' : 'false',
        interpretation: answer?.interpretation ?? '',
      });
    } else if (fam === 'emotion_color') {
      const c = answer?.color && typeof answer.color === 'object' ? answer.color : {};
      const imgKey = imageStimulusKey(answer, shownImages);
      objects.push({
        ...base,
        shown_images: enrichShownForSkill(answer, shownImages, [imgKey].filter((k) => k && k !== '(unknown_image)')),
        ...extra,
        hex: c.hex ?? '',
        hue: c.hue ?? '',
        intensity: c.intensity ?? '',
        option_id: c.optionId ?? '',
        option_label: c.label ?? '',
        source: c.source ?? '',
      });
    } else if (fam === 'continuous_video') {
      const videoKey = videoStimulusKey(answer, shownImages);
      const shownPipe = enrichShownForSkill(answer, shownImages, [videoKey].filter((k) => k && k !== '(unknown_video)'));
      const samples = Array.isArray(answer?.samples) ? answer.samples : [];
      if (!samples.length) {
        objects.push({
          ...base,
          shown_images: shownPipe || base.shown_images,
          ...extra,
          time_s: '',
          value: answer?.mean ?? '',
        });
      } else {
        samples.forEach((s) => {
          objects.push({
            ...base,
            shown_images: shownPipe || base.shown_images,
            ...extra,
            time_s: s?.t ?? '',
            value: s?.v ?? '',
          });
        });
      }
    } else if (fam === 'composite_blocks') {
      const imgKey = imageStimulusKey(answer, shownImages);
      const shownPipe = enrichShownForSkill(answer, shownImages, [imgKey].filter((k) => k && k !== '(unknown_image)'));
      const ratings = Array.isArray(answer?.ratings) ? answer.ratings : [];
      const words = Array.isArray(answer?.words) ? answer.words.join('|') : '';
      const choice = answer?.choice ?? '';
      const text = answer?.text ?? '';
      if (!ratings.length) {
        objects.push({
          ...base,
          shown_images: shownPipe || base.shown_images,
          ...extra,
          dimension_id: '',
          dimension_label: '',
          value: '',
          choice,
          words,
          text,
        });
      } else {
        ratings.forEach((d) => {
          objects.push({
            ...base,
            shown_images: shownPipe || base.shown_images,
            ...extra,
            dimension_id: d.id || '',
            dimension_label: d.label || `${d.left || ''} ↔ ${d.right || ''}` || d.id || '',
            value: d.value ?? '',
            choice,
            words,
            text,
          });
        });
      }
    } else if (fam === 'slider' || fam === 'image_slider') {
      const dims = question.dimensions || [];
      const obj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      dims.forEach((d) => {
        objects.push({
          ...base,
          ...extra,
          dimension_id: d.id,
          dimension_label: d.label || `${d.left || ''} ↔ ${d.right || ''}` || d.id,
          value: obj[d.id] ?? '',
        });
      });
      if (!dims.length) {
        Object.entries(obj).forEach(([k, v]) => {
          objects.push({
            ...base,
            ...extra,
            dimension_id: k,
            dimension_label: k,
            value: v,
          });
        });
      }
    } else if (fam === 'points' || fam === 'image_points') {
      const labels = choiceLabelMap(question.choices);
      const obj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      const keys = (question.choices || []).map((c) => (typeof c === 'object' ? c.value : c)).filter((k) => k != null);
      const useKeys = keys.length ? keys : Object.keys(obj);
      useKeys.forEach((k) => {
        objects.push({
          ...base,
          ...extra,
          choice_key: k,
          choice_label: labels[String(k)] || String(k),
          points: obj[k] ?? '',
        });
      });
    } else if (fam === 'skill') {
      // One row per trial with full answer JSON, plus expanded rows for declared archetypes.
      const raw = (answer && typeof answer === 'object' && !Array.isArray(answer))
        ? stripSkillAnswerContext(answer)
        : answer;
      const stimKeys = extractSkillShownImages(answer).map(mediaFilenameKey).filter(Boolean);
      const shownPipe = enrichShownForSkill(answer, shownImages, stimKeys) || base.shown_images;
      objects.push({
        ...base,
        shown_images: shownPipe,
        ...extra,
        field_key: '',
        field_type: 'answer',
        x: '', y: '', t: '', label: '', seq: '',
        choice_key: '', choice_label: '', points: '',
        rank: '', option: '', value: '',
        answer_json: raw != null ? JSON.stringify(raw) : '',
      });
      const schema = Array.isArray(question.skillResultSchema) ? question.skillResultSchema : [];
      const ansObj = (answer && typeof answer === 'object' && !Array.isArray(answer)) ? answer : {};
      schema.forEach((field) => {
        if (!field?.key || !field?.type) return;
        const val = ansObj[field.key];
        if (val == null) return;
        if (field.type === 'points' && Array.isArray(val)) {
          val.forEach((p, idx) => {
            if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return;
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: 'points',
              x: Number(p.x),
              y: Number(p.y),
              t: p.t != null ? Number(p.t) : '',
              label: p.label != null ? String(p.label) : '',
              seq: idx,
              choice_key: '', choice_label: '', points: '',
              rank: '', option: '', value: '',
              answer_json: '',
            });
          });
        } else if (field.type === 'path' && Array.isArray(val)) {
          val.forEach((p, idx) => {
            if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return;
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: 'path',
              x: Number(p.x),
              y: Number(p.y),
              t: p.t != null ? Number(p.t) : '',
              label: '',
              seq: idx,
              choice_key: '', choice_label: '', points: '',
              rank: '', option: '', value: '',
              answer_json: '',
            });
          });
        } else if ((field.type === 'polygon' || field.type === 'bbox' || field.type === 'box') && Array.isArray(val)) {
          const fType = field.type === 'box' ? 'bbox' : field.type;
          const pts = val.filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
          const usePts = fType === 'bbox' ? pts.slice(0, 2) : pts;
          usePts.forEach((p, idx) => {
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: fType,
              x: Number(p.x),
              y: Number(p.y),
              t: '',
              label: p.label != null ? String(p.label) : '',
              seq: idx,
              choice_key: '', choice_label: '', points: '',
              rank: '', option: '', value: '',
              answer_json: '',
            });
          });
        } else if (field.type === 'allocation' && val && typeof val === 'object' && !Array.isArray(val)) {
          Object.entries(val).forEach(([k, v]) => {
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: 'allocation',
              x: '', y: '', t: '', label: '', seq: '',
              choice_key: k,
              choice_label: k,
              points: Number(v),
              rank: '', option: '', value: '',
              answer_json: '',
            });
          });
        } else if ((field.type === 'rankedList' || field.type === 'mediaRankedList') && Array.isArray(val)) {
          const order = val.map((x) => String(x));
          const pipe = order.join('|');
          order.forEach((opt, idx) => {
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: field.type,
              x: '', y: '', t: '', label: '', seq: '',
              choice_key: '', choice_label: '', points: '',
              rank: idx + 1,
              option: opt,
              value: pipe,
              answer_json: '',
            });
          });
        } else if (field.type === 'multiChoice' && Array.isArray(val)) {
          val.forEach((opt) => {
            if (opt == null || String(opt).trim() === '') return;
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: 'multiChoice',
              x: '', y: '', t: '', label: '', seq: '',
              choice_key: '', choice_label: '', points: '',
              rank: '',
              option: String(opt),
              value: '',
              answer_json: '',
            });
          });
        } else if (field.type === 'mediaChoice' && (typeof val === 'string' || typeof val === 'number')) {
          objects.push({
            ...base,
            shown_images: shownPipe,
            ...extra,
            field_key: field.key,
            field_type: 'mediaChoice',
            x: '', y: '', t: '', label: '', seq: '',
            choice_key: '', choice_label: '', points: '',
            rank: '',
            option: String(val),
            value: String(val),
            answer_json: '',
          });
        } else if (field.type === 'matrix') {
          if (Array.isArray(val)) {
            val.forEach((c, idx) => {
              if (!c || typeof c !== 'object') return;
              const row = String(c.row ?? c.row_key ?? c.rowKey ?? '');
              const col = String(c.column ?? c.col ?? c.value ?? '');
              objects.push({
                ...base,
                shown_images: shownPipe,
                ...extra,
                field_key: field.key,
                field_type: 'matrix',
                x: '', y: '', t: '', label: '', seq: idx,
                choice_key: row,
                choice_label: row,
                points: Number.isFinite(Number(c.value)) ? Number(c.value) : '',
                rank: '',
                option: col,
                value: col,
                answer_json: '',
              });
            });
          } else if (val && typeof val === 'object') {
            Object.entries(val).forEach(([row, col], idx) => {
              objects.push({
                ...base,
                shown_images: shownPipe,
                ...extra,
                field_key: field.key,
                field_type: 'matrix',
                x: '', y: '', t: '', label: '', seq: idx,
                choice_key: row,
                choice_label: row,
                points: Number.isFinite(Number(col)) ? Number(col) : '',
                rank: '',
                option: String(col),
                value: String(col),
                answer_json: '',
              });
            });
          }
        } else if (field.type === 'timeRanges') {
          const segs = Array.isArray(val)
            ? val
            : (val && typeof val === 'object' ? (val.segments || val.ranges || []) : []);
          (segs || []).forEach((s, idx) => {
            if (!s || !Number.isFinite(Number(s.start ?? s.begin))) return;
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: 'timeRanges',
              x: Number(s.start ?? s.begin),
              y: Number(s.end ?? s.stop ?? s.start ?? s.begin),
              t: '',
              label: s.label != null ? String(s.label) : '',
              seq: idx,
              choice_key: '', choice_label: '', points: '',
              rank: '', option: '', value: '',
              answer_json: '',
            });
          });
        } else if (field.type === 'timeSeries') {
          const samples = Array.isArray(val)
            ? val
            : (val && typeof val === 'object' ? (val.samples || val.series || []) : []);
          (samples || []).forEach((s, idx) => {
            if (!s) return;
            const t = Number(s.t ?? s.time);
            const v = Number(s.v ?? s.value);
            if (!Number.isFinite(t) || !Number.isFinite(v)) return;
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: 'timeSeries',
              x: t,
              y: v,
              t,
              label: '',
              seq: idx,
              choice_key: '', choice_label: '', points: v,
              rank: '', option: '', value: v,
              answer_json: '',
            });
          });
        } else if (field.type === 'pairwise' || field.type === 'pairwisePreference') {
          const pref = typeof val === 'number'
            ? val
            : Number(val?.preference ?? val?.score ?? val?.value);
          if (Number.isFinite(pref)) {
            objects.push({
              ...base,
              shown_images: shownPipe,
              ...extra,
              field_key: field.key,
              field_type: 'pairwisePreference',
              x: '', y: '', t: '', label: '', seq: '',
              choice_key: val?.hardToDecide ? 'hard' : '',
              choice_label: '',
              points: '',
              rank: '',
              option: [val?.imageA, val?.imageB].filter(Boolean).map(String).join('|'),
              value: pref,
              answer_json: '',
            });
          }
        } else if (field.type === 'pairwiseChoice' && val && typeof val === 'object') {
          objects.push({
            ...base,
            shown_images: shownPipe,
            ...extra,
            field_key: field.key,
            field_type: 'pairwiseChoice',
            x: '', y: '', t: '', label: '', seq: '',
            choice_key: String(val.loser ?? ''),
            choice_label: 'loser',
            points: '', rank: '',
            option: String(val.winner ?? val.choice ?? val.chosenIndex ?? ''),
            value: String(val.winner ?? val.choice ?? val.chosenIndex ?? ''),
            answer_json: '',
          });
        } else if (field.type === 'bestWorst' && val && typeof val === 'object') {
          objects.push({
            ...base,
            shown_images: shownPipe,
            ...extra,
            field_key: field.key,
            field_type: 'bestWorst',
            x: '', y: '', t: '', label: '', seq: '',
            choice_key: String(val.worst ?? val.worstUrl ?? val.worstIndex ?? ''),
            choice_label: 'worst',
            points: '',
            rank: '',
            option: String(val.best ?? val.bestUrl ?? val.bestIndex ?? ''),
            value: 'best',
            answer_json: '',
          });
        } else {
          // Scalar and novel fields are first-class long rows too. The raw
          // answer_json row above is always retained for lossless recovery.
          const scalar = val && typeof val === 'object' ? JSON.stringify(val) : val;
          objects.push({
            ...base,
            shown_images: shownPipe,
            ...extra,
            field_key: field.key,
            field_type: field.type,
            x: '', y: '', t: '', label: '', seq: '',
            choice_key: '', choice_label: '', points: '', rank: '',
            option: ['choice', 'mediaChoice', 'boolean'].includes(field.type) ? String(val) : '',
            value: scalar,
            answer_json: '',
          });
        }
      });
    } else if (fam === 'annotation') {
      const ann = (answer && typeof answer === 'object') ? answer : null;
      // Stimulus media is already in shown_*; rows carry annotation answer only.
      if (ann?.shapes?.length) {
        ann.shapes.forEach((shape) => {
          objects.push({
            ...base,
            ...extra,
            tool: inferShapeTool(shape),
            label: shape.label || '',
            annotation_json: JSON.stringify(shape),
          });
        });
      } else {
        objects.push({
          ...base,
          ...extra,
          tool: '',
          label: '',
          annotation_json: JSON.stringify(ann || answer),
        });
      }
    } else {
      objects.push({
        ...base,
        ...extra,
        text: typeof answer === 'object' ? JSON.stringify(answer) : String(answer),
      });
    }
    } // end payloads loop
  }

  return objects;
}

// ─── Summary builders ─────────────────────────────────────────────────────────

function buildSummaryObjects(question, responses) {
  const type = question.type || '';
  const fam = exportFamilyForQuestion(question);
  const forcedChoice = isForcedChoiceSkill(question.skillId);
  const eligible = responsesEligibleForQuestion(question.name, responses);
  const longObjs = buildLongObjects(question, responses, null);
  const nResponses = new Set(
    longObjs.map((r) => `${r.participant_id}|${r.session_id}|${r.attempt_index}|${r.created_at}`),
  ).size || eligible.filter((row) => parsePayload(row, question.name)).length;

  const out = [];

  if (fam === 'scalar') {
    const nums = longObjs.map((r) => Number(r.value)).filter((n) => !Number.isNaN(n));
    pushStats(out, question, nResponses, 'overall', 'overall', nums);
    const freq = {};
    nums.forEach((n) => { freq[n] = (freq[n] || 0) + 1; });
    Object.entries(freq).forEach(([k, count]) => {
      out.push(summaryRow(question, nResponses, k, k, 'count', count, nResponses));
      out.push(summaryRow(question, nResponses, k, k, 'pct', nResponses ? count / nResponses : 0, nResponses));
    });
  } else if (fam === 'boolean') {
    let yes = 0;
    let no = 0;
    longObjs.forEach((r) => {
      if (r.value_norm === 1 || r.value_norm === '1') yes += 1;
      else if (r.value_norm === 0 || r.value_norm === '0') no += 1;
    });
    const total = yes + no;
    out.push(summaryRow(question, nResponses, 'yes', 'yes', 'count', yes, total));
    out.push(summaryRow(question, nResponses, 'no', 'no', 'count', no, total));
    out.push(summaryRow(question, nResponses, 'yes', 'yes', 'yes_rate', total ? yes / total : 0, total));
    out.push(summaryRow(question, nResponses, 'overall', 'overall', 'count', total, total));
  } else if (fam === 'choice') {
    const freq = {};
    longObjs.forEach((r) => {
      const k = String(r.value ?? '');
      if (!freq[k]) freq[k] = { count: 0, label: r.label || k };
      freq[k].count += 1;
    });
    const denom = type === 'checkbox' ? nResponses : longObjs.length;
    Object.entries(freq).forEach(([k, { count, label }]) => {
      out.push(summaryRow(question, nResponses, k, label, 'count', count, denom));
      out.push(summaryRow(question, nResponses, k, label, 'pct', denom ? count / denom : 0, denom));
    });
  } else if (fam === 'text') {
    const texts = longObjs.map((r) => String(r.text || '')).filter(Boolean);
    out.push(summaryRow(question, nResponses, 'overall', 'overall', 'count', texts.length, texts.length));
    const lengths = texts.map((t) => t.length);
    pushStats(out, question, nResponses, 'length_chars', 'length_chars', lengths);
  } else if (fam === 'matrix') {
    const freq = {};
    longObjs.forEach((r) => {
      const key = `${r.row_key}||${r.column_key}`;
      if (!freq[key]) {
        freq[key] = {
          row_key: r.row_key,
          column_key: r.column_key,
          label: `${r.row_label}|${r.column_label}`,
          count: 0,
        };
      }
      freq[key].count += 1;
    });
    Object.values(freq).forEach((f) => {
      const unit = `${f.row_key}__${f.column_key}`;
      out.push(summaryRow(question, nResponses, unit, f.label, 'count', f.count, nResponses));
      out.push(summaryRow(question, nResponses, unit, f.label, 'pct', nResponses ? f.count / nResponses : 0, nResponses));
    });
  } else if (fam === 'image_matrix') {
    // attribute_* = matrix row; unit_* = image only (no image__attr join keys).
    const byUnit = {}; // `${img}||${attr}` → { img, attr, attrLabel, colCounts, nums }
    const declaredCols = (question.columns || []).map((c) => (
      typeof c === 'object' && c !== null ? String(c.value) : String(c)
    )).filter(Boolean);

    longObjs.forEach((r) => {
      const img = shownKeysFromLongRow(r)[0] || '(no_media)';
      const attr = String(r.row_key ?? '');
      if (!attr) return;
      const key = `${img}||${attr}`;
      if (!byUnit[key]) {
        byUnit[key] = {
          img,
          attr,
          attrLabel: r.row_label || attr,
          colCounts: {},
          nums: [],
        };
      }
      const col = String(r.column_key ?? r.value ?? '');
      if (!col) return;
      byUnit[key].colCounts[col] = (byUnit[key].colCounts[col] || 0) + 1;
      const num = Number(col);
      if (!Number.isNaN(num)) byUnit[key].nums.push(num);
    });

    Object.values(byUnit).forEach((block) => {
      const total = Object.values(block.colCounts).reduce((s, v) => s + v, 0);
      if (!total) return;
      const { img, attr, attrLabel } = block;

      if (block.nums.length === total) {
        pushStats(out, question, nResponses, img, img, block.nums, attr, attrLabel);
      } else {
        out.push(summaryRow(question, nResponses, img, img, 'count', total, total, attr, attrLabel));
      }

      const cols = declaredCols.length
        ? declaredCols
        : Object.keys(block.colCounts).sort();
      cols.forEach((col) => {
        const c = block.colCounts[col] || 0;
        out.push(summaryRow(
          question,
          nResponses,
          img,
          img,
          `pct_${col}`,
          total ? c / total : 0,
          total,
          attr,
          attrLabel,
        ));
      });
    });
  } else if (fam === 'ranking' || fam === 'image_ranking') {
    if (type === 'ranking') {
      const rankPositions = {};
      const rankingLists = [];
      for (const row of eligible) {
        const payload = parsePayload(row, question.name);
        if (!payload) continue;
        const ranked = Array.isArray(payload.answer) ? payload.answer : [];
        if (ranked.length) rankingLists.push(ranked.map(String));
        ranked.forEach((val, idx) => {
          const k = String(val);
          if (!rankPositions[k]) rankPositions[k] = [];
          rankPositions[k].push(idx + 1);
        });
      }
      const items = Object.keys(rankPositions);
      const bordaMap = computeBordaScores(rankPositions, items.length);
      const w = kendallW(rankingLists, items);
      if (w != null) {
        out.push(summaryRow(question, nResponses, 'overall', 'overall', 'kendall_w', w, nResponses));
      }
      const labels = choiceLabelMap(question.choices);
      const sorted = Object.entries(rankPositions)
        .map(([val, ranks]) => ({
          val,
          avg: average(ranks),
          borda: bordaMap[val]?.borda,
          n: ranks.length,
        }))
        .sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));
      sorted.forEach((row, idx) => {
        const label = labels[row.val] || row.val;
        out.push(summaryRow(question, nResponses, row.val, label, 'rank', idx + 1, row.n));
        out.push(summaryRow(question, nResponses, row.val, label, 'avg_rank', row.avg, row.n));
        out.push(summaryRow(question, nResponses, row.val, label, 'borda', row.borda, row.n));
        out.push(summaryRow(question, nResponses, row.val, label, 'count', row.n, row.n));
      });
    } else {
      // image / media ranking → TrueSkill + classical
      const imageRankPositions = {};
      const rankingLists = [];
      const allMatches = [];
      for (const row of eligible) {
        const payload = parsePayload(row, question.name);
        if (!payload) continue;
        const ranked = Array.isArray(payload.answer) ? payload.answer : [];
        const keys = ranked
          .map((val) => resolveImageChoiceKey(val, payload.shownImages))
          .filter(Boolean);
        if (keys.length < 2) continue;
        rankingLists.push(keys);
        allMatches.push(...matchesFromOrderedRanking(keys));
        keys.forEach((key, rankIdx) => {
          if (!imageRankPositions[key]) imageRankPositions[key] = [];
          imageRankPositions[key].push(rankIdx + 1);
        });
      }
      const items = Object.keys(imageRankPositions);
      const w = kendallW(rankingLists, items);
      const bordaMap = computeBordaScores(imageRankPositions, items.length);
      const { rankings: tsRows } = computeTrueSkillFromMatches(allMatches);
      if (w != null) {
        out.push(summaryRow(question, nResponses, 'overall', 'overall', 'kendall_w', w, nResponses));
      }
      const byKey = new Map((tsRows || []).map((r) => [r.imageKey, r]));
      items.forEach((key) => {
        const ranks = imageRankPositions[key] || [];
        const avg = ranks.length ? average(ranks) : null;
        const ts = byKey.get(key);
        out.push(summaryRow(question, nResponses, key, key, 'avg_rank', avg, ranks.length));
        out.push(summaryRow(question, nResponses, key, key, 'borda', bordaMap[key]?.borda, ranks.length));
        out.push(summaryRow(question, nResponses, key, key, 'count', ranks.length, ranks.length));
        if (ts?.mu != null) {
          out.push(summaryRow(question, nResponses, key, key, 'mu', ts.mu, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'sigma', ts.sigma, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'mu_std5', ts.muStd5, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'wins', ts.wins, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'losses', ts.losses, ranks.length));
          out.push(summaryRow(question, nResponses, key, key, 'games', ts.games, ranks.length));
        }
      });
      const rankedByMu = [...(tsRows || [])].sort((a, b) => (b.mu ?? -Infinity) - (a.mu ?? -Infinity));
      rankedByMu.forEach((r, idx) => {
        out.push(summaryRow(question, nResponses, r.imageKey, r.imageKey, 'rank', idx + 1, r.games));
      });
    }
  } else if (fam === 'image_rating') {
    const perImage = {};
    longObjs.forEach((r) => {
      const num = Number(r.value);
      if (Number.isNaN(num)) return;
      const keys = shownKeysFromLongRow(r);
      (keys.length ? keys : ['(no_media)']).forEach((key) => {
        if (!perImage[key]) perImage[key] = [];
        perImage[key].push(num);
      });
    });
    Object.entries(perImage).forEach(([key, nums]) => {
      pushStats(out, question, nResponses, key, key, nums);
    });
  } else if (fam === 'image_boolean') {
    const perImage = {};
    longObjs.forEach((r) => {
      const keys = shownKeysFromLongRow(r);
      (keys.length ? keys : ['(no_media)']).forEach((key) => {
        if (!perImage[key]) perImage[key] = { yes: 0, no: 0 };
        if (r.value_norm === 1 || r.value_norm === '1') perImage[key].yes += 1;
        else perImage[key].no += 1;
      });
    });
    Object.entries(perImage).forEach(([key, { yes, no }]) => {
      const total = yes + no;
      out.push(summaryRow(question, nResponses, key, key, 'yes_rate', total ? yes / total : 0, total));
      out.push(summaryRow(question, nResponses, key, key, 'count', total, total));
      out.push(summaryRow(question, nResponses, `${key}__yes`, key, 'count', yes, total));
      out.push(summaryRow(question, nResponses, `${key}__no`, key, 'count', no, total));
    });
  } else if (fam === 'image_checkbox') {
    // unit = stimulus; attribute = tag; denom = answer units for that stimulus
    const nByUnit = {};
    collectAnswerUnits(eligible, question.name).forEach(({ shown_images: shown }) => {
      const keys = (shown || []).map((s) => mediaFilenameKey(typeof s === 'string' ? s : (s?.url || s))).filter(Boolean);
      (keys.length ? keys : ['(no_media)']).forEach((unit) => {
        nByUnit[unit] = (nByUnit[unit] || 0) + 1;
      });
    });
    const counts = {};
    longObjs.forEach((r) => {
      const tag = String(r.value || '');
      if (!tag) return;
      const stims = shownKeysFromLongRow(r);
      (stims.length ? stims : ['(no_media)']).forEach((unit) => {
        const key = `${unit}||${tag}`;
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    Object.entries(counts).forEach(([key, count]) => {
      const [unit, tag] = key.split('||');
      const n = nByUnit[unit] || nResponses;
      out.push(summaryRow(question, nResponses, unit, unit, 'select_count', count, n, tag, tag));
      out.push(summaryRow(question, nResponses, unit, unit, 'select_rate', n ? count / n : 0, n, tag, tag));
    });
  } else if (fam === 'imagepicker') {
    const { rankings } = forcedChoice
      ? computeForcedChoiceTrueSkill(eligible, question.name)
      : computeQuestionTrueSkill(eligible, question.name);
    pushTrueSkillSummary(out, question, nResponses, rankings, longObjs);
  } else if (fam === 'maxdiff') {
    pushMaxDiffSummary(out, question, nResponses, eligible);
  } else if (fam === 'video_moments') {
    pushVideoMomentSummary(out, question, eligible);
  } else if (fam === 'pairwise_slider') {
    pushPairwiseSliderSummary(out, question, eligible);
  } else if (fam === 'emotion_color') {
    pushEmotionColorSummary(out, question, eligible);
  } else if (fam === 'continuous_video') {
    pushContinuousVideoSummary(out, question, eligible);
  } else if (fam === 'composite_blocks') {
    pushCompositeBlocksSummary(out, question, eligible);
  } else if (fam === 'image_slider') {
    // attribute_* = slider dimension; unit_* = image only (no image__dim join keys).
    const byUnit = {}; // `${img}||${attr}` → { img, attr, attrLabel, nums }
    longObjs.forEach((r) => {
      const img = shownKeysFromLongRow(r)[0] || '(no_media)';
      const attr = String(r.dimension_id ?? '');
      if (!attr) return;
      const key = `${img}||${attr}`;
      if (!byUnit[key]) {
        byUnit[key] = {
          img,
          attr,
          attrLabel: r.dimension_label || attr,
          nums: [],
        };
      }
      const num = Number(r.value);
      if (!Number.isNaN(num)) byUnit[key].nums.push(num);
    });
    Object.values(byUnit).forEach((block) => {
      pushStats(
        out,
        question,
        nResponses,
        block.img,
        block.img,
        block.nums,
        block.attr,
        block.attrLabel,
      );
    });
  } else if (fam === 'slider') {
    const byDim = {};
    longObjs.forEach((r) => {
      const id = r.dimension_id;
      if (!id) return;
      if (!byDim[id]) byDim[id] = { label: r.dimension_label || id, nums: [] };
      const num = Number(r.value);
      if (!Number.isNaN(num)) byDim[id].nums.push(num);
    });
    Object.entries(byDim).forEach(([id, { label, nums }]) => {
      pushStats(out, question, nResponses, id, label, nums);
    });
  } else if (fam === 'image_points') {
    // attribute_* = allocation choice; unit_* = image only (no image__choice join keys).
    const byUnit = {}; // `${img}||${attr}` → { img, attr, attrLabel, nums }
    longObjs.forEach((r) => {
      const img = shownKeysFromLongRow(r)[0] || '(no_media)';
      const attr = String(r.choice_key ?? '');
      if (!attr) return;
      const key = `${img}||${attr}`;
      if (!byUnit[key]) {
        byUnit[key] = {
          img,
          attr,
          attrLabel: r.choice_label || attr,
          nums: [],
        };
      }
      const num = Number(r.points);
      if (!Number.isNaN(num)) byUnit[key].nums.push(num);
    });
    Object.values(byUnit).forEach((block) => {
      pushStats(
        out,
        question,
        nResponses,
        block.img,
        block.img,
        block.nums,
        block.attr,
        block.attrLabel,
      );
    });
  } else if (fam === 'points') {
    const byChoice = {};
    longObjs.forEach((r) => {
      const id = r.choice_key;
      if (!id) return;
      if (!byChoice[id]) byChoice[id] = { label: r.choice_label || id, nums: [] };
      const num = Number(r.points);
      if (!Number.isNaN(num)) byChoice[id].nums.push(num);
    });
    Object.entries(byChoice).forEach(([id, { label, nums }]) => {
      pushStats(out, question, nResponses, id, label, nums);
    });
  } else if (fam === 'skill') {
    pushGenericSkillSummary(out, question, eligible, longObjs);
  } else if (fam === 'annotation') {
    // Two dimensions: label and tool. unit_* = image (no join keys).
    const byImgLabel = {}; // `${img}||${label}` → count
    const byImgTool = {}; // `${img}||${tool}` → count
    let shapeCount = 0;

    longObjs.forEach((r) => {
      let shape = null;
      try {
        shape = r.annotation_json ? JSON.parse(r.annotation_json) : null;
      } catch {
        shape = null;
      }
      const tool = normalizeAnnotationTool(r.tool) || (shape ? inferShapeTool(shape) : '');
      const hasShape = !!(shape?.points?.length || tool || r.label);
      if (!hasShape) return;
      shapeCount += 1;
      const img = shownKeysFromLongRow(r)[0] || '(no_media)';
      const label = String(r.label || '').trim() || '(unlabeled)';
      const labelKey = `${img}||${label}`;
      byImgLabel[labelKey] = (byImgLabel[labelKey] || 0) + 1;
      if (tool) {
        const toolKey = `${img}||${tool}`;
        byImgTool[toolKey] = (byImgTool[toolKey] || 0) + 1;
      }
    });

    out.push(summaryRow(question, nResponses, 'overall', 'overall', 'count', shapeCount, nResponses));

    Object.entries(byImgLabel).forEach(([key, count]) => {
      const [img, label] = key.split('||');
      out.push(summaryRow(
        question,
        nResponses,
        img,
        img,
        'label_count',
        count,
        count,
        label,
        label,
      ));
    });

    Object.entries(byImgTool).forEach(([key, count]) => {
      const [img, tool] = key.split('||');
      out.push(summaryRow(
        question,
        nResponses,
        img,
        img,
        'tool_count',
        count,
        count,
        tool,
        annotationToolLabel(tool),
      ));
    });
  }

  return out;
}

// ─── Public file builders ─────────────────────────────────────────────────────

function singleNativeSkillField(question) {
  if (question?.type !== 'skillquestion' || !Array.isArray(question.skillResultSchema)) return null;
  if (isForcedChoiceSkill(question.skillId) || isMaxDiffSkill(question.skillId)
    || isVideoMomentSkill(question.skillId) || isPairwiseSliderSkill(question.skillId)
    || isEmotionColorSkill(question.skillId) || isContinuousVideoSkill(question.skillId)
    || isCompositeBlocksSkill(question.skillId)) return null;
  const fields = question.skillResultSchema.filter((field) => skillFieldNativeQuestion(question, field));
  return fields.length === 1 ? fields[0] : null;
}

/** Pure long-table builder shared by Admin export and the Worker/MCP. */
export function buildQuestionLongTable(question, responses, surveyConfig) {
  if (!question?.name || isDisplayOnly(question)) return null;
  const field = singleNativeSkillField(question);
  if (field) {
    const adapted = adaptResponsesForSkillField(question, field, responses);
    return buildQuestionLongTable(adapted.question, adapted.responses, surveyConfig);
  }
  const headers = longHeadersForType(question.type, question);
  return { headers, rows: buildLongObjects(question, responses, surveyConfig) };
}

/** Pure typed summary rows shared by Admin export and the Worker/MCP. */
export function buildQuestionSummaryRows(question, responses) {
  if (!question?.name || isDisplayOnly(question)) return null;
  const field = singleNativeSkillField(question);
  if (field) {
    const adapted = adaptResponsesForSkillField(question, field, responses);
    return buildQuestionSummaryRows(adapted.question, adapted.responses);
  }
  return buildSummaryObjects(question, responses);
}

export function buildQuestionLongCsv(question, responses, surveyConfig) {
  const table = buildQuestionLongTable(question, responses, surveyConfig);
  return table ? objectsToCsv(table.headers, table.rows) : null;
}

export function buildQuestionSummaryCsv(question, responses) {
  const rows = buildQuestionSummaryRows(question, responses);
  return rows ? objectsToCsv(SUMMARY_HEADERS, rows) : null;
}

function safeFileToken(raw) {
  return String(raw || 'attr').replace(/[^\w.-]+/g, '_').replace(/^_|_$/g, '') || 'attr';
}

/**
 * @returns {{ path: string, content: string }[] | null}
 */
export function buildQuestionExportFiles(question, responses, surveyConfig, { pathPrefix = 'questions' } = {}) {
  if (!question?.name || isDisplayOnly(question)) return null;
  const longCsv = buildQuestionLongCsv(question, responses, surveyConfig);
  const summaryObjects = buildQuestionSummaryRows(question, responses) || [];
  if (!longCsv && !summaryObjects.length) return null;
  const name = question.name;
  const files = [
    {
      path: `${pathPrefix}/${name}__long.csv`,
      content: longCsv || objectsToCsv(longHeadersForType(question.type, question), []),
    },
    {
      path: `${pathPrefix}/${name}__summary.csv`,
      content: buildQuestionSummaryCsv(question, responses) || objectsToCsv(SUMMARY_HEADERS, []),
    },
  ];

  // Strict native-parity Skills have exactly one mapped field: their primary
  // long/summary files above are already byte-for-byte native-family output.
  // Extra per-field/raw files are retained only for historical multi-field Skills.
  if (question.type === 'skillquestion' && Array.isArray(question.skillResultSchema)
    && !singleNativeSkillField(question)) {
    const nativeFields = question.skillResultSchema
      .map((field) => ({ field, ...adaptResponsesForSkillField(question, field, responses) }))
      .filter((entry) => entry.question);
    nativeFields.forEach(({ field, question: nativeQuestion, responses: nativeResponses }) => {
      const token = safeFileToken(field.key);
      files.push({
        path: `${pathPrefix}/${question.name}__field__${token}__long.csv`,
        content: buildQuestionLongCsv(nativeQuestion, nativeResponses, surveyConfig),
      });
      files.push({
        path: `${pathPrefix}/${question.name}__field__${token}__summary.csv`,
        content: buildQuestionSummaryCsv(nativeQuestion, nativeResponses),
      });
    });
    // Lossless recovery is separate from the native-format field tables.
    files.push({
      path: `${pathPrefix}/${question.name}__raw_json.csv`,
      content: objectsToCsv(longHeadersForType(question.type, question), buildLongObjects(question, responses, surveyConfig)),
    });
  }

  // Image/media matrix, slider, point allocation: one summary "tab" file per attribute (unit = image only).
  // Annotation: one file per label and per tool (unit = image only).
  const fam = exportFamilyForQuestion(question);
  if (fam === 'image_matrix' || fam === 'image_slider' || fam === 'image_points') {
    const byAttr = new Map();
    summaryObjects.forEach((row) => {
      const ak = row.attribute_key;
      if (!ak) return;
      if (!byAttr.has(ak)) byAttr.set(ak, []);
      byAttr.get(ak).push(row);
    });
    byAttr.forEach((rows, attrKey) => {
      const label = rows[0]?.attribute_label || attrKey;
      const token = safeFileToken(attrKey);
      files.push({
        path: `${pathPrefix}/${name}__summary__${token}.csv`,
        content: objectsToCsv(SUMMARY_HEADERS, rows),
        // hint for manifest consumers
        attribute_key: attrKey,
        attribute_label: label,
      });
    });
  } else if (fam === 'annotation') {
    const byDim = new Map(); // `${kind}||${attrKey}` → rows
    summaryObjects.forEach((row) => {
      const ak = row.attribute_key;
      if (!ak) return;
      let kind = null;
      if (row.metric === 'label_count') kind = 'label';
      else if (row.metric === 'tool_count') kind = 'tool';
      if (!kind) return;
      const mapKey = `${kind}||${ak}`;
      if (!byDim.has(mapKey)) byDim.set(mapKey, []);
      byDim.get(mapKey).push(row);
    });
    byDim.forEach((rows, mapKey) => {
      const [kind, attrKey] = mapKey.split('||');
      const label = rows[0]?.attribute_label || attrKey;
      const token = safeFileToken(attrKey);
      files.push({
        path: `${pathPrefix}/${name}__summary__${kind}__${token}.csv`,
        content: objectsToCsv(SUMMARY_HEADERS, rows),
        attribute_key: attrKey,
        attribute_label: label,
        dimension: kind,
      });
    });
  }

  return files;
}

export function downloadQuestionExportZip(question, responses, surveyConfig) {
  const files = buildQuestionExportFiles(question, responses, surveyConfig);
  if (!files?.length) return;
  const date = exportDateStamp();
  downloadZip(`${question.name}_${date}.zip`, files);
}

export function buildDataQualityCsv(responses, surveyConfig, { excludeFlagged = true, includedKeys = null } = {}) {
  const headers = [
    'participant_id',
    'created_at',
    'session_id',
    'practice_mode',
    'duration_seconds',
    'flag_codes',
    'flag_labels',
    'included_in_analysis',
  ];
  const includedSet = includedKeys instanceof Set
    ? includedKeys
    : null;

  const objects = (responses || []).map((row) => {
    const flags = surveyConfig
      ? evaluateResponseQuality(row, surveyConfig, responses)
      : [];
    let included = true;
    if (includedSet) {
      included = includedSet.has(responseKey(row));
    } else if (excludeFlagged && flags.length) {
      included = false;
    }
    return {
      participant_id: row.participant_id || '',
      created_at: row.created_at || row.survey_metadata?.completion_time || '',
      session_id: row.survey_metadata?.session_id || '',
      practice_mode: row.survey_metadata?.practice_mode ? 'true' : 'false',
      duration_seconds: row.survey_metadata?.timing?.total_seconds ?? '',
      flag_codes: flags.join('|'),
      flag_labels: flags.map((f) => QUALITY_FLAG_LABELS[f] || f).join('|'),
      included_in_analysis: included ? 'true' : 'false',
    };
  });
  return objectsToCsv(headers, objects);
}

function responseKey(row) {
  return String(row.id ?? `${row.participant_id}|${row.created_at}|${row.survey_metadata?.session_id}`);
}

export function buildManifest({
  project,
  questions,
  responses,
  filters,
  questionFiles,
}) {
  return {
    project_id: project?.id || null,
    project_name: project?.name || null,
    exported_at: new Date().toISOString(),
    filters: filters || {},
    n_responses_in_export: (responses || []).length,
    questions: (questions || [])
      .filter((q) => q?.name && !isDisplayOnly(q))
      .map((q) => {
        const contractWarnings = [];
        if (q.type === 'skillquestion') {
          let mismatch = 0;
          collectAnswerUnits(responses || [], q.name).forEach(({ answer }) => {
            const normalized = answer && typeof answer === 'object' && !Array.isArray(answer)
              ? answer : { value: answer };
            const check = checkAnswerAgainstResultSchema(normalized, q.skillResultSchema || []);
            if (!check.recorded || check.fields.some((field) => !field.ok)) mismatch += 1;
          });
          if (mismatch) contractWarnings.push(`contract_mismatch: ${mismatch} trial(s)`);
          if (!q.skillResultSchema?.length) contractWarnings.push('missing_contract: schema inference/raw fallback used');
        }
        return {
          name: q.name,
          type: q.type || '',
          title: q.title || q.name,
          ...(q.type === 'skillquestion' ? {
            skill_id: q.skillId || null,
            skill_revision: q.skillRevision || null,
            skill_contract_version: q.skillContractVersion || null,
            skill_result_schema: q.skillResultSchema || [],
            warnings: contractWarnings,
          } : {}),
          files: [
            `questions/${q.name}__long.csv`,
            `questions/${q.name}__summary.csv`,
          ],
        };
      }),
    files: (questionFiles || []).map((f) => f.path),
  };
}

export function buildExportReadme({ project, filters, nResponses, questionCount }) {
  const lines = [
    'SP Survey Platform — Results export',
    '====================================',
    '',
    `Project: ${project?.name || project?.id || '(unknown)'}`,
    `Exported: ${new Date().toISOString()}`,
    `Responses in export: ${nResponses}`,
    `Answerable questions: ${questionCount}`,
    '',
    'Filters',
    '-------',
    `date_from: ${filters?.date_from || '(none)'}`,
    `date_to: ${filters?.date_to || '(none)'}`,
    `session_id: ${filters?.session_id || '(all)'}`,
    `include_practice: ${filters?.include_practice}`,
    `exclude_flagged: ${filters?.exclude_flagged}`,
    '',
    'Layout',
    '------',
    'responses_wide.csv     One row per participant/submission',
    'data_quality.csv       Quality flags per response',
    'methods.txt            Methods narrative',
    'references.bib         Bibliography (if available)',
    'manifest.json          Machine-readable export metadata',
    'questions/{name}__long.csv      Tidy long answers for one question',
    'questions/{name}__summary.csv   All attributes together',
    'questions/{name}__summary__{attribute}.csv',
    '  → imagematrix / imageslidergroup / imagepointallocation (+ media*):',
    '    one file per attribute tab (unit = image only)',
    'questions/{name}__summary__label__{label}.csv',
    'questions/{name}__summary__tool__{tool}.csv',
    '  → imageannotation: one file per label and per drawing tool (unit = image only)',
    '',
    'Summary schema',
    '--------------',
    SUMMARY_HEADERS.join(', '),
    '',
    '  attribute_key / attribute_label  → matrix row / slider dim / allocation choice /',
    '                                    annotation label or tool (empty when N/A)',
    '  unit_key / unit_label            → image or choice — not image__attr joins',
    '',
    'Long schema prefix (all question types)',
    '---------------------------------------',
    LONG_PREFIX.join(', '),
    '',
    'Long columns: shown_* = stimulus; extras = answer only',
    '-------------------------------------------------------',
    'shown_images / shown_media_set / shown_media_categories',
    '  → what was displayed for that row/trial (filenames / set / category tags)',
    '  Internal media_id keys are not exported (use shown_images for analysis).',
    'choice: value, label',
    'matrix (text): row_key, column_key, value',
    'imagematrix / mediamatrix long: row/column cells + shown_images',
    'imagematrix / mediamatrix summary: attribute_* = row; unit_* = image; metrics = count/mean/… + pct_<column>',
    'imageslidergroup / mediaslidergroup long: dimension_id + value + shown_images',
    'imageslidergroup / mediaslidergroup summary: attribute_* = dimension; unit_* = image; metrics = mean/sd/…',
    'imagepointallocation / mediapointallocation long: choice_key + points + shown_images',
    'imagepointallocation / mediapointallocation summary: attribute_* = choice; unit_* = image; metrics = mean/sd/…',
    'text ranking: value, label  (pipe-ordered; label = choice text when set)',
    'image/media ranking: value only  (pipe-ordered filenames; no separate image labels)',
    'imagerating* / imageboolean*: value (and value_norm for boolean)',
    'imagepicker*: value = chosen media key (options are in shown_*)',
    'Forced-Choice A/B (skill): same long/summary as imagepicker (value = chosen key; TrueSkill μ/σ/wins/…)',
    'Best–Worst MaxDiff (skill) long: best, worst (= media keys; one row per trial)',
    'Best–Worst MaxDiff summary: unit_* = image; metrics = rank/mu/… + bws/best/worst/appearances (μ-sorted)',
    'Video Key Moments long: segment_index, start, end (one row per segment; shown_images = video)',
    'Video Key Moments summary: unit_* = video; metrics = n_responses/mean_segments/peak_time/…',
    'Pairwise A/B slider long: preference, hard_to_decide, interpretation (shown_images = A|B)',
    'Pairwise A/B slider summary: unit_* = image; signed preference stats',
    'Emotion color long: hex, hue, intensity, option_*; summary unit_* = image',
    'Continuous video long: time_s, value (per sample); summary unit_* = video',
    'Composite blocks long: dimension_* + value + choice/words/text; summary unit_* = image × dim',
    'Generic skill long: answer_json + expanded rows for points/path/polygon/bbox/allocation/rankedList/multiChoice/matrix/mediaChoice/mediaRankedList/timeRanges/timeSeries/pairwise/bestWorst; summary by media + archetype metrics',
    'imageannotation long: tool, label, annotation_json (+ shown_images)',
    'imageannotation summary: attribute_* = label or tool; unit_* = image;',
    '  metrics = count (overall) + label_count + tool_count',
    'pointallocation (text): choice_key, choice_label, points',
    '',
    'Encoding: UTF-8 with BOM. CSV fields RFC4180-escaped.',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Build all files for Export All ZIP (paths relative to zip root folder).
 */
export function buildResultsExportBundle({
  project,
  surveyConfig,
  questions,
  filteredResponses,
  dateFilteredResponses,
  filters,
  excludeFlagged,
  wideCsv,
}) {
  const answerable = (questions || []).filter((q) => q?.name && !isDisplayOnly(q));
  const questionFiles = [];
  for (const q of answerable) {
    const files = buildQuestionExportFiles(q, filteredResponses, surveyConfig);
    if (files) questionFiles.push(...files);
  }

  const includedKeys = new Set((filteredResponses || []).map(responseKey));
  const qualityCsv = buildDataQualityCsv(dateFilteredResponses || filteredResponses, surveyConfig, {
    excludeFlagged,
    includedKeys,
  });

  let methodsText = '';
  let bibtex = null;
  try {
    const methods = generateMethodsText({
      project,
      surveyConfig,
      responses: dateFilteredResponses || filteredResponses,
      templateMeta: project?.templateMeta || null,
      excludeFlagged,
    });
    methodsText = methods.methodsText || '';
    bibtex = methods.bibtex || null;
  } catch (err) {
    methodsText = `Methods export unavailable: ${err?.message || err}\n`;
  }

  const manifest = buildManifest({
    project,
    questions: answerable,
    responses: filteredResponses,
    filters,
    questionFiles,
  });

  const readme = buildExportReadme({
    project,
    filters,
    nResponses: (filteredResponses || []).length,
    questionCount: answerable.length,
  });

  const rootFiles = [
    { path: 'README.txt', content: readme },
    { path: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: 'responses_wide.csv', content: wideCsv || rowsToCsv([['participant_id']]) },
    { path: 'data_quality.csv', content: qualityCsv },
    { path: 'methods.txt', content: methodsText || '' },
    ...questionFiles,
  ];
  if (bibtex) {
    rootFiles.push({ path: 'references.bib', content: bibtex });
  }
  return rootFiles;
}

export function downloadResultsExportZip(opts) {
  const date = exportDateStamp();
  const projectId = opts.project?.id || 'survey';
  const folder = `results_${projectId}_${date}`;
  const files = buildResultsExportBundle(opts).map((f) => ({
    path: `${folder}/${f.path}`,
    content: f.content,
  }));
  downloadZip(`${folder}.zip`, files);
}

export function downloadDataQualityCsv(responses, surveyConfig, opts) {
  const csv = buildDataQualityCsv(responses, surveyConfig, opts);
  downloadTextFile(csv, `data_quality_${exportDateStamp()}.csv`);
}
