/**
 * Multi-trial navigation helpers for image/media questions.
 */

export const TRIAL_COUNT_MIN = 1;
export const TRIAL_COUNT_MAX = 200;
export const TRIAL_DOT_GROUP_SIZE = 30;

/** Interactive image/media types that support trialCount > 1 */
export const TRIAL_LOOP_TYPES = new Set([
  'imagepicker', 'mediapicker',
  'imagerating', 'mediarating', 'imageboolean', 'mediaboolean',
  'imageranking', 'mediaranking',
  'imagematrix', 'mediamatrix',
  'imageslidergroup', 'mediaslidergroup',
  'imagepointallocation', 'mediapointallocation',
  'imageannotation',
]);

export function supportsTrialLoop(type) {
  return TRIAL_LOOP_TYPES.has(type);
}

export function getTrialCount(questionOrElement) {
  if (!questionOrElement) return 1;
  const type = questionOrElement.type || questionOrElement.getType?.();
  if (!supportsTrialLoop(type)) return 1;
  const raw = questionOrElement.trialCount;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(n, TRIAL_COUNT_MAX);
}

export function clampTrialCount(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 1;
  return Math.min(Math.max(n, TRIAL_COUNT_MIN), TRIAL_COUNT_MAX);
}

export function isTrialsAnswer(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.trials);
}

export function emptyTrialsAnswer(trialCount) {
  return {
    trials: Array.from({ length: trialCount }, () => ({
      value: null,
      shown_images: [],
      shown_media_ids: [],
    })),
  };
}

export function normalizeTrialsAnswer(value, trialCount) {
  if (trialCount <= 1) return value;
  if (isTrialsAnswer(value) && value.trials.length === trialCount) {
    return value;
  }
  if (isTrialsAnswer(value)) {
    const next = emptyTrialsAnswer(trialCount);
    value.trials.forEach((t, i) => {
      if (i < trialCount && t) next.trials[i] = { ...next.trials[i], ...t };
    });
    return next;
  }
  // Legacy flat answer → treat as trial 0
  const next = emptyTrialsAnswer(trialCount);
  if (value !== undefined && value !== null && value !== '') {
    next.trials[0] = { ...next.trials[0], value };
  }
  return next;
}

/** Row keys for matrix / imagematrix / mediamatrix (SurveyJS ItemValue or plain). */
export function getMatrixRowKeys(questionOrElement) {
  const rows = questionOrElement?.rows;
  if (!rows) return [];
  const arr = typeof rows.toArray === 'function'
    ? rows.toArray()
    : (Array.isArray(rows) ? rows : []);
  return arr.map((item, index) => {
    if (item == null) return `item_${index}`;
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(item.value ?? item.name ?? `item_${index}`);
  });
}

export function isMatrixQuestionType(type) {
  return type === 'matrix' || type === 'imagematrix' || type === 'mediamatrix';
}

/**
 * Matrix answers are { [rowValue]: columnValue }. One click fills one row —
 * complete only when every row has a non-empty cell.
 */
export function matrixValueIsComplete(value, questionOrElement) {
  const rowKeys = getMatrixRowKeys(questionOrElement);
  if (!rowKeys.length) {
    // No row schema: treat like a generic non-empty object answer
    if (value === undefined || value === null || value === '') return false;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(value).length > 0;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return rowKeys.every((key) => {
    const cell = value[key];
    return cell !== undefined && cell !== null && cell !== '';
  });
}

/**
 * @param {object|null} trial `{ value }`
 * @param {object|null} [question] when matrix types, require every row answered
 */
export function trialHasAnswer(trial, question = null) {
  if (!trial) return false;
  const v = trial.value;
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  // Annotation drafts with an image but no shapes are not complete
  if (
    typeof v === 'object'
    && !Array.isArray(v)
    && Object.prototype.hasOwnProperty.call(v, 'shapes')
    && (!Array.isArray(v.shapes) || v.shapes.length === 0)
  ) {
    return false;
  }
  const type = question?.getType?.() || question?.type;
  if (question && isMatrixQuestionType(type)) {
    return matrixValueIsComplete(v, question);
  }
  return true;
}

/** Whether a progress unit should advance because this question/trial has a real answer. */
export function questionUnitHasAnswer(question, trialIndex = 0) {
  if (!question) return false;
  // Prefer trials store even if SurveyJS briefly drops trialCount during media swap —
  // otherwise Next-trial (flat value cleared) makes progress think nothing is answered.
  const stored = getTrialsAnswer(question);
  const n = Math.max(
    getTrialCount(question),
    isTrialsAnswer(stored) ? stored.trials.length : 0,
  );
  if (n > 1 && isTrialsAnswer(stored)) {
    return trialHasAnswer(stored.trials?.[trialIndex], question);
  }
  const v = question.value;
  if (isTrialsAnswer(v)) return trialHasAnswer(v.trials?.[trialIndex] || v.trials?.[0], question);
  return trialHasAnswer({ value: v }, question);
}

export function allTrialsAnswered(answer, trialCount, question = null) {
  const normalized = normalizeTrialsAnswer(answer, trialCount);
  if (!isTrialsAnswer(normalized)) return trialHasAnswer({ value: normalized }, question);
  return normalized.trials.every((t) => trialHasAnswer(t, question));
}

/**
 * Non-answerable / instruction / display types — excluded from progress units and
 * SurveyJS question numbering so "Question 3" in the chrome matches the body "3.".
 */
export const DISPLAY_ONLY_QUESTION_TYPES = new Set([
  'html',
  'expression', // often used as text instruction
  'image',
  'mediadisplay',
  'panel',
  'paneldynamic',
]);

export function isDisplayOnlyQuestionType(type) {
  return DISPLAY_ONLY_QUESTION_TYPES.has(type);
}

export function isProgressAnswerableQuestion(questionOrElement) {
  if (!questionOrElement) return false;
  const t = questionOrElement.getType?.() || questionOrElement.type;
  if (!t || isDisplayOnlyQuestionType(t)) return false;
  return !!questionOrElement.name;
}

/** Hide SurveyJS numbers on display/instruction questions so body numbers match progress. */
export function applyProgressQuestionNumbering(surveyModel) {
  if (!surveyModel || typeof surveyModel.getAllQuestions !== 'function') return;
  (surveyModel.getAllQuestions() || []).forEach((q) => {
    const t = q.getType?.() || q.type;
    if (!isDisplayOnlyQuestionType(t)) return;
    try {
      if (typeof q.setPropertyValue === 'function') {
        q.setPropertyValue('hideNumber', true);
      }
      q.hideNumber = true;
    } catch {
      try { q.hideNumber = true; } catch { /* ignore */ }
    }
  });
}

/** Collect answerable questions in survey order for progress units. */
export function flattenSurveyQuestions(surveyModelOrJson) {
  const pages = surveyModelOrJson?.pages
    || (typeof surveyModelOrJson?.getAllQuestions === 'function'
      ? null
      : surveyModelOrJson?.pages);
  if (typeof surveyModelOrJson?.getAllQuestions === 'function') {
    return (surveyModelOrJson.getAllQuestions() || []).filter(isProgressAnswerableQuestion);
  }
  const out = [];
  (pages || []).forEach((page) => {
    (page.elements || []).forEach((el) => {
      if (!isProgressAnswerableQuestion(el)) return;
      out.push(el);
    });
  });
  return out;
}

export function buildProgressUnits(questions) {
  const units = [];
  (questions || []).forEach((q, qIndex) => {
    const name = q.name || q.getType?.();
    const qName = q.name;
    const trialCount = getTrialCount(q);
    for (let t = 0; t < trialCount; t += 1) {
      units.push({
        id: `${qName}__t${t}`,
        questionName: qName,
        questionIndex: qIndex,
        trialIndex: t,
        trialCount,
      });
    }
  });
  return units;
}

export function mediaSetToShownImages(mediaSet = []) {
  return (mediaSet || []).map((img) => img.url || img.name).filter(Boolean);
}

export function mediaSetToShownIds(mediaSet = []) {
  return (mediaSet || []).map((img) => (
    img.media_id || img.key || img.name || (img.url ? String(img.url).split('?')[0].split('/').pop() : null)
  )).filter(Boolean);
}

/** Side-channel key: full multi-trial payload while question.value stays the active trial. */
export const SP_TRIALS_ANSWER_KEY = 'spTrialsAnswer';

/**
 * Module store — survives SurveyJS property quirks / remounts. Keyed by question name.
 * TrialShell writes here on every answer; collectSurveyDataWithTrials reads on submit.
 */
const trialsAnswerStore = new Map(); // name -> { answer, activeIndex }

export function clearTrialsAnswerStore() {
  trialsAnswerStore.clear();
}

export function setStoredTrialsAnswer(questionName, answer, activeIndex = 0) {
  if (!questionName || !isTrialsAnswer(answer)) return;
  trialsAnswerStore.set(questionName, {
    answer: JSON.parse(JSON.stringify(answer)),
    activeIndex: Math.max(0, activeIndex | 0),
  });
}

export function getStoredTrialsAnswer(questionName) {
  const entry = trialsAnswerStore.get(questionName);
  return entry?.answer || null;
}

export function getStoredActiveTrialIndex(questionName) {
  return trialsAnswerStore.get(questionName)?.activeIndex ?? 0;
}

export function getTrialsAnswer(question) {
  if (!question) return null;
  const fromStore = getStoredTrialsAnswer(question.name);
  if (isTrialsAnswer(fromStore)) return fromStore;
  const side = question[SP_TRIALS_ANSWER_KEY];
  if (isTrialsAnswer(side)) return side;
  if (isTrialsAnswer(question.value)) return question.value;
  return null;
}

/** Persist trials on the question instance + module store. */
export function persistTrialsAnswer(question, answer, activeIndex = 0) {
  if (!question?.name || !isTrialsAnswer(answer)) return;
  const normalized = answer;
  try {
    question[SP_TRIALS_ANSWER_KEY] = normalized;
  } catch { /* ignore */ }
  setStoredTrialsAnswer(question.name, normalized, activeIndex);
}

/**
 * Survey data for save/export: compose { trials: [...] } from the store / side-channel
 * so SurveyJS widgets can keep a flat per-trial value while answering.
 */
export function collectSurveyDataWithTrials(surveyModel) {
  const data = { ...(surveyModel?.data || {}) };
  const questions = typeof surveyModel?.getAllQuestions === 'function'
    ? surveyModel.getAllQuestions()
    : [];
  questions.forEach((q) => {
    const name = q.name;
    if (!name) return;
    const trialCount = Math.max(
      getTrialCount(q),
      getStoredTrialsAnswer(name)?.trials?.length || 0,
      isTrialsAnswer(q[SP_TRIALS_ANSWER_KEY]) ? q[SP_TRIALS_ANSWER_KEY].trials.length : 0,
    );
    if (trialCount <= 1) return;

    let trials = getTrialsAnswer(q);
    if (!isTrialsAnswer(trials)) {
      trials = normalizeTrialsAnswer(q.value, trialCount);
    } else {
      trials = normalizeTrialsAnswer(trials, trialCount);
    }

    // Fold the live flat SurveyJS value into the active trial slot
    const active = getStoredActiveTrialIndex(name);
    const live = q.value;
    if (!isTrialsAnswer(live)) {
      const mediaSet = q.trialMediaSets?.[active] || [];
      const prev = trials.trials[active] || {};
      trials.trials[active] = {
        ...prev,
        value: live,
        shown_images: prev.shown_images?.length
          ? prev.shown_images
          : mediaSetToShownImages(mediaSet),
        shown_media_ids: prev.shown_media_ids?.length
          ? prev.shown_media_ids
          : mediaSetToShownIds(mediaSet),
      };
    }

    data[name] = trials;
    setStoredTrialsAnswer(name, trials, active);
  });
  return data;
}

/** After draft resume (model.data may contain {trials}), refill the module store. */
export function rehydrateTrialsAnswerStoreFromSurvey(surveyModel) {
  const questions = typeof surveyModel?.getAllQuestions === 'function'
    ? surveyModel.getAllQuestions()
    : [];
  questions.forEach((q) => {
    const raw = surveyModel?.data?.[q.name];
    const fromValue = isTrialsAnswer(q.value) ? q.value : null;
    const fromData = isTrialsAnswer(raw) ? raw : null;
    const trials = fromValue || fromData || getTrialsAnswer(q);
    if (!isTrialsAnswer(trials)) return;
    const trialCount = Math.max(getTrialCount(q), trials.trials.length);
    const normalized = normalizeTrialsAnswer(trials, trialCount);
    persistTrialsAnswer(q, normalized, 0);
    // Keep widget-compatible flat value on the question
    if (isTrialsAnswer(q.value)) {
      try {
        q.value = normalized.trials[0]?.value ?? null;
      } catch { /* ignore */ }
    }
  });
}

/** Answerable questions on a SurveyJS page (skip display / instruction / structural). */
export function getAnswerablePageQuestions(page) {
  return (page?.questions || []).filter(isProgressAnswerableQuestion);
}
