/**
 * Self-hosted SP-Survey has no shared, admin-curated preview library manifest.
 * Previews fall back to whatever is in your own storage under `skill-preview/`.
 */
export async function loadPreviewMediaLibrary() {
  return { id: 'preview-media', revision: 0, preloadedImages: [], imageDatasetConfig: {} };
}
