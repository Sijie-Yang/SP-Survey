/**
 * Resolve display images for legacy image* widgets that prefer choices[].imageLink
 * but may only have imageLinks / imageUrls after media injection.
 */

function imageLinkFromChoice(choice) {
  if (!choice) return null;
  if (choice.imageLink) return choice.imageLink;
  if (typeof choice.getPropertyValue === 'function') {
    return choice.getPropertyValue('imageLink') || null;
  }
  if (choice.propertyHash?.imageLink) return choice.propertyHash.imageLink;
  return null;
}

/** Normalize TrialShell's per-trial media into choice-shaped objects. */
export function resolveTrialStimulusChoices(trialStimulusMedia) {
  if (!Array.isArray(trialStimulusMedia) || !trialStimulusMedia.length) return [];
  return trialStimulusMedia
    .map((m, index) => {
      const url = typeof m === 'string' ? m : m?.url;
      if (!url) return null;
      return {
        value: `image_${index}`,
        imageLink: url,
        imageName: typeof m === 'string' ? undefined : (m?.name || undefined),
      };
    })
    .filter(Boolean);
}

/**
 * @param {object} question
 * @param {Array|null} [trialStimulusMedia] — when set (multi-trial), wins over stale
 *   question.imageHtml / choices from the previous trial.
 * @returns {{ value: string, imageLink: string, imageName?: string }[]}
 */
export function resolveQuestionImageChoices(question, trialStimulusMedia = null) {
  const fromTrial = resolveTrialStimulusChoices(trialStimulusMedia);
  if (fromTrial.length) return fromTrial;

  if (!question) return [];

  const fromChoices = (question.choices || [])
    .map((choice, index) => {
      const imageLink = imageLinkFromChoice(choice);
      if (!imageLink) return null;
      const value = choice.value != null ? String(choice.value) : `image_${index}`;
      const imageName = choice.imageName
        || (typeof choice.getPropertyValue === 'function' ? choice.getPropertyValue('imageName') : null)
        || undefined;
      return { value, imageLink, imageName };
    })
    .filter(Boolean);
  if (fromChoices.length) return fromChoices;

  const links = question.imageLinks || question.imageUrls || [];
  const names = question.imageNames || [];
  if (Array.isArray(links) && links.length) {
    return links.filter(Boolean).map((url, index) => ({
      value: `image_${index}`,
      imageLink: url,
      imageName: names[index],
    }));
  }

  return [];
}
