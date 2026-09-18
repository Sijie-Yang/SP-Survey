import { normalizeMediaEntry, normalizeFolderPath, inferMediaType, isFolderOrDescendant, sortMediaByName } from './mediaUtils';

/** Checked folders include descendants; without checks, use the open folder's direct files. */
export function mediaSelectionCandidates(pool, { folders = new Set(), currentFolder = '', search = '', type = 'all', prefix = '' } = {}) {
  const scope = [...folders].map(normalizeFolderPath);
  const query = search.trim().toLowerCase();
  return sortMediaByName((pool || []).filter((raw) => {
    const entry = normalizeMediaEntry(raw, prefix);
    const folder = entry.folder || '';
    if (scope.length ? !scope.some((selected) => !selected || isFolderOrDescendant(folder, selected))
      : folder !== normalizeFolderPath(currentFolder)) return false;
    if (type !== 'all' && (entry.type || inferMediaType(entry.name || entry.url)) !== type) return false;
    return !query || (entry.name || '').toLowerCase().includes(query) || folder.toLowerCase().includes(query);
  }));
}

/** Literal filename matching: commas/semicolons/newlines separate terms; spaces stay in phrases. */
export function mediaKeywordCandidates(pool, { keywords = '', match = 'any', allFolders = false, ...scope } = {}) {
  const normalize = (value) => String(value).normalize('NFKC').toLowerCase();
  const terms = [...new Set(normalize(keywords).split(/[,;，；\n]+/).map((term) => term.trim()).filter(Boolean))];
  if (!terms.length) return [];
  return mediaSelectionCandidates(pool, {
    ...scope, search: '', type: 'image', ...(allFolders ? { folders: new Set(['']) } : {}),
  }).filter((raw) => {
    const name = normalize(normalizeMediaEntry(raw, scope.prefix)?.name || '');
    return match === 'all' ? terms.every((term) => name.includes(term)) : terms.some((term) => name.includes(term));
  });
}
