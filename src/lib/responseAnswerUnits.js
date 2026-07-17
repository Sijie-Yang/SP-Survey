/**
 * Expand a stored question payload into per-trial units for analysis.
 * Multi-trial enriched shape → one unit per answered trial (with that trial's media).
 * Single-answer → one unit.
 */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasAnswer(answer) {
  if (answer === null || answer === undefined || answer === '') return false;
  if (Array.isArray(answer) && answer.length === 0) return false;
  // Align with trialHasAnswer: empty objects are not answers
  if (typeof answer === 'object' && !Array.isArray(answer) && Object.keys(answer).length === 0) {
    return false;
  }
  // Annotation: shapes required
  if (
    typeof answer === 'object'
    && !Array.isArray(answer)
    && Object.prototype.hasOwnProperty.call(answer, 'shapes')
    && (!Array.isArray(answer.shapes) || answer.shapes.length === 0)
  ) {
    return false;
  }
  return true;
}

function unitFromParts({
  answer,
  shown_images = [],
  shown_media = [],
  shown_media_ids = [],
  trial_index = 0,
  participant_id = '',
}, requireAnswer) {
  if (requireAnswer && !hasAnswer(answer)) return null;
  if (!requireAnswer && !hasAnswer(answer) && !shown_images.length && !shown_media.length) {
    return null;
  }
  return {
    answer: hasAnswer(answer) ? answer : null,
    shown_images,
    shown_media,
    shown_media_ids,
    trial_index,
    participant_id,
  };
}

/**
 * Recover multi-trial when enrich saved answer as an array and displayed_images
 * has `${name}__trials`, but the `trials` key was missing.
 */
function expandFromAnswerArray(row, questionName, qData, requireAnswer) {
  const trialShown = row.displayed_images?.[`${questionName}__trials`];
  if (!Array.isArray(trialShown) || trialShown.length < 2) return null;
  if (!Array.isArray(qData?.answer) || qData.answer.length !== trialShown.length) return null;
  // Avoid treating checkbox / multi-select imagepicker as trials unless lengths match __trials.
  const participant_id = row.participant_id || '';
  return qData.answer.map((answer, trialIndex) => unitFromParts({
    answer,
    shown_images: trialShown[trialIndex] || [],
    shown_media: [],
    shown_media_ids: [],
    trial_index: trialIndex,
    participant_id,
  }, requireAnswer)).filter(Boolean);
}

/**
 * @param {object} row - survey response row
 * @param {string} questionName
 * @param {{ requireAnswer?: boolean }} [options]
 */
export function expandQuestionAnswerUnits(row, questionName, { requireAnswer = true } = {}) {
  const qData = row?.responses?.[questionName];
  if (qData === undefined || qData === null) return [];

  const participant_id = row.participant_id || '';

  // Multi-trial (enriched or raw { trials: [...] })
  if (isPlainObject(qData) && Array.isArray(qData.trials)) {
    return qData.trials.map((trial, trialIndex) => {
      const answer = trial?.answer ?? trial?.value;
      const shown_images = trial?.shown_images?.length
        ? trial.shown_images
        : (row.displayed_images?.[`${questionName}__trials`]?.[trialIndex]
          || row.displayed_images?.[questionName]
          || []);
      const shown_media = Array.isArray(trial?.shown_media) ? trial.shown_media : [];
      const shown_media_ids = Array.isArray(trial?.shown_media_ids) ? trial.shown_media_ids : [];
      return unitFromParts({
        answer,
        shown_images,
        shown_media,
        shown_media_ids,
        trial_index: trial?.trial_index ?? trialIndex,
        participant_id,
      }, requireAnswer);
    }).filter(Boolean);
  }

  // Recovery: answer array paired with __trials media lists
  if (isPlainObject(qData) && Array.isArray(qData.answer) && !qData.trials) {
    const recovered = expandFromAnswerArray(row, questionName, qData, requireAnswer);
    if (recovered?.length) return recovered;
  }

  let answer;
  let shown_images = [];
  let shown_media = [];
  let shown_media_ids = [];

  if (isPlainObject(qData) && 'answer' in qData) {
    answer = qData.answer;
    shown_images = qData.shown_images?.length
      ? qData.shown_images
      : (row.displayed_images?.[questionName] || []);
    shown_media = Array.isArray(qData.shown_media) ? qData.shown_media : [];
    shown_media_ids = Array.isArray(qData.shown_media_ids) ? qData.shown_media_ids : [];
  } else {
    answer = qData;
    shown_images = row.displayed_images?.[questionName] || [];
  }

  const unit = unitFromParts({
    answer,
    shown_images,
    shown_media,
    shown_media_ids,
    trial_index: 0,
    participant_id,
  }, requireAnswer);
  return unit ? [unit] : [];
}
