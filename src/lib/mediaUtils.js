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

/**
 * Natural filename compare so "2_1.jpg" comes before "10_1.jpg"
 * (plain localeCompare would put 10 before 2).
 */
export function compareMediaNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/** Sort media entries (or bare name strings) with natural numeric order. */
export function sortMediaByName(items, nameKey = 'name') {
  return [...(items || [])].sort((a, b) => {
    const na = typeof a === 'string' ? a : a?.[nameKey];
    const nb = typeof b === 'string' ? b : b?.[nameKey];
    return compareMediaNames(na, nb);
  });
}

/** Normalize a preloaded media entry (legacy entries without type → image). */
export function normalizeMediaEntry(entry, projectPrefix = null) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const name = entry.split('/').pop();
    return {
      name,
      url: entry,
      type: inferMediaType(entry),
      media_id: name || entry,
      folder: '',
    };
  }
  const name = entry.name || entry.url?.split('?')[0].split('/').pop() || '';
  const mediaId = entry.media_id || entry.key || name || entry.url || '';
  const folder = entry.folder != null
    ? normalizeFolderPath(entry.folder)
    : folderFromR2Key(entry.key, projectPrefix);
  return {
    name,
    url: entry.url,
    key: entry.key,
    type: entry.type || inferMediaType(name || entry.url),
    media_id: mediaId,
    folder,
  };
}

/** Stable media id for features / response join (prefer R2 key). */
export function getMediaId(entry) {
  const n = normalizeMediaEntry(entry);
  return n?.media_id || n?.key || n?.name || n?.url || '';
}

/** Filter media pool by requested type(s). */
export function filterMediaByType(pool, mediaType) {
  const normalized = (pool || []).map((e) => normalizeMediaEntry(e)).filter(Boolean);
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
  'mediadisplay', 'mediarating', 'mediaboolean', 'mediaranking', 'mediapicker',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  'imageannotation',
  'imageslidergroup', 'imagepointallocation',
]);

export const IMAGE_QUESTION_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'image', 'imagematrix', 'imageannotation',
  'imageslidergroup', 'imagepointallocation',
]);

export const VIDEO_AUDIO_QUESTION_TYPES = new Set([
  'mediadisplay', 'mediarating', 'mediaboolean', 'mediaranking', 'mediapicker',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
]);

// ─── Folder paths & tags (set / category) ─────────────────────────────────────

export const MEDIA_FOLDER_TAG_SET = 'set';
export const MEDIA_FOLDER_TAG_CATEGORY = 'category';

/** Normalize folder path: no leading/trailing slashes; empty string = project root. */
export function normalizeFolderPath(path = '') {
  return String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');
}

/** Join folder segments safely. */
export function joinFolderPath(...parts) {
  return normalizeFolderPath(parts.filter((p) => p != null && p !== '').join('/'));
}

/**
 * Relative folder of an R2 object key under a project prefix.
 * e.g. key=user/proj/a/b/x.jpg, prefix=user/proj/ → folder "a/b"
 * Also understands template library keys:
 *   templates/{id}/study2/x.jpg → study2
 *   builtin/{id}/study2/x.jpg → study2
 */
export function folderFromR2Key(key, projectPrefix) {
  if (!key) return '';
  let rel = String(key).replace(/^\/+/, '');
  const prefix = projectPrefix ? String(projectPrefix).replace(/^\/+/, '').replace(/\/?$/, '/') : '';
  if (prefix && rel.startsWith(prefix)) {
    rel = rel.slice(prefix.length);
  } else if (/^(templates|builtin)\//.test(rel)) {
    // templates/{id}/... or builtin/{id}/... → strip owner + id
    const segs = rel.split('/');
    if (segs.length >= 3) rel = segs.slice(2).join('/');
  } else if (prefix) {
    // Not under this prefix — try stripping first two segments (userId/projectId/)
    const segs = rel.split('/');
    if (segs.length >= 3) rel = segs.slice(2).join('/');
  }
  const parts = rel.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

/** Basename of a path or filename. */
export function mediaBasename(nameOrPath = '') {
  return String(nameOrPath).split('?')[0].split('/').pop() || '';
}

/** Build R2 object key for a file in a folder under the project prefix. */
export function buildProjectMediaKey(projectPrefix, folder, filename) {
  const prefix = String(projectPrefix || '').replace(/\/?$/, '/');
  const folderPart = normalizeFolderPath(folder);
  const safe = mediaBasename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return folderPart ? `${prefix}${folderPart}/${safe}` : `${prefix}${safe}`;
}

/** Relative path under an R2 prefix: `folder/name` or `name`. */
export function mediaRelativePath(folder, filename) {
  const name = mediaBasename(filename);
  const folderPart = normalizeFolderPath(folder);
  return folderPart ? `${folderPart}/${name}` : name;
}

/**
 * Relative path of a listed R2 object under `prefix`.
 * Prefers key stripping; falls back to folder + name.
 */
export function mediaRelativePathFromListing(img, prefix = '') {
  if (!img) return '';
  const key = String(img.key || '').replace(/^\/+/, '');
  const p = prefix ? String(prefix).replace(/^\/+/, '').replace(/\/?$/, '/') : '';
  if (p && key.startsWith(p)) return key.slice(p.length);
  const folder = img.folder != null
    ? normalizeFolderPath(img.folder)
    : folderFromR2Key(img.key, prefix);
  return mediaRelativePath(folder, img.name);
}

/**
 * Safe subset of imageDatasetConfig for templates (folders + set/category tags only).
 * Strips tokens, HF settings, spatial keys, import history, etc.
 */
export function sanitizeMediaFolderConfig(cfg = {}) {
  const mediaFolderTags = normalizeMediaFolderTags(cfg?.mediaFolderTags);
  const mediaFolders = [...new Set(
    (Array.isArray(cfg?.mediaFolders) ? cfg.mediaFolders : [])
      .map(normalizeFolderPath)
      .filter(Boolean),
  )].sort(compareMediaNames);
  return { mediaFolderTags, mediaFolders };
}

/** Merge folder tags/lists (incoming wins on same tag path; union folders). */
export function mergeMediaFolderConfigs(base = {}, incoming = {}) {
  const a = sanitizeMediaFolderConfig(base);
  const b = sanitizeMediaFolderConfig(incoming);
  return {
    mediaFolderTags: { ...a.mediaFolderTags, ...b.mediaFolderTags },
    mediaFolders: [...new Set([...a.mediaFolders, ...b.mediaFolders])].sort(compareMediaNames),
  };
}

/** Normalize mediaFolderTags map from project config. */
export function normalizeMediaFolderTags(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([path, tag]) => {
    const folder = normalizeFolderPath(path);
    if (!folder) return; // root cannot be tagged as set/category
    if (tag === MEDIA_FOLDER_TAG_SET || tag === MEDIA_FOLDER_TAG_CATEGORY) {
      out[folder] = tag;
    }
  });
  return out;
}

export function getFolderTag(folderTags, folderPath) {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return null;
  const tags = normalizeMediaFolderTags(folderTags);
  return tags[folder] || null;
}

/** Remap tags when a folder path is renamed/moved. */
export function remapMediaFolderTags(folderTags, fromPath, toPath) {
  const tags = normalizeMediaFolderTags(folderTags);
  const from = normalizeFolderPath(fromPath);
  const to = normalizeFolderPath(toPath);
  if (!from) return tags;
  const next = {};
  Object.entries(tags).forEach(([path, tag]) => {
    if (path === from) {
      if (to) next[to] = tag;
      return;
    }
    if (path.startsWith(`${from}/`)) {
      const rest = path.slice(from.length + 1);
      const newPath = to ? joinFolderPath(to, rest) : rest;
      if (newPath) next[newPath] = tag;
      return;
    }
    next[path] = tag;
  });
  return next;
}

/** Remap mediaFolders list paths when a folder is renamed/moved. */
export function remapMediaFolderList(mediaFolders, fromPath, toPath) {
  const from = normalizeFolderPath(fromPath);
  const to = normalizeFolderPath(toPath);
  if (!from) return [...new Set((mediaFolders || []).map(normalizeFolderPath).filter(Boolean))].sort(compareMediaNames);
  const next = new Set();
  (mediaFolders || []).forEach((path) => {
    const p = normalizeFolderPath(path);
    if (!p) return;
    if (p === from) {
      if (to) next.add(to);
      return;
    }
    if (p.startsWith(`${from}/`)) {
      const rest = p.slice(from.length + 1);
      const newPath = to ? joinFolderPath(to, rest) : rest;
      if (newPath) next.add(newPath);
      return;
    }
    next.add(p);
  });
  return [...next].sort(compareMediaNames);
}

/** True if `path` is `folder` or a descendant of `folder`. */
export function isFolderOrDescendant(path, folder) {
  const p = normalizeFolderPath(path);
  const f = normalizeFolderPath(folder);
  if (!f) return false;
  return p === f || p.startsWith(`${f}/`);
}

/**
 * Drop folder paths (and descendants) from tags + mediaFolders lists.
 * Returns { mediaFolderTags, mediaFolders }.
 */
export function removeMediaFolders(folderTags, mediaFolders, foldersToRemove) {
  const remove = [...new Set((foldersToRemove || []).map(normalizeFolderPath).filter(Boolean))];
  const tags = normalizeMediaFolderTags(folderTags);
  const nextTags = {};
  Object.entries(tags).forEach(([path, tag]) => {
    if (remove.some((f) => isFolderOrDescendant(path, f))) return;
    nextTags[path] = tag;
  });
  const nextFolders = (mediaFolders || [])
    .map(normalizeFolderPath)
    .filter(Boolean)
    .filter((path) => !remove.some((f) => isFolderOrDescendant(path, f)));
  return { mediaFolderTags: nextTags, mediaFolders: [...new Set(nextFolders)].sort(compareMediaNames) };
}

export function setMediaFolderTag(folderTags, folderPath, tag) {
  const tags = normalizeMediaFolderTags(folderTags);
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return tags;
  if (tag !== MEDIA_FOLDER_TAG_SET && tag !== MEDIA_FOLDER_TAG_CATEGORY) {
    const next = { ...tags };
    delete next[folder];
    return next;
  }
  return { ...tags, [folder]: tag };
}

/** Unique folder paths present in a media pool (including ancestors of nested files). */
export function listFoldersInPool(pool, projectPrefix = null) {
  const folders = new Set();
  (pool || []).forEach((raw) => {
    const entry = normalizeMediaEntry(raw, projectPrefix);
    const folder = entry?.folder || '';
    if (!folder) return;
    const parts = folder.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      folders.add(parts.slice(0, i).join('/'));
    }
  });
  // Also include tagged empty folders
  return [...folders].sort(compareMediaNames);
}

export function listAllKnownFolders(pool, folderTags, projectPrefix = null, extraFolders = []) {
  const set = new Set(listFoldersInPool(pool, projectPrefix));
  Object.keys(normalizeMediaFolderTags(folderTags)).forEach((f) => set.add(f));
  (extraFolders || []).forEach((f) => {
    const n = normalizeFolderPath(f);
    if (n) set.add(n);
  });
  return [...set].sort(compareMediaNames);
}

/** Direct-child media files of a folder (not recursive). */
export function getDirectChildMedia(pool, folderPath, projectPrefix = null) {
  const folder = normalizeFolderPath(folderPath);
  return (pool || [])
    .map((raw) => normalizeMediaEntry(raw, projectPrefix))
    .filter((e) => e && (e.folder || '') === folder)
    .sort((a, b) => compareMediaNames(a.name, b.name));
}

/** All media under a folder recursively (includes the folder itself). */
export function getRecursiveMedia(pool, folderPath, projectPrefix = null) {
  const folder = normalizeFolderPath(folderPath);
  return (pool || [])
    .map((raw) => normalizeMediaEntry(raw, projectPrefix))
    .filter((e) => {
      if (!e) return false;
      const f = e.folder || '';
      if (!folder) return true;
      return f === folder || f.startsWith(`${folder}/`);
    })
    .sort((a, b) => compareMediaNames(a.name, b.name));
}

/**
 * Eligible sets: folders tagged `set` whose direct children count === setSize.
 * Returns { setKey, setId, folder, members, eligible }.
 */
export function getEligibleFolderSets(pool, setSize, folderTags, {
  projectPrefix = null,
  scopeFolders = null,
} = {}) {
  const size = Math.max(1, setSize || 1);
  const tags = normalizeMediaFolderTags(folderTags);
  const scope = Array.isArray(scopeFolders) && scopeFolders.length
    ? new Set(scopeFolders.map(normalizeFolderPath).filter(Boolean))
    : null;

  const results = [];
  Object.entries(tags).forEach(([folder, tag]) => {
    if (tag !== MEDIA_FOLDER_TAG_SET) return;
    if (scope && !scope.has(folder)) return;
    const members = getDirectChildMedia(pool, folder, projectPrefix);
    results.push({
      setKey: `folder:${folder}`,
      setId: folder,
      folder,
      members,
      size: members.length,
      eligible: members.length === size,
    });
  });
  results.sort((a, b) => compareMediaNames(a.folder, b.folder));
  return results;
}

export function getEligibleMediaSets(pool, setSize, folderTags, opts) {
  return getEligibleFolderSets(pool, setSize, folderTags, opts).filter((s) => s.eligible);
}

/**
 * Category folders (tagged category), with deepest-wins membership for nested tags.
 * Returns Map<categoryFolder, members[]>.
 */
export function buildMediaByFolderCategory(pool, folderTags, {
  projectPrefix = null,
  scopeFolders = null,
} = {}) {
  const tags = normalizeMediaFolderTags(folderTags);
  let catFolders = Object.entries(tags)
    .filter(([, tag]) => tag === MEDIA_FOLDER_TAG_CATEGORY)
    .map(([folder]) => folder)
    .sort(compareMediaNames);

  if (Array.isArray(scopeFolders) && scopeFolders.length) {
    const scope = new Set(scopeFolders.map(normalizeFolderPath).filter(Boolean));
    catFolders = catFolders.filter((f) => scope.has(f));
  }

  const byCategory = new Map();
  catFolders.forEach((folder) => byCategory.set(folder, []));

  if (!catFolders.length) return byCategory;

  // Deepest-wins: assign each file to the longest matching tagged category prefix
  (pool || []).forEach((raw) => {
    const entry = normalizeMediaEntry(raw, projectPrefix);
    if (!entry) return;
    const f = entry.folder || '';
    let best = null;
    let bestLen = -1;
    catFolders.forEach((cat) => {
      if (f === cat || f.startsWith(`${cat}/`)) {
        if (cat.length > bestLen) {
          best = cat;
          bestLen = cat.length;
        }
      }
    });
    if (best && byCategory.has(best)) {
      byCategory.get(best).push({ ...entry, category: best });
    }
  });

  for (const members of byCategory.values()) {
    members.sort((a, b) => compareMediaNames(a.name, b.name));
  }
  return byCategory;
}

export function getFolderCategories(pool, folderTags, opts) {
  return [...buildMediaByFolderCategory(pool, folderTags, opts).keys()].sort(compareMediaNames);
}

/** Admin summary — tagged sets. */
export function analyzeTaggedSets(pool, folderTags, setSize = null, opts = {}) {
  const all = getEligibleFolderSets(pool, setSize || 1, folderTags, opts);
  // If setSize null, still list all tagged sets with their sizes
  if (setSize == null) {
    const tags = normalizeMediaFolderTags(folderTags);
    return Object.entries(tags)
      .filter(([, tag]) => tag === MEDIA_FOLDER_TAG_SET)
      .map(([folder]) => {
        const members = getDirectChildMedia(pool, folder, opts.projectPrefix);
        return {
          setKey: `folder:${folder}`,
          setId: folder,
          folder,
          size: members.length,
          members,
          types: members.map((m) => m.type || inferMediaType(m.name)),
          eligible: true,
        };
      })
      .sort((a, b) => compareMediaNames(a.folder, b.folder));
  }
  return all.map((s) => ({
    ...s,
    types: s.members.map((m) => m.type || inferMediaType(m.name)),
  }));
}

/** Admin summary — tagged categories. */
export function analyzeTaggedCategories(pool, folderTags, opts = {}) {
  const byCategory = buildMediaByFolderCategory(pool, folderTags, opts);
  const summary = [];
  for (const [category, members] of byCategory) {
    summary.push({
      category,
      folder: category,
      count: members.length,
      types: [...new Set(members.map((m) => m.type || inferMediaType(m.name)))],
      sampleNames: members.slice(0, 5).map((m) => m.name),
      members,
    });
  }
  summary.sort((a, b) => compareMediaNames(a.category, b.category));
  return summary;
}

export function summarizeTaggedSetsBySize(pool, folderTags, opts = {}) {
  const groups = analyzeTaggedSets(pool, folderTags, null, opts);
  const bySize = {};
  groups.forEach((g) => {
    bySize[g.size] = (bySize[g.size] || 0) + 1;
  });
  return { total: groups.length, bySize, groups };
}

/** Normalize assignment mode: legacy `group` → `set`. */
export function normalizeMediaAssignmentMode(mode) {
  if (mode === 'group') return 'set';
  if (mode === 'set' || mode === 'category' || mode === 'individual') return mode;
  return 'individual';
}

// ─── Legacy stubs (removed __ / @ filename conventions) ───────────────────────
/** @deprecated Filename pairing removed — use folder tags. */
export const MEDIA_GROUP_SEPARATOR = '__';
/** @deprecated Filename categories removed — use folder tags. */
export const MEDIA_CATEGORY_SEPARATOR = '@';

export function parseMediaCategory() {
  return { category: null, basename: '', hasCategory: false };
}

export function parseMediaGroupFilename(name = '') {
  const base = mediaBasename(name);
  const dot = base.lastIndexOf('.');
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  return { groupId: stem, slot: '1', isGrouped: false };
}

/** @deprecated Use getEligibleMediaSets with folderTags. */
export function getEligibleMediaGroups(pool, groupSize) {
  return getEligibleMediaSets(pool, groupSize, {}, {}).map((s) => ({
    groupKey: s.setKey,
    groupId: s.setId,
    members: s.members,
  }));
}

/** @deprecated Use analyzeTaggedSets. */
export function analyzeMediaGroups(pool) {
  return analyzeTaggedSets(pool, {}, null).map((g) => ({
    groupKey: g.setKey,
    groupId: g.setId,
    size: g.size,
    slots: g.members.map((_, i) => String(i + 1)),
    types: g.types,
    isGrouped: false,
    members: g.members,
  }));
}

export function summarizeMediaGroupsBySize(pool) {
  return summarizeTaggedSetsBySize(pool, {});
}

/** @deprecated Use buildMediaByFolderCategory. */
export function buildMediaByCategory() {
  return new Map();
}

export function getMediaCategories() {
  return [];
}

export function analyzeMediaCategories() {
  return [];
}
