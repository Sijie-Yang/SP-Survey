/**
 * Shared media type helpers for images, video, and audio assets.
 * Used by MediaDataset, SurveyApp, SurveyPreview, and ResultsAnalysis.
 */

export const MEDIA_EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  video: ['mp4', 'webm', 'mov'],
  audio: ['mp3', 'wav', 'm4a', 'ogg'],
};

const ALL_EXTENSIONS = [
  ...MEDIA_EXTENSIONS.image,
  ...MEDIA_EXTENSIONS.video,
  ...MEDIA_EXTENSIONS.audio,
];

/** Regex for R2 list filtering (server + worker). */
export const MEDIA_FILE_RE = new RegExp(
  `\\.(${ALL_EXTENSIONS.join('|')})$`,
  'i'
);

/** Infer media type from filename or URL. Defaults to 'image' for backward compat. */
export function inferMediaType(nameOrUrl = '') {
  const name = String(nameOrUrl).split('?')[0].split('/').pop() || '';
  const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  if (!ext) return 'image';
  if (MEDIA_EXTENSIONS.video.includes(ext)) return 'video';
  if (MEDIA_EXTENSIONS.audio.includes(ext)) return 'audio';
  if (MEDIA_EXTENSIONS.image.includes(ext)) return 'image';
  return 'image';
}

/** Normalize a preloaded media entry (legacy entries without type → image). */
export function normalizeMediaEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { name: entry.split('/').pop(), url: entry, type: inferMediaType(entry) };
  }
  const name = entry.name || entry.url?.split('/').pop() || '';
  return {
    name,
    url: entry.url,
    key: entry.key,
    type: entry.type || inferMediaType(name || entry.url),
  };
}

/** Filter media pool by requested type(s). */
export function filterMediaByType(pool, mediaType) {
  const normalized = (pool || []).map(normalizeMediaEntry).filter(Boolean);
  if (!mediaType || mediaType === 'any') return normalized;
  return normalized.filter((m) => m.type === mediaType);
}

/** Accept attribute for file inputs. */
export const MEDIA_ACCEPT = [
  'image/*',
  'video/mp4,video/webm,video/quicktime',
  'audio/mpeg,audio/wav,audio/mp4,audio/ogg',
].join(',');

/** Trigger a browser download for a media entry (R2 URL or local blob URL). */
export async function downloadMediaFile(entry) {
  const url = entry?.url;
  const name = entry?.name || String(url || '').split('?')[0].split('/').pop() || 'download';
  if (!url) throw new Error('Missing file URL');

  const triggerDownload = (href, downloadName) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = downloadName;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (url.startsWith('blob:')) {
    triggerDownload(url, name);
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      triggerDownload(blobUrl, name);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch {
    triggerDownload(url, name);
  }
}

/** Download multiple media files sequentially (avoids browser blocking parallel downloads). */
export async function downloadMediaFiles(entries, { onProgress } = {}) {
  const list = (entries || []).filter((e) => e?.url);
  let succeeded = 0;
  const failures = [];

  for (let i = 0; i < list.length; i += 1) {
    try {
      await downloadMediaFile(list[i]);
      succeeded += 1;
    } catch (err) {
      failures.push({ name: list[i].name, error: err.message || 'Download failed' });
    }
    if (onProgress) onProgress(i + 1, list.length);
    if (i < list.length - 1) {
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    }
  }

  return { succeeded, failed: failures.length, failures };
}

/** Question types that use random media injection. */
export const MEDIA_QUESTION_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix',
  'mediadisplay', 'mediarating', 'mediaboolean', 'imageannotation',
  'imageslidergroup', 'imagepointallocation',
]);

export const IMAGE_QUESTION_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix', 'imageannotation',
  'imageslidergroup', 'imagepointallocation',
]);

export const VIDEO_AUDIO_QUESTION_TYPES = new Set([
  'mediadisplay', 'mediarating', 'mediaboolean',
]);

/**
 * Media pairing filename convention (project media dataset):
 *
 *   {groupId}__{slot}.{ext}
 *
 * - `groupId`: stable set id (may contain single underscores, not `__`)
 * - `slot`: position or role within the set (1, 2, before, after, img, sound, …)
 *
 * Examples:
 *   renewal01__before.jpg + renewal01__after.jpg  → 2-up image pair
 *   sceneA__1.png, sceneA__2.png, sceneA__3.png  → 3-up set
 *   place01__photo.jpg + place01__ambient.mp3     → mixed image+audio set
 *
 * Files without `__` are not sets — e.g. `image_1.jpg` + `image_2.jpg` → 0 sets
 * (use individual or category assignment instead).
 */
export const MEDIA_GROUP_SEPARATOR = '__';

function getFilenameStem(name = '') {
  const { basename } = parseMediaCategory(name);
  const base = basename || String(name).split('?')[0].split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(0, dot) : base;
}

/**
 * Media category prefix (before pairing):
 *
 *   {category}@{restOfFilename}
 *
 * - `category` — class label (street, park, traffic, nature, …)
 * - `@` — single at-sign; separates category from the rest of the filename
 * - `rest` — may itself use `__` for fixed-set pairing
 *
 * Examples:
 *   street@photo01.jpg, park@photo02.jpg, plaza@photo03.jpg  → 3 categories, one pick each
 *   traffic@clip1.wav, nature@clip2.wav                        → 2 audio categories
 *   street@block01__before.jpg + street@block01__after.jpg      → category + pairing
 *
 * Files without `@` have no category (excluded from category assignment mode).
 */
export const MEDIA_CATEGORY_SEPARATOR = '@';

export function parseMediaCategory(name = '') {
  const base = String(name).split('?')[0].split('/').pop() || '';
  const at = base.indexOf(MEDIA_CATEGORY_SEPARATOR);
  if (at <= 0 || at >= base.length - 1) {
    return { category: null, basename: base, hasCategory: false };
  }
  return {
    category: base.slice(0, at),
    basename: base.slice(at + 1),
    hasCategory: true,
  };
}

export function parseMediaGroupFilename(name = '') {
  const stem = getFilenameStem(name);
  const sep = stem.indexOf(MEDIA_GROUP_SEPARATOR);
  if (sep <= 0 || sep >= stem.length - MEDIA_GROUP_SEPARATOR.length) {
    return { groupId: stem, slot: '1', isGrouped: false };
  }
  return {
    groupId: stem.slice(0, sep),
    slot: stem.slice(sep + MEDIA_GROUP_SEPARATOR.length),
    isGrouped: true,
  };
}

export function compareMediaSlots(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const na = /^\d+$/.test(sa);
  const nb = /^\d+$/.test(sb);
  if (na && nb) return parseInt(sa, 10) - parseInt(sb, 10);
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  return sa.localeCompare(sb);
}

/** Build Map<groupKey, normalized member[]> from a flat media pool. */
export function buildMediaGroups(pool) {
  const groups = new Map();
  for (const raw of pool || []) {
    const entry = normalizeMediaEntry(raw);
    if (!entry?.name) continue;
    const { category } = parseMediaCategory(entry.name);
    const { groupId, slot, isGrouped } = parseMediaGroupFilename(entry.name);
    const groupKey = isGrouped ? groupId : `__singleton__:${entry.name}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({
      ...entry,
      category,
      groupId: isGrouped ? groupId : entry.name,
      slot,
    });
  }
  for (const members of groups.values()) {
    members.sort((a, b) => compareMediaSlots(a.slot, b.slot));
  }
  return groups;
}

function isExplicitMediaGroup(groupKey) {
  return groupKey && !String(groupKey).startsWith('__singleton__:');
}

/** Groups with exactly `groupSize` members — only explicit `__` filename groups count as sets. */
export function getEligibleMediaGroups(pool, groupSize) {
  const size = Math.max(1, groupSize || 1);
  const eligible = [];
  for (const [groupKey, members] of buildMediaGroups(pool)) {
    if (!isExplicitMediaGroup(groupKey)) continue;
    if (members.length !== size) continue;
    eligible.push({
      groupKey,
      groupId: members[0].groupId,
      members,
    });
  }
  return eligible;
}

/** Summary for admin UI — detected sets in a project media library. */
export function analyzeMediaGroups(pool) {
  const summary = [];
  for (const [groupKey, members] of buildMediaGroups(pool)) {
    summary.push({
      groupKey,
      groupId: members[0]?.groupId || groupKey,
      size: members.length,
      slots: members.map((m) => m.slot),
      types: members.map((m) => m.type || inferMediaType(m.name)),
      isGrouped: isExplicitMediaGroup(groupKey),
      members,
    });
  }
  summary.sort((a, b) => {
    if (a.isGrouped !== b.isGrouped) return a.isGrouped ? -1 : 1;
    return String(a.groupId).localeCompare(String(b.groupId));
  });
  return summary;
}

/** Count grouped sets by member count — for admin UI ("12 pairs of size 2"). */
export function summarizeMediaGroupsBySize(pool) {
  const grouped = analyzeMediaGroups(pool).filter((g) => g.isGrouped);
  const bySize = {};
  grouped.forEach((g) => {
    bySize[g.size] = (bySize[g.size] || 0) + 1;
  });
  return { total: grouped.length, bySize, groups: grouped };
}

/** Map category label → media entries (only files with `@` prefix). */
export function buildMediaByCategory(pool) {
  const byCategory = new Map();
  for (const raw of pool || []) {
    const entry = normalizeMediaEntry(raw);
    if (!entry?.name) continue;
    const { category, hasCategory } = parseMediaCategory(entry.name);
    if (!hasCategory || !category) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ ...entry, category });
  }
  return byCategory;
}

/** Sorted unique category labels in a pool. */
export function getMediaCategories(pool) {
  return [...buildMediaByCategory(pool).keys()].sort((a, b) => a.localeCompare(b));
}

/** Admin summary — files per category. */
export function analyzeMediaCategories(pool) {
  const byCategory = buildMediaByCategory(pool);
  const summary = [];
  for (const [category, members] of byCategory) {
    summary.push({
      category,
      count: members.length,
      types: [...new Set(members.map((m) => m.type || inferMediaType(m.name)))],
      sampleNames: members.slice(0, 5).map((m) => m.name),
      members,
    });
  }
  summary.sort((a, b) => a.category.localeCompare(b.category));
  return summary;
}
