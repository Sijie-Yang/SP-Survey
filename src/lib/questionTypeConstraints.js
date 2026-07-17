/**
 * Per-question-type media / count constraints for the survey builder.
 * Mirrors skill mediaConstraints: hide knobs that the UI cannot honor.
 */

const MEDIA_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagematrix',
  'image', 'imageslidergroup', 'imagepointallocation',
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  'imageannotation',
  'skillquestion',
]);

/**
 * @returns {{
 *   hasStimuli: boolean,
 *   countFixed: number|null,
 *   countMin: number,
 *   countMax: number,
 *   countLabel: string|null,
 *   countAdjustable: boolean,
 *   defaultCount: number,
 *   samplingModes: boolean,
 *   mediaAssignment: boolean,
 * }}
 */
export function getQuestionMediaConstraints(type, question = {}) {
  if (!MEDIA_TYPES.has(type)) {
    return {
      hasStimuli: false,
      countFixed: null,
      countMin: 1,
      countMax: 1,
      countLabel: null,
      countAdjustable: false,
      defaultCount: 1,
      samplingModes: false,
      mediaAssignment: false,
    };
  }

  // Display modes that force a fixed stimulus count
  if (type === 'mediadisplay' && question.displayMode === 'reveal') {
    return {
      hasStimuli: true,
      countFixed: 2,
      countMin: 2,
      countMax: 2,
      countLabel: 'Always 2 media files (before / after)',
      countAdjustable: false,
      defaultCount: 2,
      samplingModes: true,
      mediaAssignment: true,
    };
  }

  const table = {
    imagepicker: {
      countMin: 1, countMax: 20, defaultCount: 4,
      countLabel: 'Images shown as choices',
      samplingModes: true,
    },
    imageranking: {
      countMin: 2, countMax: 10, defaultCount: 4,
      countLabel: 'Images to rank',
      samplingModes: true,
    },
    mediaranking: {
      countMin: 2, countMax: 10, defaultCount: 4,
      countLabel: 'Media files to rank',
      samplingModes: true,
    },
    mediapicker: {
      countMin: 1, countMax: 20, defaultCount: 4,
      countLabel: 'Media files shown as choices',
      samplingModes: true,
    },
    imagerating: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Images to rate',
      samplingModes: true,
    },
    imageboolean: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Images shown',
      samplingModes: true,
    },
    imagematrix: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Images shown above the matrix',
      samplingModes: true,
    },
    image: {
      countFixed: 1,
      countLabel: 'Always 1 image',
      samplingModes: true,
    },
    imageslidergroup: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Images shown above the sliders',
      samplingModes: true,
    },
    imagepointallocation: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Images shown above the budget task',
      samplingModes: true,
    },
    mediadisplay: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Media files shown',
      samplingModes: true,
    },
    mediarating: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Media files shown',
      samplingModes: true,
    },
    mediaboolean: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Media files shown',
      samplingModes: true,
    },
    mediamatrix: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Media files shown above the matrix',
      samplingModes: true,
    },
    mediaslidergroup: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Media files shown above the sliders',
      samplingModes: true,
    },
    mediapointallocation: {
      countMin: 1, countMax: 6, defaultCount: 1,
      countLabel: 'Media files shown above the budget task',
      samplingModes: true,
    },
    imageannotation: {
      countFixed: 1,
      countLabel: 'Always 1 image to annotate',
      samplingModes: true,
    },
  };

  const row = table[type] || { countMin: 1, countMax: 6, defaultCount: 1 };
  const countFixed = row.countFixed ?? null;
  return {
    hasStimuli: true,
    countFixed,
    countMin: countFixed ?? row.countMin ?? 1,
    countMax: countFixed ?? row.countMax ?? 6,
    countLabel: row.countLabel || null,
    countAdjustable: countFixed == null,
    defaultCount: countFixed ?? row.defaultCount ?? 1,
    samplingModes: row.samplingModes !== false,
    mediaAssignment: true,
  };
}

export function clampQuestionImageCount(type, question, rawCount) {
  const c = getQuestionMediaConstraints(type, question);
  if (c.countFixed != null) return c.countFixed;
  const n = parseInt(rawCount, 10);
  if (Number.isNaN(n)) return c.defaultCount;
  return Math.min(Math.max(n, c.countMin), c.countMax);
}

export function isMediaStimulusQuestion(type) {
  return MEDIA_TYPES.has(type) && type !== 'skillquestion';
}

/** True when the editor should show stimulus sampling controls (card 1). */
export function usesStimulusSampling(type, question = {}) {
  if (type === 'skillquestion') return true;
  return getQuestionMediaConstraints(type, question).hasStimuli;
}

export function isCuratedSelectionMode(mode) {
  return mode === 'huggingface_manual' || mode === 'manual';
}

/** Interactive media types that can repeat as multiple trials (see trialNavigation.js). */
export const TRIAL_LOOP_EDITOR_TYPES = new Set([
  'imagepicker', 'mediapicker',
  'imagerating', 'mediarating', 'imageboolean', 'mediaboolean',
  'imageranking', 'mediaranking',
  'imagematrix', 'mediamatrix',
  'imageslidergroup', 'mediaslidergroup',
  'imagepointallocation', 'mediapointallocation',
  'imageannotation',
]);

export function supportsTrialCount(type) {
  return TRIAL_LOOP_EDITOR_TYPES.has(type);
}
