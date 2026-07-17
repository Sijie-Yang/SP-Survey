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
  pickTrialMediaSetsForQuestion,
  rememberInjectedMedia,
  resolveCuratedImages,
  trackMediaAssignment,
} from './surveyMediaInjection';
import { clampQuestionImageCount } from './questionTypeConstraints';
import { normalizeBuilderQuestion } from './surveyStorage';
import { getTrialCount } from './trialNavigation';

/**
 * Keep custom image/media widgets as-is so trial=1 matches trial>1.
 * (Previously flattened some types into "See below images:" html+control panels.)
 */
export function toPreviewElement(element) {
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

  const trialCount = getTrialCount(element);
  const pool = filterPoolForQuestion(projectImages || [], element);
  let assignment;
  let images = [];
  let trialMediaSets = null;

  if (
    isRandomMediaQuestion(element)
    && trialCount > 1
    && randomMedia
    && !isCuratedMediaMode(element)
    && pool.length
  ) {
    const picked = pickTrialMediaSetsForQuestion(
      pool,
      element,
      trialCount,
      usedImageKeys,
      usedGroupKeys,
      null,
      folderTags,
    );
    trialMediaSets = picked.trialMediaSets;
    assignment = picked.trialAssignments?.[0] || { images: [] };
    images = assignment.flatMedia || assignment.images || trialMediaSets[0] || [];
    element.trialCount = trialCount;
    element.trialMediaSets = trialMediaSets;
  } else {
    assignment = resolveQuestionMedia(element, projectImages, {
      usedImageKeys,
      usedGroupKeys,
      random: randomMedia,
      folderTags,
    });
    images = assignment.images || [];
    if (trialCount > 1 && images.length) {
      // Curated / non-random: reuse the same stimulus set for every trial.
      trialMediaSets = Array.from({ length: trialCount }, () => (
        images.map((img) => ({ ...img }))
      ));
      element.trialCount = trialCount;
      element.trialMediaSets = trialMediaSets;
    }
  }

  if (images.length) {
    applyMediaToElement(element, images);
  }
  // Random multi-trial already tracked inside pickTrialMediaSetsForQuestion.
  const multiTrialRandom = trialCount > 1 && randomMedia && !isCuratedMediaMode(element);
  if (trackUsed && usedImageKeys && !multiTrialRandom) {
    trackMediaAssignment(assignment, element, usedImageKeys, usedGroupKeys);
  }
  if (element.name && (images.length || trialMediaSets?.some((s) => s?.length))) {
    rememberInjectedMedia(element.name, {
      items: images,
      trialMediaSets,
    });
  }

  const previewEl = toPreviewElement(element);
  const surveyJson = {
    showNavigationButtons,
    showCompletedPage: false,
    pages: [{ name: 'p1', elements: [previewEl] }],
  };

  const shownImages = images.map((img) => img.url || img).filter(Boolean);
  const shownImagesByTrial = Array.isArray(trialMediaSets)
    ? trialMediaSets.map((set) => (set || []).map((img) => img.url || img).filter(Boolean))
    : null;

  return {
    surveyJson,
    element,
    shownImages,
    shownImagesByTrial,
    assignment,
    trialMediaSets,
    shownMediaGroup: assignment?.groupId || assignment?.setId || null,
    shownMediaCategories: assignment?.categories || null,
  };
}

export function collectQuestionImageKeys(images) {
  return (images || []).map(getImageKey).filter(Boolean);
}
