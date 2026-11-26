/** Re-export Supabase-backed media storage with R2-compatible names. */
import { isTemplateR2Key } from './mediaStorage';
import { API_BASE_URL } from './apiConfig';

export {
  isR2Configured,
  isMediaStorageConfigured,
  uploadImageToR2,
  deleteImagesFromR2,
  listImagesFromR2,
  copyImagesInR2,
  moveImagesInR2,
  projectR2Prefix,
  checkR2Status,
  uploadBase64ToStorage,
  getMediaStoragePublicUrl,
  downloadStorageText,
  isTemplateR2Key,
  filterDeletableR2Keys,
} from './mediaStorage';

/**
 * Self-host: media is read straight from the public Supabase URLs; the local
 * server (npm run dev) only helps with a CORS fallback (/api/r2/image-proxy)
 * and street-level short links (/api/street-level/expand).
 */
export function getR2ServerUrl() {
  return API_BASE_URL;
}

export function isR2ProxyUnreachable() {
  return false;
}

export function resetR2ProxyUnreachable() {}

export function noteR2ProxyFailure() {
  return false;
}

export function getR2PublicBase() {
  return '';
}

export function r2KeyFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    const marker = '/storage/v1/object/public/survey-images/';
    const idx = u.pathname.indexOf(marker);
    if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + marker.length));
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('survey-images');
    if (i >= 0) return decodeURIComponent(parts.slice(i + 1).join('/'));
  } catch {
    /* ignore */
  }
  return null;
}

export function isTemplateOwnedMediaEntry(entry) {
  const key = entry?.key || r2KeyFromUrl(entry?.url);
  return isTemplateR2Key(key);
}

export function stripTemplateOwnedMedia(preloadedImages = []) {
  return (preloadedImages || []).filter((e) => !isTemplateOwnedMediaEntry(e));
}

/** Self-host: no account session; local API calls need no auth header. */
export async function authHeaders(extra = {}) {
  return { ...extra };
}
