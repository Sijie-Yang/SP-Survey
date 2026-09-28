/**
 * Deterministic media assignment for silicon runs (seeded, no Math.random).
 * Follows the participant folder / fixed-selection rules instead of shuffling the whole pool.
 */

function hash32(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle(items, seed) {
  const arr = [...(items || [])];
  let s = hash32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function imageUrl(img) {
  return img?.url || img?.path || (typeof img === 'string' ? img : '');
}

function imageFolder(img) {
  return normalizeFolder(img?.folder || img?.folderPath || img?.mediaFolder || img?.logicalFolder || '');
}

function normalizeFolder(path = '') {
  return String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function folderInScope(imgFolder, scopeFolder) {
  const folder = normalizeFolder(imgFolder);
  const scope = normalizeFolder(scopeFolder);
  if (!scope) return true;
  return folder === scope || folder.startsWith(`${scope}/`);
}

function mediaTypeOf(img) {
  const raw = String(img?.mediaType || img?.type || '').toLowerCase();
  if (raw.includes('video')) return 'video';
  if (raw.includes('audio')) return 'audio';
  if (raw.includes('image') || raw.includes('photo')) return 'image';
  const url = imageUrl(img).toLowerCase();
  if (/\.(mp4|webm|mov)(\?|$)/.test(url)) return 'video';
  if (/\.(mp3|wav|ogg|m4a)(\?|$)/.test(url)) return 'audio';
  return 'image';
}

function selectedUrlsOf(question = {}) {
  const selected = question.selectedImageUrls || question.imageLinks || question.mediaUrls;
  return Array.isArray(selected) ? selected.map(String).filter(Boolean) : [];
}

function scopedFoldersOf(question = {}) {
  const raw = Array.isArray(question.mediaFolders)
    ? question.mediaFolders
    : (question.mediaFolder || question.allowedFolder || question.folder
      ? [question.mediaFolder || question.allowedFolder || question.folder]
      : []);
  return raw.map(normalizeFolder).filter(Boolean);
}

function filterPoolForQuestion(pool = [], question = {}, dataset = {}) {
  const items = Array.isArray(pool) ? pool : [];
  const selected = selectedUrlsOf(question);
  if (question.imageSelectionMode === 'huggingface_manual' || selected.length) {
    const byUrl = new Map(items.map((img) => [imageUrl(img), img]));
    return selected.map((url) => {
      const found = byUrl.get(url);
      if (found) return found;
      const name = String(url).split('?')[0].split('/').pop() || url;
      return { url, name };
    }).filter((img) => imageUrl(img));
  }
  const wantedType = String(question.mediaType || question.media_type || 'image').toLowerCase();
  const typed = wantedType && wantedType !== 'any'
    ? items.filter((img) => mediaTypeOf(img) === wantedType)
    : items;
  const scopes = scopedFoldersOf(question);
  if (scopes.length) {
    return typed.filter((img) => scopes.some((scope) => folderInScope(imageFolder(img), scope)));
  }
  const tags = dataset.mediaFolderTags || dataset.folderTags || {};
  const category = question.mediaCategory || question.category;
  if (category) {
    return typed.filter((img) => {
      const tag = tags[imageFolder(img)];
      const value = tag && typeof tag === 'object' ? tag.category || tag.set : tag;
      return value === category;
    });
  }
  return typed;
}

function questionNeedsShownMedia(question = {}) {
  return /image|media/.test(question.type || '')
    || Number(question.imageCount || question.mediaCount || 0) > 0;
}

function diagnoseMissingMedia(question = {}, pool = []) {
  if (selectedUrlsOf(question).length) {
    return { code: 'image_unreadable', error: 'Image URL could not be resolved' };
  }
  const items = Array.isArray(pool) ? pool : [];
  if (!items.length) {
    return { code: 'no_media_source', error: 'No usable media source' };
  }
  if (scopedFoldersOf(question).length) {
    return { code: 'folder_empty', error: 'No matching images in the selected folders' };
  }
  return { code: 'no_media_source', error: 'No usable media source' };
}

function pickMediaForSilicon({
  pool = [],
  question,
  seed,
  count,
  dataset = {},
  excludeUrls = null,
}) {
  const n = Math.max(1, Number(count || question?.imageCount || question?.mediaCount || 4));
  const filtered = filterPoolForQuestion(pool, question, dataset);
  const blocked = excludeUrls instanceof Set ? excludeUrls : new Set(excludeUrls || []);
  let urls = filtered.map(imageUrl).filter(Boolean);
  if (blocked.size) {
    const unused = urls.filter((url) => !blocked.has(url));
    if (unused.length) urls = unused;
  }
  if (!urls.length) return [];
  if (question?.mediaAssignmentMode === 'set') {
    const groups = setGroups(filtered, dataset);
    const keys = seededShuffle([...groups.keys()], `${seed}:${question?.name || 'q'}:set`);
    const picked = keys.map((key) => groups.get(key)).find((group) => group?.length) || [];
    return picked.slice(0, Math.min(n, picked.length));
  }
  if (question?.imageSelectionMode === 'huggingface_manual' || question?.selectedImageUrls?.length) {
    return urls.slice(0, Math.min(n, urls.length));
  }
  return seededShuffle(urls, `${seed}:${question?.name || 'q'}`).slice(0, Math.min(n, urls.length));
}

function setGroups(pool = [], dataset = {}) {
  const tags = dataset.mediaFolderTags || dataset.folderTags || {};
  const groups = new Map();
  for (const img of pool) {
    const folder = imageFolder(img);
    const tag = tags[folder];
    const setId = (tag && typeof tag === 'object' ? (tag.set || tag.category) : tag)
      || folder
      || 'default';
    if (!groups.has(setId)) groups.set(setId, []);
    const url = imageUrl(img);
    if (url) groups.get(setId).push(url);
  }
  return groups;
}

function pickTrialMediaForSilicon({
  pool = [],
  question,
  seed,
  dataset = {},
}) {
  const trialCount = Math.max(1, Number(question?.trialCount || 1));
  const used = new Set();
  const reuse = question?.excludePreviouslyUsedImages === false;
  const trials = [];
  for (let index = 0; index < trialCount; index += 1) {
    const urls = pickMediaForSilicon({
      pool,
      question,
      seed: `${seed}:t${index}`,
      dataset,
      excludeUrls: reuse ? null : used,
    });
    urls.forEach((url) => used.add(url));
    trials.push(urls);
  }
  return trials;
}

function preflightMediaForQuestions({
  surveyConfig,
  questionNames,
  pool,
  dataset,
} = {}) {
  const wanted = Array.isArray(questionNames) && questionNames.length ? new Set(questionNames) : null;
  const errors = [];
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (wanted && !wanted.has(el.name)) continue;
      if (!questionNeedsShownMedia(el)) continue;
      const assigned = pickTrialMediaForSilicon({ pool, question: el, seed: 'preflight', dataset });
      if (assigned.some((trial) => Array.isArray(trial) && trial.length)) continue;
      errors.push({ question: el.name, ...diagnoseMissingMedia(el, pool) });
    }
  }
  return { ok: errors.length === 0, errors };
}

function shownMediaChoices(images = []) {
  return (images || []).map((url, index) => ({
    value: `image_${index + 1}`,
    text: `image_${index + 1}`,
    imageLink: url,
    url,
  }));
}

function questionWithShownMedia(question = {}, images = []) {
  if (!['imagepicker', 'imageranking', 'mediapicker', 'mediaranking'].includes(question.type)) {
    return question;
  }
  return { ...question, choices: shownMediaChoices(images) };
}

function assignMediaForSurvey({ surveyConfig, pool, seed, questionNames, dataset }) {
  const displayed = {};
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (questionNames && !questionNames.includes(el.name)) continue;
      const needs = /image|media|skillquestion/.test(el.type || '')
        || Number(el.imageCount || el.mediaCount || 0) > 0;
      if (!needs) continue;
      const trials = pickTrialMediaForSilicon({ pool, question: el, seed, dataset });
      displayed[el.name] = Number(el.trialCount || 1) > 1 ? trials : (trials[0] || []);
    }
  }
  return displayed;
}

module.exports = {
  seededShuffle,
  filterPoolForQuestion,
  questionNeedsShownMedia,
  diagnoseMissingMedia,
  preflightMediaForQuestions,
  pickMediaForSilicon,
  pickTrialMediaForSilicon,
  shownMediaChoices,
  questionWithShownMedia,
  assignMediaForSurvey,
};
