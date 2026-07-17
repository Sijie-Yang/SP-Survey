/**
 * Pure helpers for SurveyApp completion payload construction.
 * Keeps media metadata contracts testable without SurveyJS/DOM.
 */

import { slotsToShownMedia } from './mediaSlots';

/** Map SurveyJS image_N / media_N choice values back to shown image URLs/names. */
export function mapImageChoiceAnswerToNames(answerValue, shownImages) {
  if (!shownImages || shownImages.length === 0) return answerValue;

  const mapSingleValue = (value) => {
    if (typeof value !== 'string') return value;
    const match = value.match(/^(?:image|media)_(\d+)$/);
    if (!match) return value;
    const imageIndex = parseInt(match[1], 10);
    return shownImages[imageIndex] || value;
  };

  if (Array.isArray(answerValue)) {
    return answerValue.map(mapSingleValue);
  }
  return mapSingleValue(answerValue);
}

function resolveShownMediaIds(shownImages, preloadedImages = []) {
  const pool = preloadedImages || [];
  return (shownImages || []).map((u) => {
    if (!u) return null;
    const hit = pool.find((img) => img.url === u || img.name === u);
    return hit?.media_id || hit?.key || String(u).split('?')[0].split('/').pop() || u;
  }).filter(Boolean);
}

function buildShownMedia(questionName, displayedMediaSlots, shownImages, preloadedImages) {
  const slots = displayedMediaSlots?.[questionName];
  if (Array.isArray(slots) && slots.length) {
    return slotsToShownMedia(slots);
  }
  // Legacy flatten → synthetic slots for CSV consistency
  return (shownImages || []).map((u, i) => {
    const name = u ? String(u).split('?')[0].split('/').pop() : '';
    const hit = (preloadedImages || []).find((img) => img.url === u || img.name === u || img.name === name);
    return {
      slotId: `legacy_${i}`,
      role: 'stimulus',
      type: hit?.type || 'image',
      name: hit?.name || name,
      media_id: hit?.media_id || hit?.key || name,
      url: hit?.url || u || '',
      setId: null,
    };
  });
}

/**
 * Build per-question enriched response objects and top-level displayed_* mirrors.
 */
export function enrichSurveyResponses({
  responses = {},
  questionTypeMap = {},
  displayedImages = {},
  displayedMediaGroups = {},
  displayedMediaCategories = {},
  displayedMediaSlots = {},
  preloadedImages = [],
} = {}) {
  const enrichedResponses = Object.entries(responses || {}).reduce((acc, [questionName, answerValue]) => {
    // Multi-trial answers: { trials: [{ value, shown_images, shown_media_ids }, ...] }
    if (answerValue && typeof answerValue === 'object' && Array.isArray(answerValue.trials)) {
      const trials = answerValue.trials.map((trial, trialIndex) => {
        const shownImages = trial?.shown_images?.length
          ? trial.shown_images
          : (displayedImages[`${questionName}__trials`]?.[trialIndex]
            || displayedImages[questionName]
            || []);
        const mappedAnswer = mapImageChoiceAnswerToNames(trial?.value, shownImages);
        return {
          trial_index: trialIndex,
          answer: mappedAnswer,
          shown_images: shownImages,
          shown_media_ids: trial?.shown_media_ids?.length
            ? trial.shown_media_ids
            : resolveShownMediaIds(shownImages, preloadedImages),
          shown_media: buildShownMedia(
            questionName, displayedMediaSlots, shownImages, preloadedImages,
          ),
        };
      });
      acc[questionName] = {
        type: questionTypeMap[questionName] || null,
        trials,
        answer: trials.map((t) => t.answer),
        shown_images: trials[0]?.shown_images || displayedImages[questionName] || [],
        shown_media_ids: trials[0]?.shown_media_ids || [],
        shown_media_set: displayedMediaGroups[questionName] || null,
        shown_media_group: displayedMediaGroups[questionName] || null,
        shown_media_categories: displayedMediaCategories[questionName] || null,
        shown_media: trials[0]?.shown_media || [],
      };
      return acc;
    }

    const shownImages = displayedImages[questionName] || [];
    const mappedAnswer = mapImageChoiceAnswerToNames(answerValue, shownImages);
    const shown_media = buildShownMedia(
      questionName, displayedMediaSlots, shownImages, preloadedImages,
    );
    acc[questionName] = {
      type: questionTypeMap[questionName] || null,
      answer: mappedAnswer,
      shown_images: shownImages,
      shown_media_ids: resolveShownMediaIds(shownImages, preloadedImages),
      shown_media_set: displayedMediaGroups[questionName] || null,
      shown_media_group: displayedMediaGroups[questionName] || null,
      shown_media_categories: displayedMediaCategories[questionName] || null,
      shown_media,
    };
    return acc;
  }, {});

  return {
    enrichedResponses,
    displayed_images: { ...(displayedImages || {}) },
    displayed_media_groups: { ...(displayedMediaGroups || {}) },
    displayed_media_categories: { ...(displayedMediaCategories || {}) },
    displayed_media_slots: { ...(displayedMediaSlots || {}) },
  };
}
