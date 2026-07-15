/**
 * Shared single-question SurveyJS builders for QuestionParticipantPreview
 * and ResearcherPractice.
 */
import {
  applyMediaToElement,
  defaultMediaCount,
  filterPoolForQuestion,
  getImageKey,
  isCuratedMediaMode,
  isRandomMediaQuestion,
  pickRandomMediaForQuestion,
  resolveCuratedImages,
  trackMediaAssignment,
} from './surveyMediaInjection';
import { clampQuestionImageCount } from './questionTypeConstraints';
import { normalizeBuilderQuestion } from './surveyStorage';

/** Mirror SurveyPreview panel conversions for composite image/media types. */
export function toPreviewElement(element) {
  if (element.type === 'imageboolean' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'boolean',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          labelTrue: element.labelTrue || 'Yes',
          labelFalse: element.labelFalse || 'No',
          valueTrue: element.valueTrue,
          valueFalse: element.valueFalse,
        },
      ],
    };
  }
  if (element.type === 'imagerating' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'rating',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          rateMin: element.rateMin || 1,
          rateMax: element.rateMax || 5,
          minRateDescription: element.minRateDescription,
          maxRateDescription: element.maxRateDescription,
        },
      ],
    };
  }
  if (element.type === 'imagematrix' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'matrix',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          columns: element.columns,
          rows: element.rows,
        },
      ],
    };
  }
  if (element.type === 'mediarating' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'rating',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          rateMin: element.rateMin || 1,
          rateMax: element.rateMax || 5,
          minRateDescription: element.minRateDescription,
          maxRateDescription: element.maxRateDescription,
        },
      ],
    };
  }
  if (element.type === 'mediaboolean' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'boolean',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          labelTrue: element.labelTrue || 'Yes',
          labelFalse: element.labelFalse || 'No',
          valueTrue: element.valueTrue,
          valueFalse: element.valueFalse,
        },
      ],
    };
  }
  if (element.type === 'imageslidergroup' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'slidergroup',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          dimensions: element.dimensions || [],
          scaleMin: element.scaleMin ?? 1,
          scaleMax: element.scaleMax ?? 7,
        },
      ],
    };
  }
  if (element.type === 'imagepointallocation' && element.imageHtml) {
    return {
      type: 'panel',
      name: `${element.name}_panel`,
      title: 'See below images:',
      description: element.description,
      state: 'expanded',
      elements: [
        { type: 'html', name: `${element.name}_images`, html: element.imageHtml },
        {
          type: 'pointallocation',
          name: element.name,
          title: element.title,
          isRequired: element.isRequired,
          choices: element.choices || [],
          budget: element.budget ?? 100,
        },
      ],
    };
  }
  return element;
}

/**
 * Resolve media for a single question.
 * @param {object} question
 * @param {Array} projectImages
 * @param {{ usedImageKeys?: Set, usedGroupKeys?: Set, random?: boolean }} options
 * @returns {{ images: Array, groupKey: string|null, groupId: string|null, categories?: string[] }}
 */
export function resolveQuestionMedia(question, projectImages, options = {}) {
  const {
    usedImageKeys = null,
    usedGroupKeys = null,
    random = false,
    folderTags = {},
  } = options;

  // Text / structured questions must never pull from the media pool — otherwise
  // applyMediaToElement's fallback overwrites their answer choices with images.
  if (!isRandomMediaQuestion(question)) {
    return { images: [], groupKey: null, groupId: null };
  }

  const pool = filterPoolForQuestion(projectImages || [], question);
  const count = clampQuestionImageCount(
    question.type,
    question,
    question.imageCount ?? defaultMediaCount(question),
  );

  if (isCuratedMediaMode(question) && question.selectedImageUrls?.length) {
    return {
      images: resolveCuratedImages(question, projectImages).slice(0, count),
      groupKey: null,
      groupId: null,
    };
  }

  if (random) {
    return pickRandomMediaForQuestion(
      pool,
      { ...question, imageCount: count },
      usedImageKeys,
      usedGroupKeys,
      null,
      folderTags,
    );
  }

  return { images: pool.slice(0, count), groupKey: null, groupId: null };
}

/**
 * Build a SurveyJS JSON model for one question with media applied.
 * @returns {{ surveyJson, element, shownImages, assignment }}
 */
export function buildSingleQuestionSurvey({
  question,
  projectImages = [],
  usedImageKeys = null,
  usedGroupKeys = null,
  randomMedia = false,
  showNavigationButtons = false,
  trackUsed = false,
  folderTags = {},
}) {
  if (!question?.type) {
    throw new Error('Question type is required');
  }
  const element = normalizeBuilderQuestion(JSON.parse(JSON.stringify(question)));
  if (!element.name) element.name = 'preview_q';

  const assignment = resolveQuestionMedia(element, projectImages, {
    usedImageKeys,
    usedGroupKeys,
    random: randomMedia,
    folderTags,
  });
  const images = assignment.images || [];
  if (images.length) {
    applyMediaToElement(element, images);
  }
  if (trackUsed && usedImageKeys) {
    trackMediaAssignment(assignment, element, usedImageKeys, usedGroupKeys);
  }

  const previewEl = toPreviewElement(element);
  const surveyJson = {
    showNavigationButtons,
    showCompletedPage: false,
    pages: [{ name: 'p1', elements: [previewEl] }],
  };

  const shownImages = images.map((img) => img.url || img).filter(Boolean);

  return {
    surveyJson,
    element,
    shownImages,
    assignment,
    shownMediaGroup: assignment.groupId || null,
    shownMediaCategories: assignment.categories || null,
  };
}

export function collectQuestionImageKeys(images) {
  return (images || []).map(getImageKey).filter(Boolean);
}
