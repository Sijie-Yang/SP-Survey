/**
 * Normalize AI / agent survey configs before persistence.
 * Pure module — no I/O.
 */

import { ANNOTATION_TOOLS, normalizeAllowedTools } from '../annotationTools';

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
    (page.elements || []).forEach((element) => {
      if (!MEDIA_STIMULUS_TYPES.includes(element.type)) return;
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
      }
      if (MEDIA_STAR_TYPES.includes(element.type)) {
        if (!element.mediaType) element.mediaType = 'any';
        if (!Array.isArray(element.mediaSlots)) element.mediaSlots = [];
        if (!element.mediaPresentation) element.mediaPresentation = 'stack';
      }
      if (element.type === 'skillquestion') {
        // Prefer preset_* ids; do not keep agent-invented HTML.
        delete element.skillHtml;
        if (element.skillId && !String(element.skillId).startsWith('preset_')) {
          element.skillId = `preset_${element.skillId}`;
        }
        if (element.skillConfig?.mediaCount != null && element.imageCount == null) {
          element.imageCount = Number(element.skillConfig.mediaCount) || 1;
        }
      }
      delete element.imageSource;
      delete element.huggingFaceConfig;
      delete element.falApiKey;
    });
  });

  return processedConfig;
}

export function createDefaultSurveyConfig(name, description = '') {
  return {
    title: name,
    description: description || 'This survey helps us understand user preferences and opinions.',
    logo: '',
    logoPosition: 'right',
    showQuestionNumbers: 'off',
    showProgressBar: 'top',
    progressBarType: 'questions',
    autoGrowComment: true,
    showPreviewBeforeComplete: 'showAllQuestions',
    includeResearcherPractice: true,
    excludeFlaggedFromAnalysis: false,
    pages: [
      {
        name: 'page1',
        title: 'Survey Questions',
        description: 'Please answer the following questions.',
        elements: [],
      },
    ],
    completedHtml: '<h3>Thank you for completing the survey.</h3>',
  };
}
