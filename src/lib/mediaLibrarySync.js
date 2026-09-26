import { normalizeMediaEntry, sortMediaByName } from './mediaUtils';

/** R2 owns file presence and URLs; the saved library owns organization and metadata. */
export function mergeMediaLibraryListing(listed = [], saved = [], prefix = '') {
  const byKey = new Map();
  const byUrl = new Map();
  const byId = new Map();
  (saved || []).forEach((entry) => {
    if (entry?.key) byKey.set(entry.key, entry);
    if (entry?.url) byUrl.set(entry.url, entry);
    if (entry?.media_id) byId.set(entry.media_id, entry);
  });
  return sortMediaByName(listed.map((file) => {
    // Never match by filename: different folders can contain the same basename.
    const previous = byKey.get(file.key) || byUrl.get(file.url)
      || byId.get(file.media_id || file.key);
    const merged = {
      ...file,
      ...previous,
      key: file.key || previous?.key,
      url: file.url || previous?.url,
      media_id: previous?.media_id || file.media_id || file.key,
    };
    return { ...merged, ...normalizeMediaEntry(merged, prefix) };
  }));
}

/** Keep logicalFolder (including explicit root) and research metadata on every save. */
export function serializeMediaLibraryEntry(raw, prefix = '') {
  return { ...(raw && typeof raw === 'object' ? raw : {}), ...normalizeMediaEntry(raw, prefix) };
}
