/** Data-quality evaluation for survey responses. */

export function flattenQuestions(surveyConfig) {
  return (surveyConfig?.pages || []).flatMap((p) => p.elements || []);
}

export function getAttentionCheckQuestions(surveyConfig) {
  return flattenQuestions(surveyConfig).filter(
    (q) => q.isAttentionCheck && q.expectedAnswer != null && String(q.expectedAnswer).trim() !== '',
  );
}

function extractAnswer(qData) {
  if (qData === null || qData === undefined) return null;
  if (typeof qData === 'object' && !Array.isArray(qData) && 'answer' in qData) return qData.answer;
  return qData;
}

function normalizeScalar(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val).trim().toLowerCase();
}

function filenameFromValue(val) {
  if (!val || typeof val !== 'string') return normalizeScalar(val);
  return val.split('?')[0].split('/').pop().toLowerCase();
}

function answersMatch(actual, expected, questionType) {
  const exp = questionType === 'imagepicker'
    ? filenameFromValue(expected)
    : normalizeScalar(expected);
  if (Array.isArray(actual)) {
    return actual.some((v) => answersMatch(v, expected, questionType));
  }
  const act = questionType === 'imagepicker'
    ? filenameFromValue(actual)
    : normalizeScalar(actual);
  return act === exp;
}

export function checkAttentionFlags(response, surveyConfig) {
  const flags = [];
  for (const q of getAttentionCheckQuestions(surveyConfig)) {
    const raw = extractAnswer(response.responses?.[q.name]);
    if (raw === null || raw === undefined || raw === '') continue;
    if (!answersMatch(raw, q.expectedAnswer, q.type)) {
      flags.push('failed_attention');
      break;
    }
  }
  return flags;
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function checkTooFastFlag(response, allResponses) {
  const totalSec = response.survey_metadata?.timing?.total_seconds;
  if (totalSec == null || totalSec <= 0) return [];
  const durations = allResponses
    .map((r) => r.survey_metadata?.timing?.total_seconds)
    .filter((d) => d != null && d > 0);
  if (durations.length < 3) return [];
  const med = median(durations);
  if (med > 0 && totalSec < med / 3) return ['too_fast'];
  return [];
}

function isStraightLineValues(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (nums.length < 3) return false;
  const first = String(nums[0]);
  return nums.every((v) => String(v) === first);
}

export function checkStraightLiningFlags(response, surveyConfig) {
  const flags = [];
  for (const q of flattenQuestions(surveyConfig)) {
    const raw = extractAnswer(response.responses?.[q.name]);
    if (raw === null || raw === undefined) continue;

    if (q.type === 'rating') {
      // single rating — skip
      continue;
    }
    if (q.type === 'matrix' && typeof raw === 'object' && !Array.isArray(raw)) {
      const rowVals = Object.values(raw);
      if (isStraightLineValues(rowVals)) flags.push('straight_lining');
    }
    if (q.type === 'slidergroup' && typeof raw === 'object' && !Array.isArray(raw)) {
      const vals = Object.values(raw);
      if (isStraightLineValues(vals)) flags.push('straight_lining');
    }
  }
  return flags.length ? ['straight_lining'] : [];
}

export function checkDuplicateBrowserFlag(response, allResponses) {
  const browserId = response.survey_metadata?.browser_id;
  if (!browserId) return [];
  const count = allResponses.filter(
    (r) => r.survey_metadata?.browser_id === browserId,
  ).length;
  return count > 1 ? ['duplicate_browser'] : [];
}

/**
 * Evaluate quality flags for one response.
 * @returns {string[]} flag ids
 */
export function evaluateResponseQuality(response, surveyConfig, allResponses = []) {
  const flags = [
    ...checkAttentionFlags(response, surveyConfig),
    ...checkTooFastFlag(response, allResponses),
    ...checkStraightLiningFlags(response, surveyConfig),
    ...checkDuplicateBrowserFlag(response, allResponses),
  ];
  return [...new Set(flags)];
}

export const QUALITY_FLAG_LABELS = {
  failed_attention: 'Failed attention check',
  too_fast: 'Completed too quickly',
  straight_lining: 'Straight-lining detected',
  duplicate_browser: 'Duplicate browser submission',
};

export function summarizeQuality(allResponses, surveyConfig) {
  const perResponse = {};
  let flagged = 0;
  allResponses.forEach((row) => {
    const flags = evaluateResponseQuality(row, surveyConfig, allResponses);
    perResponse[row.id ?? row.participant_id] = flags;
    if (flags.length) flagged += 1;
  });
  return {
    total: allResponses.length,
    clean: allResponses.length - flagged,
    flagged,
    perResponse,
  };
}
