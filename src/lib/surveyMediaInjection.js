/**
 * Shared media/random-pool injection for SurveyApp and SurveyPreview.
 */
import {
  filterMediaByType, inferMediaType, normalizeMediaEntry,
  getEligibleMediaSets, buildMediaByFolderCategory, getFolderCategories,
  summarizeTaggedSetsBySize, normalizeMediaAssignmentMode, normalizeFolderPath,
  getRecursiveMedia, MEDIA_FOLDER_TAG_SET, MEDIA_FOLDER_TAG_CATEGORY,
} from './mediaUtils';
import { getSkillById } from './skillManager';
import { getPresetSkill } from './presetSkills';
import { enrichEmotionColorConfig } from './emotionColor';
import {
  hasMediaSlots, resolveMediaSlots, legacyAssignmentToSlots,
  applyResolvedSlotsToElement, MEDIA_STAR_TYPES, isMediaStarType,
} from './mediaSlots';

export {
  hasMediaSlots, resolveMediaSlots, legacyAssignmentToSlots,
  applyResolvedSlotsToElement, MEDIA_STAR_TYPES, isMediaStarType,
} from './mediaSlots';

/**
 * Runtime store for injected media — SurveyJS often drops mediaItems / trialMediaSets
 * from the Model, so widgets read from here by question name.
 * Shape: name -> { items: Media[], trialMediaSets?: Media[][] }
 */
const injectedMediaByQuestion = new Map();

export function clearInjectedMediaStore() {
  injectedMediaByQuestion.clear();
}

export function rememberInjectedMedia(questionName, {
  items = [],
  trialMediaSets = null,
} = {}) {
  if (!questionName) return;
  const normalizedItems = (items || []).map((m) => normalizeMediaEntry(m)).filter((m) => m?.url);
  const normalizedTrials = Array.isArray(trialMediaSets)
    ? trialMediaSets.map((set) => (
      (set || []).map((m) => normalizeMediaEntry(m)).filter((m) => m?.url)
    ))
    : null;
  const prev = injectedMediaByQuestion.get(questionName) || {};
  injectedMediaByQuestion.set(questionName, {
    items: normalizedItems.length ? normalizedItems : (prev.items || []),
    trialMediaSets: (normalizedTrials && normalizedTrials.some((s) => s?.length))
      ? normalizedTrials
      : (prev.trialMediaSets || null),
  });
}

export function getRememberedInjectedMedia(questionName) {
  if (!questionName) return null;
  return injectedMediaByQuestion.get(questionName) || null;
}

function mediaItemsFromImageHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const nameMatch = m[0].match(/data-image-name=["']([^"']*)["']/i);
    out.push(normalizeMediaEntry({
      url,
      name: nameMatch?.[1] || url.split('/').pop() || '',
      type: 'image',
    }));
  }
  return out.filter((x) => x?.url);
}

/**
 * Folder tags for set/category assignment.
 * Falls back to inferring tags from question mediaFolders when the project/template
 * has not yet stored imageDatasetConfig (common in template preview before re-import).
 */
export function resolveMediaFolderTags(projectOrConfig, surveyConfig = null) {
  const tags = {
    ...(projectOrConfig?.imageDatasetConfig?.mediaFolderTags
      || projectOrConfig?.mediaFolderTags
      || {}),
  };
  const pages = surveyConfig?.pages || projectOrConfig?.config?.pages || [];
  pages.forEach((page) => {
    (page.elements || []).forEach((el) => {
      const mode = normalizeMediaAssignmentMode(el?.mediaAssignmentMode);
      const folders = Array.isArray(el?.mediaFolders) ? el.mediaFolders : [];
      folders.forEach((raw) => {
        const folder = normalizeFolderPath(raw);
        if (!folder || tags[folder]) return;
        if (mode === 'set') tags[folder] = MEDIA_FOLDER_TAG_SET;
        if (mode === 'category') tags[folder] = MEDIA_FOLDER_TAG_CATEGORY;
      });
    });
  });
  return tags;
}

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
  'mediadisplay', 'mediarating', 'mediaboolean', 'mediaranking', 'mediapicker',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  'imageannotation',
  'imageslidergroup', 'imagepointallocation',
]);

export function isSkillMediaQuestion(element) {
  return element.type === 'skillquestion' && !!element.randomImageSelection;
}

export function isRandomMediaQuestion(element) {
  return RANDOM_MEDIA_TYPES.has(element.type) || isSkillMediaQuestion(element);
}

export function isCuratedMediaMode(element) {
  return element?.imageSelectionMode === 'huggingface_manual'
    || element?.imageSelectionMode === 'manual';
}

/** Media display/rating types inject from project pool unless curated/manual. */
export function shouldInjectMedia(element) {
  if (!isRandomMediaQuestion(element)) return false;
  if (isCuratedMediaMode(element)) {
    return false;
  }
  // media* / annotation / slots: Serializer defaults randomImageSelection=false, which
  // previously skipped injection even when imageSelectionMode is huggingface_random.
  if ([
    'mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation',
    'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  ].includes(element.type) || hasMediaSlots(element)) {
    return true;
  }
  return !!element.randomImageSelection;
}

/** Resolve curated selectedImageUrls against the project pool (or bare URLs). */
export function resolveCuratedImages(element, projectImages = []) {
  const urls = Array.isArray(element?.selectedImageUrls) ? element.selectedImageUrls : [];
  if (!urls.length) return [];
  const byUrl = new Map((projectImages || []).map((img) => [img.url, img]));
  return urls.map((url) => {
    const found = byUrl.get(url);
    if (found) return normalizeMediaEntry(found);
    const name = String(url).split('?')[0].split('/').pop() || url;
    return normalizeMediaEntry({ url, name });
  }).filter((m) => m?.url);
}

/**
 * Apply curated list media at runtime/preview when random injection is skipped.
 * Returns true when media was applied from selectedImageUrls.
 */
export function applyCuratedMediaIfNeeded(element, projectImages = []) {
  if (!element || !isCuratedMediaMode(element)) return false;
  // imagepicker / imageranking / mediaranking already persist choices on save
  if (
    (element.type === 'imagepicker' || element.type === 'imageranking' || element.type === 'mediaranking')
    && Array.isArray(element.choices)
    && element.choices.length > 0
  ) {
    return false;
  }
  const images = resolveCuratedImages(element, projectImages);
  if (!images.length) return false;
  applyMediaToElement(element, images);
  return true;
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
 * Order: runtime store → mediaItems → mediaUrls → mediaUrl → imageHtml.
 * Do not re-filter by mediaType here — that filter applies at pool pick time only.
 */
export function resolveQuestionMediaItems(question) {
  if (!question) return [];
  const name = question.name;
  const remembered = getRememberedInjectedMedia(name);
  if (remembered?.items?.length) return remembered.items;

  const readProp = (key) => {
    try {
      if (typeof question.getPropertyValue === 'function') {
        const v = question.getPropertyValue(key);
        if (v !== undefined && v !== null) return v;
      }
    } catch { /* ignore */ }
    return question[key];
  };

  const fromItems = toPlainArray(readProp('mediaItems'))
    .map(normalizeMediaEntry)
    .filter((m) => m?.url);
  if (fromItems.length) return fromItems;

  const urls = toPlainArray(readProp('mediaUrls'));
  if (urls.length) {
    const names = toPlainArray(readProp('mediaNames'));
    const types = toPlainArray(readProp('mediaTypes'));
    return urls.map((url, i) => normalizeMediaEntry({
      url,
      name: names[i] || '',
      type: types[i] || inferMediaType(names[i] || url),
    })).filter((m) => m?.url);
  }

  const mediaUrl = readProp('mediaUrl');
  if (mediaUrl) {
    const one = normalizeMediaEntry({
      url: mediaUrl,
      name: readProp('mediaName'),
      type: inferMediaType(readProp('mediaName') || mediaUrl),
    });
    return one?.url ? [one] : [];
  }

  const fromHtml = mediaItemsFromImageHtml(readProp('imageHtml'));
  if (fromHtml.length) return fromHtml;

  const links = [
    ...toPlainArray(readProp('imageLinks')),
    ...toPlainArray(readProp('imageUrls')),
  ].filter(Boolean);
  if (links.length) {
    const names = toPlainArray(readProp('imageNames'));
    return links.map((url, i) => normalizeMediaEntry({
      url,
      name: names[i] || '',
      type: inferMediaType(names[i] || url),
    })).filter((m) => m?.url);
  }

  return [];
}

export function defaultMediaCount(element) {
  if (element.type === 'skillquestion') {
    return element.imageCount || element.skillConfig?.mediaCount || 1;
  }
  if ([
    'imagerating', 'imagematrix', 'imageboolean', 'image',
    'mediadisplay', 'mediarating', 'mediaboolean', 'mediamatrix',
    'mediaslidergroup', 'mediapointallocation', 'imageannotation',
    'imageslidergroup', 'imagepointallocation',
  ].includes(element.type)) {
    return 1;
  }
  return 4;
}

export function getMediaTypeFilter(element) {
  if (element.type === 'skillquestion') {
    return element.skillConfig?.mediaType || 'image';
  }
  if (element.type === 'imageannotation') return 'image';
  // Slots resolve per-slot types — pool stays unfiltered at question level
  if (hasMediaSlots(element)) return 'any';
  if (isMediaStarType(element.type)) {
    return element.mediaType || 'any';
  }
  if (['imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix', 'imageslidergroup', 'imagepointallocation'].includes(element.type)) {
    return 'image';
  }
  return 'any';
}

/**
 * Unified picker: mediaSlots path or legacy pickRandomMediaForQuestion.
 * Always returns { images, slots, flatMedia, setId, ... }.
 */
export function pickMediaForQuestion(
  pool,
  element,
  globallyUsedImageKeys,
  globallyUsedSetKeys,
  pairStats = null,
  folderTags = {},
) {
  if (hasMediaSlots(element)) {
    return resolveMediaSlots(
      pool, element, globallyUsedImageKeys, globallyUsedSetKeys, folderTags,
    );
  }
  const assignment = pickRandomMediaForQuestion(
    pool, element, globallyUsedImageKeys, globallyUsedSetKeys, pairStats, folderTags,
  );
  return legacyAssignmentToSlots(assignment);
}

export function filterPoolForQuestion(pool, element) {
  const mediaType = getMediaTypeFilter(element);
  return filterMediaByType(pool, mediaType).map(normalizeMediaEntry).filter(Boolean);
}

/** Admin UI: project-wide vs question-filtered media/set/category counts. */
export function getMediaPoolStatus(projectPool, question = null, folderTags = {}) {
  const totalFileCount = (projectPool || []).length;
  const matchingFiles = question
    ? filterPoolForQuestion(projectPool, question)
    : (projectPool || []).map((e) => normalizeMediaEntry(e)).filter(Boolean);
  const matchingFileCount = matchingFiles.length;
  const mediaTypeFilter = question ? getMediaTypeFilter(question) : 'any';
  const pairedSummary = summarizeTaggedSetsBySize(matchingFiles, folderTags);
  const projectCategoryCount = getFolderCategories(
    (projectPool || []).map((e) => normalizeMediaEntry(e)).filter(Boolean),
    folderTags,
  ).length;
  const matchingCategoryLabels = getFolderCategories(matchingFiles, folderTags, {
    scopeFolders: question?.mediaFolders,
  });
  const matchingCategoryCount = matchingCategoryLabels.length;
  const mediaPerCategory = question ? getMediaPerCategory(question) : 1;
  const filesPerSet = question
    ? (question.imageCount || defaultMediaCount(question))
    : null;
  const mode = normalizeMediaAssignmentMode(question?.mediaAssignmentMode);
  const eligibleSetCount = mode === 'set'
    ? (matchingFileCount > 0 && filesPerSet
      ? getEligibleMediaSets(matchingFiles, filesPerSet, folderTags, {
        scopeFolders: question?.mediaFolders,
      }).length
      : 0)
    : null;
  const expectedCategoryTotal = mode === 'category' && matchingCategoryCount > 0
    ? matchingCategoryCount * mediaPerCategory
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
    eligibleGroupCount: eligibleSetCount,
    eligibleSetCount,
    filesPerSet,
    mediaPerCategory,
    expectedCategoryTotal,
    taggedSetCount: pairedSummary.total,
    folderTags,
  };
}

export function usesSetMediaAssignment(element) {
  return normalizeMediaAssignmentMode(element?.mediaAssignmentMode) === 'set';
}

/** @deprecated Use usesSetMediaAssignment */
export function usesGroupMediaAssignment(element) {
  return usesSetMediaAssignment(element);
}

export function usesCategoryMediaAssignment(element) {
  return normalizeMediaAssignmentMode(element?.mediaAssignmentMode) === 'category';
}

/** How many files to draw from each tagged category folder (question setting). */
export function getMediaPerCategory(element) {
  const n = parseInt(element?.mediaPerCategory, 10);
  if (Number.isFinite(n) && n > 0) return Math.min(50, n);
  return 1;
}

/**
 * Expected total media count for category mode = categories × per-category.
 * Returns null if not in category mode or no categories.
 */
export function expectedCategoryImageCount(pool, element, folderTags = {}) {
  if (!usesCategoryMediaAssignment(element)) return null;
  const labels = getFolderCategories(pool, folderTags, {
    scopeFolders: element?.mediaFolders,
  });
  if (!labels.length) return null;
  return labels.length * getMediaPerCategory(element);
}

function pickOnePerCategory(pool, element, globallyUsedImageKeys, folderTags = {}) {
  const byCategory = buildMediaByFolderCategory(pool, folderTags, {
    scopeFolders: element?.mediaFolders,
  });
  const categories = [...byCategory.keys()].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }),
  );
  const perCategory = getMediaPerCategory(element);
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
    const take = shuffled.slice(0, Math.min(perCategory, shuffled.length));
    if (!take.length) continue;
    images.push(...take);
    assignedCategories.push(cat);
  }

  return {
    images,
    setKey: null,
    setId: null,
    groupKey: null,
    groupId: null,
    categories: assignedCategories,
    mediaPerCategory: perCategory,
  };
}

export function getImageKey(image) {
  return image?.media_id || image?.key || image?.name || image?.url;
}

export function getGroupTrackingKey(group) {
  return group?.setKey || group?.groupKey || group?.setId || group?.groupId || null;
}

const DEFAULT_TS_MU = 25;

/** Normalize legacy / invalid pairingMode values. */
export function normalizePairingMode(mode) {
  // Legacy "uncertain" (high-σ) ≈ exposure balancing with current stats
  if (mode === 'uncertain' || mode === 'high_sigma') return 'balanced';
  if (mode === 'balanced' || mode === 'adaptive' || mode === 'random') return mode;
  return 'random';
}

function pickLeastExposed(candidates, imageCount, pairStats) {
  if (!candidates?.length) return [];
  const exposure = (img) => {
    const key = getImageKey(img);
    return pairStats?.[key]?.exposures ?? 0;
  };
  const sorted = [...candidates].sort((a, b) => exposure(a) - exposure(b) || Math.random() - 0.5);
  // Prefer the least-exposed band, then shuffle within it for variety
  if (sorted.length <= imageCount) return sorted;
  const bandSize = Math.min(sorted.length, Math.max(imageCount * 2, Math.ceil(sorted.length / 2)));
  const band = sorted.slice(0, bandSize);
  return [...band].sort(() => 0.5 - Math.random()).slice(0, imageCount);
}

/**
 * Adaptive sampling (best-effort for multi-image TrueSkill learning):
 *
 * A) Rated images (have μ): sort by μ → equal-count quantile buckets (2–6) →
 *    pick a bucket uniformly → random draw. Equal chance for low/mid/high bands.
 *
 * B) New images (no μ / never shown): never “1 bucket among N” (that starves them).
 *    Instead each trial chooses one of:
 *      1. all-new set — when many are new (new-vs-new cold start)
 *      2. 1 new + (k−1) from one μ bucket — places a new image inside a coherent band
 *      3. pure μ-bucket set — band learning without new images
 *    Probabilities scale with unseen share, with a floor so a few new images still appear.
 */
function pickSimilarMuSet(candidates, imageCount, pairStats) {
  if (!candidates?.length) return [];
  if (candidates.length <= imageCount) {
    return [...candidates].sort(() => 0.5 - Math.random());
  }

  const shuffleTake = (list, n) => [...list].sort(() => 0.5 - Math.random()).slice(0, n);

  const unseen = [];
  const rated = [];
  candidates.forEach((img) => {
    const key = getImageKey(img);
    const row = key ? pairStats?.[key] : null;
    const hasMu = row?.mu != null && Number.isFinite(Number(row.mu));
    const exposed = (row?.exposures ?? 0) > 0;
    if (!row || (!hasMu && !exposed)) {
      unseen.push(img);
    } else {
      rated.push({
        img,
        mu: hasMu ? Number(row.mu) : DEFAULT_TS_MU,
      });
    }
  });

  const buildMuBuckets = (ratedList) => {
    if (ratedList.length < imageCount) return [];
    const sorted = [...ratedList].sort((a, b) => a.mu - b.mu || Math.random() - 0.5);
    const numBuckets = Math.min(6, Math.max(2, Math.floor(sorted.length / imageCount)));
    const bucketSize = Math.ceil(sorted.length / numBuckets);
    const buckets = [];
    for (let b = 0; b < numBuckets; b += 1) {
      const start = b * bucketSize;
      const slice = sorted.slice(start, Math.min(sorted.length, start + bucketSize));
      if (slice.length >= imageCount) {
        buckets.push(slice.map((r) => r.img));
      } else if (slice.length && buckets.length) {
        // merge undersized final slice into previous bucket
        buckets[buckets.length - 1] = [...buckets[buckets.length - 1], ...slice.map((r) => r.img)];
      }
    }
    return buckets;
  };

  const pickFromMuBucket = () => {
    const buckets = buildMuBuckets(rated);
    if (!buckets.length) {
      return shuffleTake(rated.map((r) => r.img), imageCount);
    }
    const bucket = buckets[Math.floor(Math.random() * buckets.length)];
    return shuffleTake(bucket, imageCount);
  };

  // --- mostly / entirely new pool ---
  if (rated.length < imageCount) {
    return shuffleTake(unseen.length ? unseen : candidates, imageCount);
  }

  const share = unseen.length / candidates.length; // 0..1
  const roll = Math.random();

  if (unseen.length > 0) {
    // (1) All-new trial: likely when new images are a large fraction of the pool
    const pAllNew = Math.min(0.45, share);
    if (unseen.length >= imageCount && roll < pAllNew) {
      return shuffleTake(unseen, imageCount);
    }

    // (2) Inject one new into a μ-band trial — floor so small unseen sets are not starved
    //     e.g. 5% new → ~25% mixed trials; 20% new → ~40%; capped at 50%
    const pMixed = Math.min(0.5, Math.max(0.25, share * 2));
    if (roll < pAllNew + pMixed) {
      const newbie = shuffleTake(unseen, 1)[0];
      const band = pickFromMuBucket().filter((img) => getImageKey(img) !== getImageKey(newbie));
      const rest = shuffleTake(band, imageCount - 1);
      // if band somehow collided, fill from rated
      while (rest.length < imageCount - 1) {
        const fill = rated.map((r) => r.img).find((img) => (
          getImageKey(img) !== getImageKey(newbie)
          && !rest.some((x) => getImageKey(x) === getImageKey(img))
        ));
        if (!fill) break;
        rest.push(fill);
      }
      return shuffleTake([newbie, ...rest], imageCount);
    }
  }

  // (3) Pure μ-band trial
  return pickFromMuBucket();
}

/**
 * Pick media for a question — individual files, a tagged folder set, or one-per-category.
 * Returns { images, setKey, setId, groupKey, groupId, categories }.
 * (groupKey/groupId mirror setKey/setId for older callers.)
 *
 * folderTags: project imageDatasetConfig.mediaFolderTags
 */
export function pickRandomMediaForQuestion(
  pool,
  element,
  globallyUsedImageKeys,
  globallyUsedSetKeys,
  pairStats = null,
  folderTags = {},
) {
  const imageCount = element.imageCount || defaultMediaCount(element);
  const excludeUsed = element.excludePreviouslyUsedImages !== false;
  const pairingMode = normalizePairingMode(element.pairingMode || 'random');
  const mode = normalizeMediaAssignmentMode(element.mediaAssignmentMode);
  const scopeFolders = Array.isArray(element.mediaFolders)
    ? element.mediaFolders.map(normalizeFolderPath).filter(Boolean)
    : null;

  let workingPool = [...(pool || [])].map((e) => normalizeMediaEntry(e)).filter(Boolean);
  if (scopeFolders?.length && mode === 'individual') {
    const scoped = [];
    scopeFolders.forEach((folder) => {
      scoped.push(...getRecursiveMedia(workingPool, folder));
    });
    const seen = new Set();
    workingPool = scoped.filter((img) => {
      const k = getImageKey(img);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  if (mode === 'category') {
    return pickOnePerCategory(workingPool, element, globallyUsedImageKeys, folderTags);
  }

  if (mode === 'set') {
    let eligible = getEligibleMediaSets(workingPool, imageCount, folderTags, {
      scopeFolders,
    });
    if (excludeUsed && globallyUsedSetKeys) {
      eligible = eligible.filter((g) => {
        const key = getGroupTrackingKey(g);
        return key && !globallyUsedSetKeys.has(key);
      });
    }
    if (!eligible.length) {
      return { images: [], setKey: null, setId: null, groupKey: null, groupId: null };
    }

    let picked = null;
    if (pairingMode === 'balanced' && pairStats) {
      const exposure = (s) => pairStats?.[s.setKey]?.exposures
        ?? pairStats?.[s.setId]?.exposures
        ?? 0;
      const sorted = [...eligible].sort((a, b) => exposure(a) - exposure(b) || Math.random() - 0.5);
      picked = sorted[0];
    } else if (pairingMode === 'adaptive' && pairStats) {
      // Adaptive on sets: prefer least-exposed sets (same as balanced without per-file μ)
      const exposure = (s) => pairStats?.[s.setKey]?.exposures
        ?? pairStats?.[s.setId]?.exposures
        ?? 0;
      const sorted = [...eligible].sort((a, b) => exposure(a) - exposure(b) || Math.random() - 0.5);
      picked = sorted[0];
    } else {
      const shuffled = [...eligible].sort(() => 0.5 - Math.random());
      picked = shuffled[0];
    }

    return {
      images: picked.members,
      setKey: picked.setKey,
      setId: picked.setId,
      groupKey: picked.setKey,
      groupId: picked.setId,
    };
  }

  let candidates = [...workingPool];
  if (excludeUsed && globallyUsedImageKeys) {
    const filtered = candidates.filter((img) => {
      const key = getImageKey(img);
      return key && !globallyUsedImageKeys.has(key);
    });
    if (filtered.length >= imageCount) candidates = filtered;
  }

  if (pairingMode === 'balanced' && candidates.length >= imageCount) {
    return {
      images: pickLeastExposed(candidates, imageCount, pairStats),
      setKey: null,
      setId: null,
      groupKey: null,
      groupId: null,
    };
  }

  if (pairingMode === 'adaptive' && candidates.length >= imageCount) {
    return {
      images: pickSimilarMuSet(candidates, imageCount, pairStats),
      setKey: null,
      setId: null,
      groupKey: null,
      groupId: null,
    };
  }

  const shuffled = [...candidates].sort(() => 0.5 - Math.random());
  return {
    images: shuffled.slice(0, imageCount),
    setKey: null,
    setId: null,
    groupKey: null,
    groupId: null,
  };
}

export function trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedSetKeys) {
  if (element.excludePreviouslyUsedImages === false) return;
  const setKey = assignment?.setKey || assignment?.groupKey;
  if (setKey && globallyUsedSetKeys) globallyUsedSetKeys.add(setKey);
  if (!globallyUsedImageKeys) return;
  (assignment?.images || []).forEach((img) => {
    const key = getImageKey(img);
    if (key) globallyUsedImageKeys.add(key);
  });
}

/**
 * Pre-sample N media assignments for multi-trial questions.
 * Uses pickMediaForQuestion (slots + legacy). Tracks used keys per trial.
 */
export function pickTrialMediaSetsForQuestion(
  pool,
  element,
  trialCount,
  globallyUsedImageKeys,
  globallyUsedSetKeys,
  pairStats = null,
  folderTags = {},
) {
  const n = Math.max(1, parseInt(trialCount, 10) || 1);
  const trialMediaSets = [];
  const trialAssignments = [];
  for (let i = 0; i < n; i += 1) {
    const assignment = pickMediaForQuestion(
      pool,
      element,
      globallyUsedImageKeys,
      globallyUsedSetKeys,
      pairStats,
      folderTags,
    );
    const images = assignment?.flatMedia || assignment?.images || [];
    trialMediaSets.push(images);
    trialAssignments.push(assignment);
    if (!hasMediaSlots(element)) {
      trackMediaAssignment(assignment, element, globallyUsedImageKeys, globallyUsedSetKeys);
    }
  }
  return { trialMediaSets, trialAssignments };
}

/** Build a log entry describing what media was injected into a question. */
export function buildMediaAssignmentLogEntry(element, selectedImages, setId = null, categories = null) {
  return {
    questionName: element.name,
    questionTitle: element.title || element.name,
    mode: normalizeMediaAssignmentMode(element.mediaAssignmentMode),
    setId: setId || element.assignedMediaSetId || element.assignedMediaGroupId || null,
    groupId: setId || element.assignedMediaSetId || element.assignedMediaGroupId || null,
    categories: categories || element.assignedMediaCategories || null,
    fileNames: (selectedImages || []).map((img) => img.name).filter(Boolean),
    files: (selectedImages || []).map((img) => ({
      name: img.name,
      type: img.type || inferMediaType(img.name || img.url),
      url: img.url,
      folder: img.folder || '',
      category: null,
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

  if ([
    'mediadisplay', 'mediarating', 'mediaboolean',
    'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  ].includes(element.type)) {
    setMediaItems(element, selectedImages);
    element.mediaUrl = first.url;
    element.mediaName = first.name;
    // Mirror image* fields so stimulus survives SurveyJS Model() like imagematrix
    element.imageLinks = selectedImages.map((img) => img.url);
    element.imageNames = selectedImages.map((img) => img.name);
    element.imageUrls = selectedImages.map((img) => img.url);
    // Prefer image gallery HTML for image files (imagematrix-compatible display path)
    const imageEntries = selectedImages.filter((img) => !img.type || img.type === 'image');
    if (imageEntries.length) {
      element.imageHtml = buildImageGalleryHtml(imageEntries);
    } else if (selectedImages.length) {
      // video/audio: still expose a single-file html placeholder is unused; MediaSlotLayout handles
      element.imageHtml = '';
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
    element.imageUrls = selectedImages.map((img) => img.url);
    // imagerating / imageboolean / imagematrix widgets read stimulus from choices[].imageLink.
    // imageslidergroup / imagepointallocation use imageLinks for stimulus; their choices are
    // response options (dimensions are separate) — never overwrite allocation choices with images.
    if (['imageboolean', 'imagerating', 'imagematrix'].includes(element.type)) {
      element.choices = selectedImages.map((image, index) => ({
        value: `image_${index}`,
        imageLink: image.url,
        imageName: image.name,
      }));
    }
    return;
  }

  // Only image/media choice types use choices-as-images. Never overwrite
  // text radiogroup / checkbox / dropdown / ranking choices.
  if (!['imagepicker', 'imageranking', 'mediaranking', 'mediapicker'].includes(element.type)) {
    return;
  }

  // mediapicker uses media_N; mediaranking keeps image_N for legacy response mappers
  const choicePrefix = element.type === 'mediapicker' ? 'media_' : 'image_';
  element.choices = selectedImages.map((image, index) => ({
    value: `${choicePrefix}${index}`,
    imageLink: image.url,
    imageName: image.name,
  }));
  element.imageUrls = selectedImages.map((img) => img.url);
  element.imageNames = selectedImages.map((img) => img.name);
  setMediaItems(element, selectedImages);
  if (!element.imageFit) element.imageFit = 'contain';
}

/** Apply assignment (with optional slots) to element + return urls for trackers. */
export function applyMediaAssignmentToElement(element, assignment) {
  const images = assignment?.flatMedia || assignment?.images || [];
  const slots = assignment?.slots || [];
  if (slots.length) applyResolvedSlotsToElement(element, slots);
  applyMediaToElement(element, images);
  if (assignment?.setId || assignment?.groupId) {
    element.assignedMediaSetId = assignment.setId || assignment.groupId;
    element.assignedMediaGroupId = assignment.setId || assignment.groupId;
  }
  if (assignment?.categories) {
    element.assignedMediaCategories = assignment.categories;
  }
  if (element?.name) {
    rememberInjectedMedia(element.name, {
      items: images,
      trialMediaSets: element.trialMediaSets || null,
    });
  }
  return images.map((img) => img.url).filter(Boolean);
}

const INJECTED_MEDIA_SYNC_KEYS = [
  'mediaItems', 'mediaUrls', 'mediaNames', 'mediaTypes', 'mediaUrl', 'mediaName',
  'mediaSlots', 'mediaSlotsResolved', 'slotIds', 'slotUrls', 'slotTypes', 'slotRoles', 'slotNames',
  'imageLinks', 'imageNames', 'imageHtml', 'imageUrls', 'imageLink', 'imageName',
  'annotationImageUrl', 'trialMediaSets', 'skillImages',
  'assignedMediaSetId', 'assignedMediaGroupId', 'assignedMediaCategories',
];

/**
 * SurveyJS often drops object-array props (mediaItems / trialMediaSets) when building
 * the Model. Re-copy injected fields from the pre-processed JSON onto live questions.
 */
export function syncInjectedMediaOntoSurveyModel(surveyModel, surveyJson) {
  if (!surveyModel || !surveyJson?.pages) return;
  const byName = new Map();
  surveyJson.pages.forEach((page) => {
    (page.elements || []).forEach((el) => {
      if (el?.name) byName.set(el.name, el);
    });
  });
  const questions = typeof surveyModel.getAllQuestions === 'function'
    ? surveyModel.getAllQuestions()
    : [];
  questions.forEach((q) => {
    const src = byName.get(q.name);
    if (!src) return;
    INJECTED_MEDIA_SYNC_KEYS.forEach((key) => {
      const val = src[key];
      if (val === undefined || val === null) return;
      if (Array.isArray(val) && val.length === 0) return;
      try {
        if (typeof q.setPropertyValue === 'function') {
          q.setPropertyValue(key, val);
        } else {
          q[key] = val;
        }
      } catch { /* ignore */ }
    });
  });
}

/**
 * Ensure skillConfig carries skillId. Media comes from project injection or
 * the admin skill-preview library in builder previews — no SVG demos.
 */
export function ensureSkillDemoMedia(element) {
  if (element.type !== 'skillquestion') return;
  const cfg = { ...(element.skillConfig || {}) };
  if (element.skillId) cfg.skillId = element.skillId;
  // Drop legacy embedded SVG demoImages if present
  if (cfg.demoImages) {
    delete cfg.demoImages;
  }
  element.skillConfig = cfg;
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
        delete merged.demoImages;
        const skillKey = String(el.skillId || '').replace(/^preset_/, '');
        el.skillConfig = skillKey === 'emotion_color_picker'
          ? enrichEmotionColorConfig(merged)
          : merged;
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
