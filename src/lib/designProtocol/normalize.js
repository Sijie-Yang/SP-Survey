/**
 * Normalize AI / agent survey configs before persistence.
 * Pure module — no I/O.
 */

import { ANNOTATION_TOOLS, normalizeAllowedTools } from '../annotationTools';
import { PLATFORM_SCHEMA } from '../platformSchema/index.js';
import { normalizeSliderQuestion } from '../sliderScale';

const MEDIA_STIMULUS_TYPES = [
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'image',
  'imagematrix', 'imageslidergroup', 'imagepointallocation', 'imageannotation',
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  'skillquestion',
];

const MEDIA_STAR_TYPES = [
  'mediadisplay', 'mediapicker', 'mediaranking', 'mediarating', 'mediaboolean', 'mediacheckbox',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
];

export function normalizeBuilderQuestion(element) {
  if (!element || typeof element !== 'object') return element;
  const question = { ...element };
  if (question.type === 'number') {
    question.type = 'text';
    question.inputType = 'number';
    if (question.min != null && question.min !== '') question.min = Number(question.min);
    if (question.max != null && question.max !== '') question.max = Number(question.max);
  } else if (question.type === 'consent') {
    question.type = 'boolean';
    question.isRequired = true;
    question.labelTrue = question.labelTrue || 'I agree / I consent';
    question.labelFalse = question.labelFalse || 'I do not agree';
  }
  return question;
}

export function normalizeBuilderSurveyJson(surveyJson) {
  if (!surveyJson?.pages) return surveyJson;
  return {
    ...surveyJson,
    pages: surveyJson.pages.map((page) => ({
      ...page,
      elements: (page.elements || []).map(normalizeBuilderQuestion),
    })),
  };
}

/** Post-process LLM-generated configs (image/media/skill defaults, strip secrets). */
export function postProcessAiConfig(surveyConfig) {
  const processedConfig = JSON.parse(JSON.stringify(surveyConfig || {}));
  if (!Array.isArray(processedConfig.pages)) return processedConfig;

  processedConfig.pages.forEach((page) => {
    page.elements = (page.elements || []).map((raw) => {
      const element = normalizeSliderQuestion(raw);
      if (!MEDIA_STIMULUS_TYPES.includes(element.type)) return element;
      if (!element.imageSelectionMode || element.imageSelectionMode === 'random') {
        element.imageSelectionMode = 'huggingface_random';
      }
      element.randomImageSelection = true;
      if (element.excludePreviouslyUsedImages === undefined) {
        element.excludePreviouslyUsedImages = true;
      }
      if (!element.choices) element.choices = [];
      if (element.type === 'imagematrix' && !element.imageLinks) element.imageLinks = [];
      if ((element.type === 'imagecheckbox' || element.type === 'mediacheckbox')
        && (!Array.isArray(element.choices) || !element.choices.length)) {
        element.choices = [
          { value: 'tag_a', text: 'Tag A' },
          { value: 'tag_b', text: 'Tag B' },
          { value: 'tag_c', text: 'Tag C' },
        ];
      }
      if (element.type === 'imageannotation') {
        element.allowedTools = normalizeAllowedTools(element.allowedTools, ANNOTATION_TOOLS);
        element.annotationLabels = (Array.isArray(element.annotationLabels) ? element.annotationLabels : [])
          .map((label) => {
            if (typeof label === 'string' || typeof label === 'number') return String(label).trim();
            if (label && typeof label === 'object') {
              return String(label.text ?? label.label ?? label.value ?? '').trim();
            }
            return '';
          })
          .filter(Boolean);
      }
      if (MEDIA_STAR_TYPES.includes(element.type)) {
        if (!element.mediaType) element.mediaType = 'any';
        if (!Array.isArray(element.mediaSlots)) element.mediaSlots = [];
        if (!element.mediaPresentation) element.mediaPresentation = 'stack';
      }
      if (element.type === 'skillquestion') {
        // Prefer preset_* ids; do not keep agent-invented HTML.
        delete element.skillHtml;
        // Bare preset keys (e.g. best_worst_choice) → preset_*.
        // Library ids (skill_*) must stay unchanged — never rewrite as preset_skill_*.
        // Also heal drafts already broken by that mistaken rewrite.
        let sid = element.skillId ? String(element.skillId) : '';
        if (sid.startsWith('preset_skill_')) {
          sid = sid.slice('preset_'.length);
        } else if (sid && !sid.startsWith('preset_') && !sid.startsWith('skill_')) {
          sid = `preset_${sid}`;
        }
        if (sid) element.skillId = sid;
        if (element.skillConfig?.mediaCount != null && element.imageCount == null) {
          element.imageCount = Number(element.skillConfig.mediaCount) || 1;
        }
      }
      delete element.imageSource;
      delete element.huggingFaceConfig;
      delete element.falApiKey;
      return element;
    });
  });

  return processedConfig;
}

export function createDefaultSurveyConfig(name, description = '') {
  const defaults = JSON.parse(JSON.stringify(PLATFORM_SCHEMA.defaultSurveyConfig));
  defaults.title = name;
  if (description) defaults.description = description;
  return defaults;
}
