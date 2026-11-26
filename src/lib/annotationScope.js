import {
  getMediaId,
  inferMediaType,
  isFolderOrDescendant,
  normalizeFolderPath,
  normalizeMediaEntry,
  sortMediaByName,
} from './mediaUtils';

export function annotationScopeFolder(folder = '') {
  return `folder:${normalizeFolderPath(folder)}`;
}

export function parseAnnotationScope(value) {
  const raw = String(value || 'all');
  if (raw === 'all' || raw === 'selected' || raw === 'checked') return { kind: raw, folder: '' };
  if (raw.startsWith('folder:')) {
    return { kind: 'folder', folder: normalizeFolderPath(raw.slice('folder:'.length)) };
  }
  return { kind: 'all', folder: '' };
}

function imageEntries(pool, prefix) {
  return sortMediaByName((pool || [])
    .map((raw) => normalizeMediaEntry(raw, prefix))
    .filter((entry) => entry && (entry.type || inferMediaType(entry.name || entry.url)) === 'image'));
}

/** Folders that contain at least one image, root (`''`) first. */
export function annotationFolderCounts(pool, prefix = null) {
  const counts = new Map();
  imageEntries(pool, prefix).forEach((entry) => {
    const folder = entry.folder || '';
    counts.set(folder, (counts.get(folder) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => {
      if (!a.folder) return -1;
      if (!b.folder) return 1;
      return a.folder.localeCompare(b.folder);
    });
}

/**
 * Images the annotation screen can step through.
 * `folder:` is that folder only. Checked folders include subfolders.
 */
export function listAnnotationImages(pool, scopeValue, {
  prefix = null,
  selectedIds = null,
  checkedFolders = null,
} = {}) {
  const images = imageEntries(pool, prefix);
  const scope = parseAnnotationScope(scopeValue);
  if (scope.kind === 'selected') {
    const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    return images.filter((entry) => ids.has(getMediaId(entry)));
  }
  if (scope.kind === 'checked') {
    const folders = [...(checkedFolders instanceof Set ? checkedFolders : (checkedFolders || []))]
      .map((folder) => normalizeFolderPath(folder))
      .filter(Boolean);
    if (!folders.length) return [];
    return images.filter((entry) => folders.some((folder) => isFolderOrDescendant(entry.folder || '', folder)));
  }
  if (scope.kind === 'folder') {
    return images.filter((entry) => (entry.folder || '') === scope.folder);
  }
  return images;
}
