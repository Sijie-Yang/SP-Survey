/** Resolve media URLs from skill question answers for results analysis. */

export function mediaFilenameKey(val) {
  if (!val || typeof val !== 'string') return String(val ?? '');
  return val.split('?')[0].split('/').pop() || val;
}

const ANSWER_URL_FIELDS = [
  'imageA', 'imageB', 'imageUrl', 'videoUrl', 'posterUrl', 'bestUrl', 'worstUrl',
];

const SKILL_CONTEXT_KEYS = new Set([
  ...ANSWER_URL_FIELDS,
  'shownUrls', 'videoName', 'demoMode',
]);

/** Keys that carry stimulus/media context, not participant measurements. */
export function isSkillContextKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (SKILL_CONTEXT_KEYS.has(key)) return true;
  // Do NOT treat research fields like `mode` (task mode) as context — only media carriers.
  if (/(Url|URL|Urls|URLs|posterUrl|Poster)$/.test(key)) return true;
  if (/^(image|video|audio)[A-Z]/.test(key) && /url|Url|URL/.test(key)) return true;
  if (/^shown/i.test(key) && /url|image|media/i.test(key)) return true;
  return false;
}

/** Remove media-context fields from a skill answer — measurements only. */
export function stripSkillAnswerContext(answer) {
  if (answer == null || typeof answer !== 'object' || Array.isArray(answer)) return answer;
  return Object.fromEntries(
    Object.entries(answer).filter(([k]) => !isSkillContextKey(k)),
  );
}

/** Format a skill answer for display (answer fields only, pretty JSON). */
export function formatSkillAnswerForDisplay(answer) {
  const clean = stripSkillAnswerContext(answer);
  if (clean == null) return '';
  if (typeof clean !== 'object') return String(clean);
  return JSON.stringify(clean, null, 2);
}

/** Extract media URLs embedded in a skill answer object. */
export function extractSkillShownImages(answer) {
  if (!answer || typeof answer !== 'object') return [];
  if (Array.isArray(answer.shownUrls) && answer.shownUrls.length) {
    return answer.shownUrls.filter(Boolean);
  }
  const urls = [];
  for (const field of ANSWER_URL_FIELDS) {
    const v = answer[field];
    if (typeof v === 'string' && v) urls.push(v);
  }
  return [...new Set(urls)];
}

/** Merge response-level shown_images with URLs stored inside skill answers. */
export function enrichSkillAnswers(answers) {
  return answers.map((entry) => {
    const fromAnswer = extractSkillShownImages(entry.answer);
    const shown = entry.shown_images?.length
      ? entry.shown_images
      : fromAnswer;
    return { ...entry, shown_images: shown };
  });
}

function addUrlToMap(map, url) {
  if (!url || typeof url !== 'string') return;
  const key = mediaFilenameKey(url);
  if (key) map.set(key, url);
  if (url.startsWith('http') || url.startsWith('/') || url.startsWith('data:')) {
    map.set(url, url);
  }
}

/** Build filename / url → display URL map from stored responses. */
export function buildResponseMediaUrlMap(responses) {
  const map = new Map();
  for (const row of responses || []) {
    for (const urls of Object.values(row.displayed_images || {})) {
      (urls || []).forEach((u) => addUrlToMap(map, u));
    }
    for (const qData of Object.values(row.responses || {})) {
      if (!qData || typeof qData !== 'object') continue;
      (qData.shown_images || []).forEach((u) => addUrlToMap(map, u));
      if (qData.answer && typeof qData.answer === 'object') {
        extractSkillShownImages(qData.answer).forEach((u) => addUrlToMap(map, u));
      }
    }
  }
  return map;
}

/** URLs assigned to a skill question element after media injection. */
export function getSkillMediaUrls(element) {
  if (!element || element.type !== 'skillquestion') return [];
  const imgs = element.skillImages || element.skillConfig?.injectedImages || [];
  return imgs.map((i) => i.url || i.name).filter(Boolean);
}

/** Canonical preset id without `preset_` prefix. */
export function skillPresetId(skillId) {
  return String(skillId || '').replace(/^preset_/, '');
}

/** Forced-Choice A/B preference skill (analyzed like imagepicker / TrueSkill). */
export function isForcedChoiceSkill(skillId) {
  const id = skillPresetId(skillId);
  return id === 'image_preference_forced' || id.endsWith('image_preference_forced');
}

/** Best–Worst / MaxDiff skill (TrueSkill + BWS; long = one row with best/worst keys). */
export function isMaxDiffSkill(skillId) {
  const id = skillPresetId(skillId);
  return id === 'best_worst_choice' || id.endsWith('best_worst_choice');
}

/** Video Key Moments skill — analysis/summary broken out by video stimulus. */
export function isVideoMomentSkill(skillId) {
  const id = skillPresetId(skillId);
  return id === 'video_moment_tag' || id.endsWith('video_moment_tag');
}

/** Filename key for the video stimulus on a key-moments / continuous-rating answer. */
export function videoStimulusKey(answer, shownImages = []) {
  const candidates = [
    answer?.videoName,
    answer?.videoUrl,
    ...(Array.isArray(shownImages) ? shownImages : []),
    answer?.posterUrl,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const key = mediaFilenameKey(typeof c === 'string' ? c : c?.url || c?.name || '');
    if (key) return key;
  }
  return '(unknown_video)';
}

/** Primary image stimulus key (single-image skills). */
export function imageStimulusKey(answer, shownImages = []) {
  const candidates = [
    answer?.imageUrl,
    ...(Array.isArray(shownImages) ? shownImages : []),
    answer?.posterUrl,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const key = mediaFilenameKey(typeof c === 'string' ? c : c?.url || c?.name || '');
    if (key) return key;
  }
  return '(unknown_image)';
}

/** Pairwise A/B shown keys from slider / forced-choice answers. */
export function pairwiseShownKeys(answer, shownImages = []) {
  const fromAnswer = [answer?.imageA, answer?.imageB].filter(Boolean).map(mediaFilenameKey);
  if (fromAnswer.length >= 2) return fromAnswer;
  const fromShown = (Array.isArray(shownImages) ? shownImages : [])
    .map((s) => mediaFilenameKey(typeof s === 'string' ? s : s?.url || s?.name || ''))
    .filter(Boolean);
  return fromShown.length ? fromShown : fromAnswer;
}

export function isPairwiseSliderSkill(skillId) {
  const id = skillPresetId(skillId);
  return id === 'image_preference_slider' || id.endsWith('image_preference_slider');
}

export function isEmotionColorSkill(skillId) {
  const id = skillPresetId(skillId);
  return id === 'emotion_color_picker' || id.endsWith('emotion_color_picker');
}

export function isContinuousVideoSkill(skillId) {
  const id = skillPresetId(skillId);
  return id === 'video_continuous_rating' || id.endsWith('video_continuous_rating');
}

export function isCompositeBlocksSkill(skillId) {
  const id = skillPresetId(skillId);
  return id === 'composite_blocks' || id.endsWith('composite_blocks');
}

/** Detect whether an answer belongs to a preset skill (guards cross-iframe contamination). */
export function matchesPresetSkillAnswer(skillId, answer) {
  if (!answer || typeof answer !== 'object') return false;
  const id = skillId?.replace(/^preset_/, '');
  switch (id) {
    case 'video_moment_tag':
      return Array.isArray(answer.segments);
    case 'video_continuous_rating':
      return Array.isArray(answer.samples);
    case 'image_preference_slider':
      return typeof answer.preference === 'number';
    case 'image_preference_forced':
      return answer.choice === 'A' || answer.choice === 'B' || answer.chosenIndex === 0 || answer.chosenIndex === 1;
    case 'best_worst_choice':
      return answer.bestIndex != null || answer.worstIndex != null;
    case 'emotion_color_picker':
      return answer.color != null && typeof answer.color === 'object';
    case 'composite_blocks':
      return Array.isArray(answer.ratings)
        || Array.isArray(answer.words)
        || answer.choice != null
        || (typeof answer.text === 'string' && answer.text !== '');
    default:
      return true;
  }
}

/** Drop answers written to the wrong question by a shared postMessage listener (legacy data). */
export function filterAnswersForSkill(answers, skillId) {
  if (!skillId?.startsWith('preset_')) return answers;
  return answers.filter((entry) => matchesPresetSkillAnswer(skillId, entry.answer));
}
