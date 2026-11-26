/**
 * Platform preview media library — shared R2 folder for admin-curated media.
 * Used whenever a project/template has no media: question editor preview,
 * survey preview, skill library demos, etc.
 *
 * R2 prefix stays `skill-preview/` for backward compatibility with existing objects.
 */
import { listImagesFromR2 } from './r2';
import { loadPreviewMediaLibrary } from './previewMediaLibraryStorage';
import { filterMediaByType, inferMediaType, normalizeMediaEntry } from './mediaUtils';
import { isRandomMediaQuestion } from './surveyMediaInjection';
import { shuffled } from './shuffle.js';

/** Canonical R2 prefix (legacy name kept so existing uploads keep working). */
export const PREVIEW_MEDIA_PREFIX = 'skill-preview/';

/** @deprecated Use PREVIEW_MEDIA_PREFIX */
export const SKILL_PREVIEW_PREFIX = PREVIEW_MEDIA_PREFIX;

function normalizePreviewEntries(entries) {
  return (entries || [])
    .map((entry) => normalizeMediaEntry(entry, PREVIEW_MEDIA_PREFIX))
    .filter((entry) => entry?.url);
}

async function listPreviewMediaFromR2() {
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

/** List all media in the shared preview library. Returns [] on any failure. */
export async function listPreviewMedia() {
  const context = await resolvePreviewMediaContext({});
  return context.images;
}

/**
 * Project/template media first. When falling back to the shared preview
 * library, also return that library's category/set tags — images alone are
 * not enough for per-category sampling.
 */
export async function resolvePreviewMediaContext(project = {}) {
  const projectImages = Array.isArray(project.preloadedImages) ? project.preloadedImages : [];
  if (projectImages.length > 0) {
    return {
      images: projectImages,
      imageDatasetConfig: project.imageDatasetConfig || project.image_dataset_config || {},
      fromPreviewLibrary: false,
    };
  }
  return fetchSharedPreviewContext();
}

/**
 * Same as resolvePreviewMediaContext, but reuses the shared-library lookup for
 * a short while. For live editor previews that rebuild on every edit.
 */
export function resolvePreviewMediaContextCached(project = {}) {
  const projectImages = Array.isArray(project.preloadedImages) ? project.preloadedImages : [];
  if (projectImages.length > 0) return resolvePreviewMediaContext(project);
  return loadSharedPreviewContext();
}

// The shared library rarely changes; the question preview asks for it on every
// edit, so reuse one lookup for a short while instead of hitting Supabase/R2.
const SHARED_PREVIEW_TTL_MS = 30_000;
let sharedPreviewCache = null; // { at, promise }

function loadSharedPreviewContext() {
  const now = Date.now();
  if (sharedPreviewCache && now - sharedPreviewCache.at < SHARED_PREVIEW_TTL_MS) {
    return sharedPreviewCache.promise;
  }
  const promise = fetchSharedPreviewContext();
  sharedPreviewCache = { at: now, promise };
  promise.then((ctx) => {
    if (!ctx.images.length && sharedPreviewCache?.promise === promise) sharedPreviewCache = null;
  }, () => {
    if (sharedPreviewCache?.promise === promise) sharedPreviewCache = null;
  });
  return promise;
}

/** Drop the cached shared preview library (e.g. after editing it). */
export function invalidatePreviewMediaCache() {
  sharedPreviewCache = null;
}

async function fetchSharedPreviewContext() {
  try {
    const saved = await loadPreviewMediaLibrary();
    if (saved.revision > 0) {
      return {
        images: normalizePreviewEntries(saved.preloadedImages),
        imageDatasetConfig: saved.imageDatasetConfig || {},
        fromPreviewLibrary: true,
      };
    }
  } catch {
    // Read-only previews remain available before the cloud manifest is initialized.
  }
  const images = await listPreviewMediaFromR2();
  return {
    images,
    imageDatasetConfig: {},
    fromPreviewLibrary: images.length > 0,
  };
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
  const n = Math.max(0, Number(count) || 0);
  if (!n) return [];
  const order = shuffled(matching);
  const picked = order.slice(0, n);
  while (picked.length < n) {
    picked.push(order[picked.length % order.length]);
  }
  return picked;
}

/**
 * Prefer project/template media; fall back to the platform preview library.
 */
export async function resolveMediaPoolForPreview(projectImages = []) {
  const context = await resolvePreviewMediaContext({ preloadedImages: projectImages });
  return context.images;
}

const trimFolder = (f) => String(f || '').trim().replace(/^\/+|\/+$/g, '');

/**
 * Preview-library fallback only: a project without media should still preview every
 * question. Folder scopes the shared library does not have (e.g. a template's "clips")
 * are dropped for individual-mode questions, and media may repeat across trials.
 */
export function surveyUsesSampledMedia(config) {
  const walk = (elements) => (elements || []).some((element) => (
    isRandomMediaQuestion(element) || walk(element.elements)
  ));
  return (config?.pages || []).some((page) => walk(page.elements));
}

export function adaptQuestionForPreviewLibrary(question, pool = []) {
  if (!question || typeof question !== 'object' || !question.type) return question;
  const out = { ...question, excludePreviouslyUsedImages: false };
  const folders = Array.isArray(question.mediaFolders) ? question.mediaFolders.map(trimFolder).filter(Boolean) : [];
  const mode = question.mediaAssignmentMode || 'individual';
  if (folders.length && mode === 'individual') {
    const available = (pool || []).map((e) => trimFolder(e?.folder || e?.logicalFolder));
    const usable = folders.filter((f) => available.some((a) => a === f || a.startsWith(`${f}/`)));
    if (usable.length) out.mediaFolders = usable;
    else delete out.mediaFolders;
  }
  return out;
}

export function adaptSurveyForPreviewLibrary(config, pool = []) {
  if (!config || !Array.isArray(config.pages)) return config;
  const walk = (els) => (els || []).map((e) => {
    const next = adaptQuestionForPreviewLibrary(e, pool);
    return Array.isArray(next?.elements) ? { ...next, elements: walk(next.elements) } : next;
  });
  return { ...config, pages: config.pages.map((p) => ({ ...p, elements: walk(p.elements) })) };
}
