/**
 * Shared media/random-pool injection for SurveyApp and SurveyPreview.
 */
import {
  filterMediaByType, inferMediaType, normalizeMediaEntry, getEligibleMediaGroups,
  buildMediaByCategory, getMediaCategories, parseMediaCategory, summarizeMediaGroupsBySize,
} from './mediaUtils';
import { getSkillById } from './skillManager';
import { buildFallbackDemoImages, getPresetSkill } from './presetSkills';

/** Build justified image gallery HTML (same layout as imagerating panels). */
export function buildImageGalleryHtml(selectedImages) {
  let html = '<div class="sp-image-gallery">';
  (selectedImages || []).forEach((image) => {
    html += `<div class="sp-image-gallery__item"><div class="sp-image-gallery__image-container"><img src="${image.url}" data-image-url="${image.url}" data-image-name="${image.name || ''}" alt="${image.name || ''}" /></div></div>`;
  });
  html += '</div>';
  return html;
}

function skillFromPreset(skillId) {
  if (!skillId?.startsWith('preset_')) return null;
  const preset = getPresetSkill(skillId.replace(/^preset_/, ''));
  if (!preset) return null;
  return {
    id: skillId,
    name: preset.name,
    sourceHtml: preset.sourceHtml,
    defaultConfig: preset.defaultConfig,
    resultSchema: preset.resultSchema || [],
  };
}

export const RANDOM_MEDIA_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix',
  'mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation',
  'imageslidergroup', 'imagepointallocation',
]);

export function isSkillMediaQuestion(element) {
  return element.type === 'skillquestion' && !!element.randomImageSelection;
}

export function isRandomMediaQuestion(element) {
  return RANDOM_MEDIA_TYPES.has(element.type) || isSkillMediaQuestion(element);
}

/** Media display/rating types inject from project pool unless explicitly disabled. */
export function shouldInjectMedia(element) {
  if (!isRandomMediaQuestion(element)) return false;
  if (element.imageSelectionMode === 'huggingface_manual' || element.imageSelectionMode === 'manual') {
    return false;
  }
  if (['mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation'].includes(element.type)) {
    return element.randomImageSelection !== false;
  }
  return !!element.randomImageSelection;
}

function toPlainArray(maybeArray) {
  if (!maybeArray) return [];
  if (Array.isArray(maybeArray)) return maybeArray;
  if (typeof maybeArray.length === 'number') {
    try {
      return Array.from(maybeArray);
    } catch {
      const out = [];
      for (let i = 0; i < maybeArray.length; i += 1) {
        if (maybeArray[i] !== undefined) out.push(maybeArray[i]);
      }
      return out;
    }
  }
  return [];
}

/**
 * Resolve injected media for mediadisplay / mediarating / mediaboolean widgets.
 * SurveyJS strips object-array properties (mediaItems) during deserialization;
 * fall back to mediaUrls / mediaNames / mediaTypes parallel arrays.
 */
export function resolveQuestionMediaItems(question) {
  if (!question) return [];
  const fromItems = toPlainArray(question.mediaItems)
    .map(normalizeMediaEntry)
    .filter((m) => m?.url);
  if (fromItems.length) return fromItems;

  const urls = toPlainArray(question.mediaUrls);
  if (urls.length) {
    const names = toPlainArray(question.mediaNames);
    const types = toPlainArray(question.mediaTypes);
    const filterType = question.mediaType && question.mediaType !== 'any' ? question.mediaType : null;
    return urls.map((url, i) => normalizeMediaEntry({
      url,
      name: names[i] || '',
      type: types[i] || inferMediaType(names[i] || url),
    })).filter((m) => m?.url && (!filterType || m.type === filterType));
  }

  if (question.mediaUrl) {
    const one = normalizeMediaEntry({
      url: question.mediaUrl,
      name: question.mediaName,
      type: question.mediaType || inferMediaType(question.mediaUrl),
    });
    return one?.url ? [one] : [];
  }
  return [];
}

export function defaultMediaCount(element) {
  if (element.type === 'skillquestion') {
    return element.imageCount || element.skillConfig?.mediaCount || 1;
  }
  if (['imagerating', 'imagematrix', 'imageboolean', 'image', 'mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation', 'imageslidergroup', 'imagepointallocation'].includes(element.type)) {
    return 1;
  }
  return 4;
}

export function getMediaTypeFilter(element) {
  if (element.type === 'skillquestion') {
    return element.skillConfig?.mediaType || 'image';
  }
  if (element.type === 'imageannotation') return 'image';
  if (['mediadisplay', 'mediarating', 'mediaboolean'].includes(element.type)) {
    return element.mediaType || 'any';
  }
  if (['imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix', 'imageslidergroup', 'imagepointallocation'].includes(element.type)) {
    return 'image';
  }
  return 'any';
}

export function filterPoolForQuestion(pool, element) {
  const mediaType = getMediaTypeFilter(element);
  return filterMediaByType(pool, mediaType).map(normalizeMediaEntry).filter(Boolean);
}

/** Admin UI: project-wide vs question-filtered media/pairing/category counts. */
export function getMediaPoolStatus(projectPool, question = null) {
  const totalFileCount = (projectPool || []).length;
  const matchingFiles = question
    ? filterPoolForQuestion(projectPool, question)
    : (projectPool || []).map(normalizeMediaEntry).filter(Boolean);
  const matchingFileCount = matchingFiles.length;
  const mediaTypeFilter = question ? getMediaTypeFilter(question) : 'any';
  const pairedSummary = summarizeMediaGroupsBySize(matchingFiles);
  const projectCategoryCount = getMediaCategories(
    (projectPool || []).map(normalizeMediaEntry).filter(Boolean),
  ).length;
  const matchingCategoryLabels = getMediaCategories(matchingFiles);
  const matchingCategoryCount = matchingCategoryLabels.length;
  const filesPerSet = question
    ? (question.imageCount || defaultMediaCount(question))
    : null;
  const eligibleGroupCount = question?.mediaAssignmentMode === 'group'
    ? (matchingFileCount > 0 && filesPerSet
      ? getEligibleMediaGroups(matchingFiles, filesPerSet).length
      : 0)
    : null;

  return {
    totalFileCount,
    matchingFileCount,
    mediaTypeFilter,
    pairedSetCount: pairedSummary.total,
    pairedSetsBySize: pairedSummary.bySize,
    projectCategoryCount,
    matchingCategoryCount,
    matchingCategoryLabels,
    eligibleGroupCount,
    filesPerSet,
  };
}

export function usesGroupMediaAssignment(element) {
  return element?.mediaAssignmentMode === 'group';
}

export function usesCategoryMediaAssignment(element) {
  return element?.mediaAssignmentMode === 'category';
}

function pickOnePerCategory(pool, element, globallyUsedImageKeys) {
  const byCategory = buildMediaByCategory(pool);
  const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
  const excludeUsed = element.excludePreviouslyUsedImages !== false;
  const images = [];
  const assignedCategories = [];

  for (const cat of categories) {
    let catPool = byCategory.get(cat) || [];
    if (excludeUsed && globallyUsedImageKeys) {
      catPool = catPool.filter((img) => {
        const key = getImageKey(img);
        return key && !globallyUsedImageKeys.has(key);
      });
    }
    if (!catPool.length) continue;
    const shuffled = [...catPool].sort(() => 0.5 - Math.random());
    images.push(shuffled[0]);
    assignedCategories.push(cat);
  }

  return { images, groupKey: null, groupId: null, categories: assignedCategories };
}

export function getImageKey(image) {
  return image?.name || image?.url;
}

export function getGroupTrackingKey(group) {
  return group?.groupKey || group?.groupId || null;
}

/**
 * Pick media for a question — individual files or a fixed-size filename group.
 * Returns { images, groupKey, groupId }.
 */
export function pickRandomMediaForQuestion(pool, element, globallyUsedImageKeys, globallyUsedGroupKeys, pairStats = null) {
  const imageCount = element.imageCount || defaultMediaCount(element);
  const excludeUsed = element.excludePreviouslyUsedImages !== false;
  const pairingMode = element.pairingMode || 'random';

  if (usesCategoryMediaAssignment(element)) {
    const picked = pickOnePerCategory(pool, element, globallyUsedImageKeys);
    return picked;
  }

  if (usesGroupMediaAssignment(element)) {
    let eligible = getEligibleMediaGroups(pool, imageCount);
    if (excludeUsed && globallyUsedGroupKeys) {
      eligible = eligible.filter((g) => {
        const key = getGroupTrackingKey(g);
        return key && !globallyUsedGroupKeys.has(key);
      });
    }
    const shuffled = [...eligible].sort(() => 0.5 - Math.random());
    const picked = shuffled[0];
    if (!picked) return { images: [], groupKey: null, groupId: null };
    return {
      images: picked.members,
      groupKey: picked.groupKey,
      groupId: picked.groupId,
    };
  }

  // Pairwise pairing modes (imageCount === 2, individual assignment)
  if (imageCount === 2 && pairingMode !== 'random' && pool.length >= 2) {
    let candidates = [...pool];
    if (excludeUsed && globallyUsedImageKeys) {
      candidates = candidates.filter((img) => {
        const key = getImageKey(img);
        return key && !globallyUsedImageKeys.has(key);
      });
    }
    if (candidates.length < 2) {
      candidates = [...pool];
    }

    const exposure = (img) => {
      const key = getImageKey(img);
      return pairStats?.[key]?.exposures ?? 0;
    };
    const mu = (img) => {
      const key = getImageKey(img);
      return pairStats?.[key]?.mu ?? 25;
    };

    if (pairingMode === 'balanced') {
      const sorted = [...candidates].sort((a, b) => exposure(a) - exposure(b) || Math.random() - 0.5);
      return { images: sorted.slice(0, 2), groupKey: null, groupId: null };
    }

    if (pairingMode === 'adaptive') {
      let bestPair = null;
      let bestGap = Infinity;
      for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
          const gap = Math.abs(mu(candidates[i]) - mu(candidates[j]));
          const expSum = exposure(candidates[i]) + exposure(candidates[j]);
          const score = gap + expSum * 0.01;
          if (score < bestGap) {
            bestGap = score;
            bestPair = [candidates[i], candidates[j]];
          }
        }
      }
      if (bestPair) return { images: bestPair, groupKey: null, groupId: null };
    }
  }

  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  let candidates = shuffled;
  if (excludeUsed && globallyUsedImageKeys) {
    candidates = shuffled.filter((img) => {
      const key = getImageKey(img);
      return key && !globallyUsedImageKeys.has(key);
    });
  }
  return { images: candidates.slice(0, imageCount), groupKey: null, groupId: null };
}

export function trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedGroupKeys) {
  if (element.excludePreviouslyUsedImages === false) return;
  const { images, groupKey } = assignment;
  if (groupKey && globallyUsedGroupKeys) globallyUsedGroupKeys.add(groupKey);
  if (!globallyUsedImageKeys) return;
  (images || []).forEach((img) => {
    const key = getImageKey(img);
    if (key) globallyUsedImageKeys.add(key);
  });
}

/** Build a log entry describing what media was injected into a question. */
export function buildMediaAssignmentLogEntry(element, selectedImages, groupId = null, categories = null) {
  return {
    questionName: element.name,
    questionTitle: element.title || element.name,
    mode: element.mediaAssignmentMode || 'individual',
    groupId: groupId || element.assignedMediaGroupId || null,
    categories: categories || element.assignedMediaCategories || null,
    fileNames: (selectedImages || []).map((img) => img.name).filter(Boolean),
    files: (selectedImages || []).map((img) => ({
      name: img.name,
      type: img.type || inferMediaType(img.name || img.url),
      url: img.url,
      category: (() => {
        const { category, hasCategory } = parseMediaCategory(img.name);
        return hasCategory ? category : null;
      })(),
    })),
  };
}

function setMediaItems(element, selectedImages) {
  const items = selectedImages.map((img) => ({
    url: img.url,
    name: img.name,
    type: img.type || inferMediaType(img.url || img.name),
  }));
  element.mediaItems = items;
  element.mediaUrls = items.map((i) => i.url);
  element.mediaNames = items.map((i) => i.name);
  element.mediaTypes = items.map((i) => i.type);
}

export function applyMediaToElement(element, selectedImages) {
  if (!selectedImages?.length) return;
  const first = selectedImages[0];

  if (element.type === 'skillquestion') {
    const injected = selectedImages.map((img) => ({
      name: img.name,
      url: img.url,
      type: img.type || inferMediaType(img.url),
    }));
    element.skillImages = injected;
    // SurveyJS strips url/type from array properties during deserialization
    // (treats items as ItemValue). Object properties pass through intact, so
    // the authoritative copy lives inside skillConfig.
    element.skillConfig = { ...(element.skillConfig || {}), injectedImages: injected };
    return;
  }

  if (element.type === 'image') {
    element.imageLink = first.url;
    element.imageName = first.name;
    if (selectedImages.length > 1) {
      element.imageLinks = selectedImages.map((img) => img.url);
      element.imageNames = selectedImages.map((img) => img.name);
    }
    return;
  }

  if (['mediadisplay', 'mediarating', 'mediaboolean'].includes(element.type)) {
    setMediaItems(element, selectedImages);
    element.mediaUrl = first.url;
    element.mediaName = first.name;
    element.mediaType = first.type || inferMediaType(first.url);
    const imageEntries = selectedImages.filter((img) => !img.type || img.type === 'image');
    if (imageEntries.length) {
      element.imageHtml = buildImageGalleryHtml(imageEntries);
    }
    return;
  }

  if (element.type === 'imageannotation') {
    element.annotationImageUrl = first.url;
    return;
  }

  if (['imageboolean', 'imagerating', 'imagematrix', 'imageslidergroup', 'imagepointallocation'].includes(element.type)) {
    element.imageLinks = selectedImages.map((img) => img.url);
    element.imageNames = selectedImages.map((img) => img.name);
    element.imageHtml = buildImageGalleryHtml(selectedImages);
    return;
  }

  element.choices = selectedImages.map((image, index) => ({
    value: `image_${index}`,
    imageLink: image.url,
    imageName: image.name,
  }));
  element.imageUrls = selectedImages.map((img) => img.url);
  element.imageNames = selectedImages.map((img) => img.name);
  if (!element.imageFit) element.imageFit = 'contain';
}

/** Fill skillImages from skillConfig.demoImages or built-in fallbacks. */
export function ensureSkillDemoMedia(element) {
  if (element.type !== 'skillquestion') return;
  if (element.skillImages?.length) return;

  const cfg = { ...(element.skillConfig || {}) };
  if (element.skillId) cfg.skillId = element.skillId;

  let demos = cfg.demoImages;
  if (!demos?.length) {
    demos = buildFallbackDemoImages(
      element.imageCount || cfg.mediaCount || 1,
      cfg.mediaType || 'image',
      element.skillId,
    );
  }

  element.skillImages = demos.map((entry) => normalizeMediaEntry(entry)).filter(Boolean);
  element.skillConfig = { ...cfg, demoImages: demos };
}

/** Resolve skillquestion elements: merge skill metadata + demo media. */
export async function resolveSkillQuestions(surveyJson) {
  if (!surveyJson?.pages) return;
  for (const page of surveyJson.pages) {
    if (!page.elements) continue;
    for (const el of page.elements) {
      if (el.type !== 'skillquestion' || !el.skillId) continue;
      let skill = await getSkillById(el.skillId);
      if (!skill) skill = skillFromPreset(el.skillId);
      if (skill) {
        el.skillHtml = skill.sourceHtml || el.skillHtml;
        const merged = { ...(skill.defaultConfig || {}), ...(el.skillConfig || {}) };
        if (skill.defaultConfig?.demoImages?.length) {
          merged.demoImages = skill.defaultConfig.demoImages;
        }
        el.skillConfig = merged;
      } else if (!el.skillHtml && el.skillId?.startsWith('preset_')) {
        const preset = skillFromPreset(el.skillId);
        if (preset) el.skillHtml = preset.sourceHtml;
      }
      // Skill questions always take part in random media injection unless explicitly disabled
      if (el.randomImageSelection === undefined || el.randomImageSelection === null) {
        el.randomImageSelection = true;
      }
      ensureSkillDemoMedia(el);
    }
  }
}
