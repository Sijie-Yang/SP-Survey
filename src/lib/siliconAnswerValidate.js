/**
 * Per-question Silicon answer shape checks (Platform answerValidate, CJS).
 */

const DISPLAY_ONLY = new Set(['html', 'expression', 'image', 'mediadisplay']);
const SUPPORTED = new Set([
  'text', 'comment', 'consent',
  'number',
  'rating', 'imagerating', 'mediarating',
  'boolean', 'imageboolean', 'mediaboolean',
  'radiogroup', 'dropdown', 'imagepicker', 'mediapicker',
  'checkbox', 'imagecheckbox', 'mediacheckbox',
  'ranking', 'imageranking', 'mediaranking',
  'slidergroup', 'imageslidergroup', 'mediaslidergroup',
  'matrix', 'imagematrix', 'mediamatrix',
  'pointallocation', 'imagepointallocation', 'mediapointallocation',
]);
const UNVERIFIED = new Set(['imageannotation', 'skillquestion']);
const RATING_TYPES = new Set(['rating', 'imagerating', 'mediarating']);
const NUMBER_TYPES = new Set(['number']);
const BOOLEAN_TYPES = new Set(['boolean', 'imageboolean', 'mediaboolean', 'consent']);
const TEXT_TYPES = new Set(['text', 'comment']);
const SINGLE_CHOICE_TYPES = new Set(['radiogroup', 'dropdown']);
const MEDIA_CHOICE_TYPES = new Set(['imagepicker', 'mediapicker']);
const MULTI_CHOICE_TYPES = new Set(['checkbox', 'imagecheckbox', 'mediacheckbox']);
const RANKING_TYPES = new Set(['ranking', 'imageranking', 'mediaranking']);
const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);
const MATRIX_TYPES = new Set(['matrix', 'imagematrix', 'mediamatrix']);
const ALLOCATION_TYPES = new Set(['pointallocation', 'imagepointallocation', 'mediapointallocation']);

function asList(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (item == null) return '';
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(item.value ?? item.text ?? item.id ?? '');
  }).filter(Boolean);
}

function choiceValues(question) {
  return asList(question.choices || question.rateValues || question.options);
}

function matrixRows(question) {
  return asList(question.rows);
}

function matrixColumns(question) {
  return asList(question.columns);
}

function allocationKeys(question) {
  return choiceValues(question);
}

function trialCountOf(question) {
  const n = Number(question?.trialCount ?? question?.trials ?? 1);
  return Number.isFinite(n) && n > 1 ? Math.min(200, Math.floor(n)) : 1;
}

function isTrialsPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.trials);
}

function sliderScale(dimension = {}, question = {}) {
  const min = Number(dimension.min ?? question.scaleMin ?? 1);
  const max = Number(dimension.max ?? question.scaleMax ?? 7);
  const valid = Number.isFinite(min) && Number.isFinite(max) && max > min;
  return { min, max, valid };
}

function dimensionDisplayName(dimension = {}, index = 0) {
  return dimension.label || dimension.text || dimension.name || dimension.id || `Dimension ${index + 1}`;
}

function classifyQuestion(question = {}) {
  const type = question.type || '';
  if (DISPLAY_ONLY.has(type)) {
    return { supported: false, reason: `Type ${type} is display-only` };
  }
  if (UNVERIFIED.has(type)) {
    return { supported: false, verified: false, reason: `Type ${type} is listed but not preview-accepted yet` };
  }
  if (!SUPPORTED.has(type)) {
    return { supported: false, reason: `Type ${type || 'unknown'} is outside the Silicon pretest whitelist` };
  }
  if (SLIDER_TYPES.has(type) && !(question.dimensions || []).some((item) => item?.id)) {
    return { supported: false, reason: 'Slider questions need at least one dimension id before Silicon can answer them' };
  }
  if (MATRIX_TYPES.has(type) && (!matrixRows(question).length || !matrixColumns(question).length)) {
    return { supported: false, reason: 'Matrix questions need rows and columns before Silicon can answer them' };
  }
  if (ALLOCATION_TYPES.has(type) && !allocationKeys(question).length) {
    return { supported: false, reason: 'Allocation questions need at least one choice before Silicon can answer them' };
  }
  return { supported: true };
}

function validateText(question, answer) {
  const text = typeof answer === 'string' ? answer.trim() : (answer == null ? '' : String(answer).trim());
  if (!text && question.isRequired !== false) return { ok: false, reason: 'Expected non-empty text' };
  const max = Number(question.maxLength);
  if (Number.isFinite(max) && max > 0 && text.length > max) {
    return { ok: false, reason: `Text longer than ${max} characters` };
  }
  return { ok: true, answer: text };
}

function validateBoolean(answer) {
  if (typeof answer === 'boolean') return { ok: true, answer };
  if (answer === 'true' || answer === 'yes' || answer === 1 || answer === '1') return { ok: true, answer: true };
  if (answer === 'false' || answer === 'no' || answer === 0 || answer === '0') return { ok: true, answer: false };
  return { ok: false, reason: 'Expected boolean' };
}

function validateNumber(question, answer) {
  const n = Number(answer);
  if (!Number.isFinite(n)) return { ok: false, reason: 'Expected a number' };
  const min = question.min ?? question.minValue;
  const max = question.max ?? question.maxValue;
  if (min != null && Number.isFinite(Number(min)) && n < Number(min)) {
    return { ok: false, reason: `Expected a number >= ${min}` };
  }
  if (max != null && Number.isFinite(Number(max)) && n > Number(max)) {
    return { ok: false, reason: `Expected a number <= ${max}` };
  }
  return { ok: true, answer: n };
}

function validateRating(question, answer) {
  const n = Number(answer);
  if (!Number.isFinite(n)) return { ok: false, reason: 'Expected a number' };
  const min = Number(question.rateMin ?? 1);
  const max = Number(question.rateMax ?? 5);
  if (n < min || n > max) return { ok: false, reason: `Expected a number between ${min} and ${max}` };
  return { ok: true, answer: n };
}

function validateSingleChoice(question, answer, values) {
  const value = typeof answer === 'object' && answer ? answer.value ?? answer.text : answer;
  const allowed = [...values];
  if (question.allowTie && question.tieLabel) allowed.push(String(question.tieLabel));
  if (!allowed.includes(String(value))) return { ok: false, reason: 'Answer is not an allowed choice' };
  return { ok: true, answer: String(value) };
}

function validateMultiChoice(answer, values) {
  if (!Array.isArray(answer)) return { ok: false, reason: 'Expected an array' };
  const normalized = answer.map((item) => String(typeof item === 'object' && item ? item.value ?? item.text : item));
  if (normalized.some((item) => !values.includes(item))) {
    return { ok: false, reason: 'Answer contains a choice outside the list' };
  }
  return { ok: true, answer: normalized };
}

function validateRanking(question, answer, values) {
  if (!Array.isArray(answer)) return { ok: false, reason: 'Expected an array' };
  const normalized = answer.map((item) => String(typeof item === 'object' && item ? item.value ?? item.text : item));
  if (!normalized.length && question.isRequired !== false) {
    return { ok: false, reason: 'Required ranking cannot be empty' };
  }
  if (new Set(normalized).size !== normalized.length) return { ok: false, reason: 'Ranking answers must be unique' };
  if (normalized.some((item) => !values.includes(item))) {
    return { ok: false, reason: 'Ranking contains a choice outside the list' };
  }
  return { ok: true, answer: normalized };
}

function validateSlider(question, answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return { ok: false, reason: 'Expected an object of dimension id → number' };
  }
  const normalized = {};
  for (const [index, dimension] of (question.dimensions || []).entries()) {
    const id = dimension?.id;
    if (!id) continue;
    const n = Number(answer[id]);
    const scale = sliderScale(dimension, question);
    if (!scale.valid || !Number.isFinite(n) || n < scale.min || n > scale.max) {
      return {
        ok: false,
        reason: `Dimension ${dimensionDisplayName(dimension, index)} must be a number between ${scale.min} and ${scale.max}`,
      };
    }
    normalized[id] = n;
  }
  if (!Object.keys(normalized).length) return { ok: false, reason: 'No slider dimensions to answer' };
  return { ok: true, answer: normalized };
}

function validateMatrix(question, answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return { ok: false, reason: 'Expected an object of row → column' };
  }
  const rows = matrixRows(question);
  const cols = matrixColumns(question);
  const normalized = {};
  for (const row of rows) {
    const raw = answer[row];
    const value = typeof raw === 'object' && raw ? raw.value ?? raw.text : raw;
    if (!cols.includes(String(value))) {
      return { ok: false, reason: `Row ${row} must be one of the column values` };
    }
    normalized[row] = String(value);
  }
  return { ok: true, answer: normalized };
}

function validateAllocation(question, answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return { ok: false, reason: 'Expected an object of choice → points' };
  }
  const keys = allocationKeys(question);
  const budget = Number(question.budget ?? 100);
  const normalized = {};
  let sum = 0;
  for (const key of keys) {
    const n = Number(answer[key]);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, reason: `Allocation for ${key} must be a number ≥ 0` };
    }
    normalized[key] = n;
    sum += n;
  }
  if (Number.isFinite(budget) && Math.abs(sum - budget) > 0.01) {
    return { ok: false, reason: `Allocation must sum to ${budget}` };
  }
  return { ok: true, answer: normalized };
}

function validateAnnotation(question, answer) {
  const shapes = Array.isArray(answer)
    ? answer
    : (Array.isArray(answer?.shapes) ? answer.shapes : null);
  if (!shapes) return { ok: false, reason: 'Expected { shapes: [...] }' };
  const tools = new Set(asList(question.allowedTools).length
    ? asList(question.allowedTools)
    : ['point', 'line', 'polygon', 'bbox']);
  const labels = asList(question.annotationLabels);
  const min = Number(question.minAnnotations ?? 0);
  const max = Number(question.maxAnnotations ?? 50);
  if (shapes.length < min) return { ok: false, reason: `Need at least ${min} annotations` };
  if (Number.isFinite(max) && shapes.length > max) return { ok: false, reason: `Need at most ${max} annotations` };
  const normalized = [];
  for (const shape of shapes) {
    const tool = String(shape?.tool || shape?.type || '').toLowerCase();
    if (!tools.has(tool)) return { ok: false, reason: `Annotation tool ${tool || 'missing'} is not allowed` };
    const label = String(shape?.label || '');
    if (labels.length && label && !labels.includes(label)) {
      return { ok: false, reason: `Annotation label ${label} is not allowed` };
    }
    const points = Array.isArray(shape?.points) ? shape.points : [];
    if (!points.length) return { ok: false, reason: 'Each annotation needs points' };
    const need = tool === 'point' ? 1 : tool === 'bbox' || tool === 'line' ? 2 : 3;
    if (points.length < need) return { ok: false, reason: `Tool ${tool} needs at least ${need} points` };
    const xy = points.map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
    if (xy.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) {
      return { ok: false, reason: 'Annotation points must be normalized 0–1' };
    }
    normalized.push({ tool, label, points: xy });
  }
  return { ok: true, answer: { shapes: normalized } };
}

function validateSkill(question, answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return { ok: false, reason: 'Expected a skill result object' };
  }
  const schema = Array.isArray(question.skillResultSchema) ? question.skillResultSchema : [];
  if (!schema.length) {
    return Object.keys(answer).length
      ? { ok: true, answer }
      : { ok: false, reason: 'Skill answer is empty' };
  }
  const normalized = { ...answer };
  for (const field of schema) {
    const key = field?.key;
    if (!key) continue;
    const value = answer[key];
    const type = String(field.type || 'text');
    if (value == null) return { ok: false, reason: `Skill field ${key} is missing` };
    if (type === 'number' || type === 'rating' || type === 'count') {
      if (!Number.isFinite(Number(value))) return { ok: false, reason: `Skill field ${key} must be a number` };
      normalized[key] = Number(value);
    } else if (type === 'boolean') {
      const checked = validateBoolean(value);
      if (!checked.ok) return { ok: false, reason: `Skill field ${key} must be boolean` };
      normalized[key] = checked.answer;
    } else if (type === 'multiChoice' || type === 'rankedList') {
      if (!Array.isArray(value)) return { ok: false, reason: `Skill field ${key} must be an array` };
    } else if (type === 'allocation' || type === 'scaleGroup' || type === 'matrix') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: `Skill field ${key} must be an object` };
      }
    }
  }
  return { ok: true, answer: normalized };
}

function validateInnerSiliconAnswer(question, answer) {
  const kind = classifyQuestion(question);
  if (!kind.supported && kind.verified !== false) return { ok: false, skipped: true, reason: kind.reason };
  const type = question.type;
  if (answer == null || answer === '') return { ok: false, reason: 'Empty answer' };

  if (TEXT_TYPES.has(type)) return validateText(question, answer);
  if (NUMBER_TYPES.has(type)) return validateNumber(question, answer);
  if (RATING_TYPES.has(type)) return validateRating(question, answer);
  if (BOOLEAN_TYPES.has(type)) return validateBoolean(answer);
  const values = choiceValues(question);
  if (MEDIA_CHOICE_TYPES.has(type) && question.multiSelect) return validateMultiChoice(answer, values);
  if (SINGLE_CHOICE_TYPES.has(type) || MEDIA_CHOICE_TYPES.has(type)) {
    return validateSingleChoice(question, answer, values);
  }
  if (MULTI_CHOICE_TYPES.has(type)) return validateMultiChoice(answer, values);
  if (SLIDER_TYPES.has(type)) return validateSlider(question, answer);
  if (RANKING_TYPES.has(type)) return validateRanking(question, answer, values);
  if (MATRIX_TYPES.has(type)) return validateMatrix(question, answer);
  if (ALLOCATION_TYPES.has(type)) return validateAllocation(question, answer);
  if (type === 'imageannotation') return validateAnnotation(question, answer);
  if (type === 'skillquestion') return validateSkill(question, answer);
  return { ok: false, reason: `Unsupported answer contract for ${type}` };
}

function validateSiliconAnswer(question, answer) {
  const kind = classifyQuestion(question);
  if (!kind.supported && kind.verified !== false) return { ok: false, skipped: true, reason: kind.reason };
  const trialsWanted = trialCountOf(question);
  if (trialsWanted <= 1) return validateInnerSiliconAnswer(question, answer);
  if (!isTrialsPayload(answer)) {
    return { ok: false, reason: `Expected { trials: [...] } with ${trialsWanted} rounds` };
  }
  if (answer.trials.length !== trialsWanted) {
    return { ok: false, reason: `Expected ${trialsWanted} trials` };
  }
  const trials = [];
  for (const [index, trial] of answer.trials.entries()) {
    const inner = validateInnerSiliconAnswer(question, trial?.answer ?? trial?.value ?? trial);
    if (!inner.ok) return { ok: false, reason: `Trial ${index + 1}: ${inner.reason}` };
    trials.push({
      answer: inner.answer,
      value: inner.answer,
      shown_images: Array.isArray(trial?.shown_images)
        ? trial.shown_images
        : (Array.isArray(trial?.shownImages) ? trial.shownImages : []),
    });
  }
  return { ok: true, answer: { trials } };
}

function siliconAnswerContract(question = {}) {
  const type = question.type;
  if (TEXT_TYPES.has(type)) return 'Return {"answer":"short text","rationale":"one sentence"}.';
  if (NUMBER_TYPES.has(type)) {
    return `Return {"answer": number, "rationale":"one sentence"} between ${question.min ?? 0} and ${question.max ?? 100}.`;
  }
  if (RATING_TYPES.has(type)) {
    return `Return {"answer": number, "rationale":"one sentence"} between ${question.rateMin ?? 1} and ${question.rateMax ?? 5}.`;
  }
  if (BOOLEAN_TYPES.has(type)) return 'Return {"answer": true|false, "rationale":"one sentence"}.';
  if (SLIDER_TYPES.has(type)) {
    return `Slider dimensions: ${JSON.stringify((question.dimensions || []).map((dimension) => ({
      id: dimension.id,
      label: dimension.label || `${dimension.left || ''} ↔ ${dimension.right || ''}`,
      min: dimension.min ?? question.scaleMin ?? 1,
      max: dimension.max ?? question.scaleMax ?? 7,
    })))}
Return {"answer":{"<dimensionId>": number}, "rationale":"one sentence"}.`;
  }
  if (MATRIX_TYPES.has(type)) {
    return `Rows: ${JSON.stringify(matrixRows(question))}. Columns: ${JSON.stringify(matrixColumns(question))}.
Return {"answer":{"<row>":"<column>"}, "rationale":"one sentence"}.`;
  }
  if (ALLOCATION_TYPES.has(type)) {
    return `Allocate exactly ${question.budget ?? 100} points across ${JSON.stringify(allocationKeys(question))}.
Return {"answer":{"<choice>": number}, "rationale":"one sentence"}.`;
  }
  if (MULTI_CHOICE_TYPES.has(type) || RANKING_TYPES.has(type) || (MEDIA_CHOICE_TYPES.has(type) && question.multiSelect)) {
    return 'Return {"answer":["choice",...],"rationale":"one sentence"}.';
  }
  return 'Return {"answer": <allowed choice>, "rationale":"one sentence"}.';
}

module.exports = {
  classifyQuestion,
  validateInnerSiliconAnswer,
  validateSiliconAnswer,
  siliconAnswerContract,
  trialCountOf,
};
