/**
 * Global "skill preview media library" — a shared R2 folder maintained by
 * admins. Preset/skill previews draw real images / video / audio from here
 * instead of the built-in inline demo SVGs.
 */
import { listImagesFromR2 } from './r2';
import { filterMediaByType, inferMediaType } from './mediaUtils';

export const SKILL_PREVIEW_PREFIX = 'skill-preview/';

/** List all media in the shared preview library. Returns [] on any failure. */
export async function listSkillPreviewMedia() {
  const result = await listImagesFromR2(SKILL_PREVIEW_PREFIX);
  if (!result.success) return [];
  return (result.images || [])
    .filter((img) => img && img.url)
    .map((img) => ({
      name: img.name || img.url.split('/').pop(),
      url: img.url,
      key: img.key,
      type: img.type || inferMediaType(img.name || img.url),
    }));
}

/**
 * Pick `count` random entries of the requested media type from the pool.
 * Returns [] when the pool has no matching media (caller should fall back
 * to the preset's built-in demo images).
 */
export function pickPreviewMedia(pool, mediaType, count) {
  const matching = filterMediaByType(pool, mediaType);
  if (!matching.length) return [];
  const shuffled = [...matching].sort(() => 0.5 - Math.random());
  const picked = shuffled.slice(0, count);
  // Reuse entries when the library is smaller than the requested count
  while (picked.length < count) {
    picked.push(shuffled[picked.length % shuffled.length]);
  }
  return picked;
}
