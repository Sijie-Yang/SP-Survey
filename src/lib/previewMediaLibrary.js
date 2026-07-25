/**
 * Platform preview media library — shared R2 folder for admin-curated media.
 * Used whenever a project/template has no media: question editor preview,
 * survey preview, skill library demos, etc.
 *
 * R2 prefix stays `skill-preview/` for backward compatibility with existing objects.
 */
import { listImagesFromR2 } from './r2';
import { filterMediaByType, inferMediaType, normalizeMediaEntry } from './mediaUtils';

/** Canonical R2 prefix (legacy name kept so existing uploads keep working). */
export const PREVIEW_MEDIA_PREFIX = 'skill-preview/';

/** @deprecated Use PREVIEW_MEDIA_PREFIX */
export const SKILL_PREVIEW_PREFIX = PREVIEW_MEDIA_PREFIX;

/** List all media in the shared preview library. Returns [] on any failure. */
export async function listPreviewMedia() {
  const result = await listImagesFromR2(PREVIEW_MEDIA_PREFIX);
  if (!result.success) return [];
  return (result.images || [])
    .filter((img) => img && img.url)
    .map((img) => normalizeMediaEntry({
      name: img.name || img.url.split('/').pop(),
      url: img.url,
      key: img.key,
      type: img.type || inferMediaType(img.name || img.url),
      folder: img.folder,
    }, PREVIEW_MEDIA_PREFIX))
    .filter(Boolean);
}

/** @deprecated Use listPreviewMedia */
export async function listSkillPreviewMedia() {
  return listPreviewMedia();
}

/**
 * Pick `count` random entries of the requested media type from the pool.
 * Returns [] when the pool has no matching media.
 */
export function pickPreviewMedia(pool, mediaType, count) {
  const matching = filterMediaByType(pool, mediaType);
  if (!matching.length) return [];
  const shuffled = [...matching].sort(() => 0.5 - Math.random());
  const n = Math.max(0, Number(count) || 0);
  if (!n) return [];
  const picked = shuffled.slice(0, n);
  while (picked.length < n) {
    picked.push(shuffled[picked.length % shuffled.length]);
  }
  return picked;
}

/**
 * Prefer project/template media; fall back to the platform preview library.
 */
export async function resolveMediaPoolForPreview(projectImages = []) {
  if (Array.isArray(projectImages) && projectImages.length > 0) {
    return projectImages;
  }
  return listPreviewMedia();
}
