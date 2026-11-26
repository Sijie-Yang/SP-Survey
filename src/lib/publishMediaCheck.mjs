/**
 * Before publishing: a survey whose questions draw images from the project
 * media library cannot be published while that library is empty. A published
 * version never falls back to the preview library, so participants would see
 * no images at all. Shared by Studio / classic publish and the MCP publish.
 */

// Question types the platform fills from the project media library
// (same list as RANDOM_MEDIA_TYPES in surveyMediaInjection.js).
const POOL_MEDIA_TYPES = new Set([
  'imagepicker', 'imageranking', 'imagerating', 'imageboolean', 'imagecheckbox', 'image', 'imagematrix',
  'mediadisplay', 'mediarating', 'mediaboolean', 'mediacheckbox', 'mediaranking', 'mediapicker',
  'mediamatrix', 'mediaslidergroup', 'mediapointallocation',
  'imageannotation', 'imageslidergroup', 'imagepointallocation',
]);

function walk(elements, out) {
  (elements || []).forEach((el) => {
    if (!el || typeof el !== 'object') return;
    out.push(el);
    if (Array.isArray(el.elements)) walk(el.elements, out);
    if (Array.isArray(el.templateElements)) walk(el.templateElements, out);
  });
  return out;
}

function curated(el) {
  return el.imageSelectionMode === 'huggingface_manual' || el.imageSelectionMode === 'manual';
}

function hasHuggingFaceSource(config) {
  return Boolean(String(config?.huggingfaceDataset || config?.imageDatasetConfig?.huggingfaceDataset || '').trim());
}

/** Names of the questions (or "page") that need images from the project media library. */
export function questionsNeedingLibraryMedia(config = {}) {
  const names = [];
  (config?.pages || []).forEach((page) => walk(page?.elements, []).forEach((el) => {
    const drawsFromPool = POOL_MEDIA_TYPES.has(el.type) || (el.type === 'skillquestion' && el.randomImageSelection);
    if (drawsFromPool && !curated(el)) names.push(String(el.name || el.type));
  }));
  const site = config?.spSite;
  if (site?.html) {
    const folders = (site.mediaFolders || []).length
      || /SPSite\s*\.\s*getMedia\s*\(/.test(String(site.html));
    if (folders) names.push('page (SPSite.getMedia)');
  }
  return names;
}

/**
 * null when publishing is fine, else { code: 'MEDIA_LIBRARY_EMPTY', questions, message }.
 * `library` is the project's preloaded_images list.
 */
export function checkPublishMedia(config = {}, library = []) {
  const files = Array.isArray(library) ? library.filter((f) => f && (f.url || f.key)) : [];
  if (files.length || hasHuggingFaceSource(config)) return null;
  const questions = questionsNeedingLibraryMedia(config);
  if (!questions.length) return null;
  return {
    code: 'MEDIA_LIBRARY_EMPTY',
    questions,
    message: `The project media library is empty. ${questions.join(', ')} show images from it, and a published version never uses preview images, so participants would see none. Add images first, then publish.`,
  };
}
