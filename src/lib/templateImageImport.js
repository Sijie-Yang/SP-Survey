/** Template → project image import helpers (R2 copy + progress tracking). */

import { listImagesFromR2 } from './r2';
import {
  inferMediaType, compareMediaNames, mediaRelativePathFromListing,
  normalizeMediaEntry, folderFromR2Key, sanitizeMediaFolderConfig,
  mergeMediaFolderConfigs,
} from './mediaUtils';
import { PREVIEW_MEDIA_PREFIX } from './previewMediaLibrary';

/** Synthetic import source id for the platform preview media library. */
export const PREVIEW_MEDIA_IMPORT_ID = 'skill-preview';

export function isPreviewMediaImportId(id) {
  return String(id || '') === PREVIEW_MEDIA_IMPORT_ID;
}

export function getTemplateImportHistory(project) {
  return project?.imageDatasetConfig?.templateImportHistory || {};
}

export function mergeTemplateImportHistory(project, templateId, entry) {
  const prev = getTemplateImportHistory(project);
  return {
    ...project.imageDatasetConfig,
    templateImportHistory: {
      ...prev,
      [templateId]: {
        ...prev[templateId],
        ...entry,
        templateId,
      },
    },
  };
}

function emptyImportProgress(error = null) {
  return {
    totalInTemplate: 0,
    importedCount: 0,
    remaining: 0,
    isComplete: false,
    hasStarted: false,
    templateImages: [],
    existingImages: [],
    existingNames: new Set(),
    existingPaths: new Set(),
    sourcePrefix: '',
    error,
  };
}

/**
 * Compare a source R2 prefix vs project folder by relative path (folder/name).
 * Used to skip already-copied files when importing/resuming one source.
 */
export async function computeR2SourceImportProgress(sourcePrefix, userId, projectId) {
  const srcPrefix = String(sourcePrefix || '').replace(/^\/+/, '').replace(/\/?$/, '/');
  if (!srcPrefix || !projectId) return emptyImportProgress();

  const projectPrefix = `${userId}/${projectId}/`;
  const [listed, existing] = await Promise.all([
    listImagesFromR2(srcPrefix),
    listImagesFromR2(projectPrefix),
  ]);

  if (!listed.success) {
    return emptyImportProgress(listed.error || 'Failed to list source images');
  }

  const existingPaths = new Set(
    (existing.images || []).map((i) => mediaRelativePathFromListing(i, projectPrefix)),
  );
  const templateImages = (listed.images || []).filter((img) => {
    const key = String(img.key || img.name || '');
    return !key.includes('/features/') && !key.includes('/preannotations/');
  });
  const importedCount = templateImages.filter(
    (img) => existingPaths.has(mediaRelativePathFromListing(img, srcPrefix)),
  ).length;
  const totalInTemplate = templateImages.length;
  const remaining = Math.max(0, totalInTemplate - importedCount);

  return {
    totalInTemplate,
    importedCount,
    remaining,
    isComplete: totalInTemplate > 0 && remaining === 0,
    hasStarted: importedCount > 0,
    templateImages,
    existingImages: existing.images || [],
    existingNames: existingPaths,
    existingPaths,
    sourcePrefix: srcPrefix,
    error: null,
  };
}

/**
 * Compare template R2 folder vs project folder by relative path (folder/name).
 * Used to skip already-copied files when importing/resuming ONE template.
 */
export async function computeTemplateImportProgress(templateId, userId, projectId) {
  if (!templateId || !projectId) return emptyImportProgress();
  if (isPreviewMediaImportId(templateId)) {
    return computeR2SourceImportProgress(PREVIEW_MEDIA_PREFIX, userId, projectId);
  }
  return computeR2SourceImportProgress(`templates/${templateId}/`, userId, projectId);
}

/** Progress for admin preview media library → project import. */
export async function computePreviewMediaImportProgress(userId, projectId) {
  return computeR2SourceImportProgress(PREVIEW_MEDIA_PREFIX, userId, projectId);
}

export function buildTemplateCopyTodo(templateImages, existingPaths, projectPrefix, templatePrefix = '') {
  const existing = existingPaths instanceof Set
    ? existingPaths
    : new Set(existingPaths || []);
  const tPrefix = templatePrefix || (
    templateImages[0]?.key
      ? String(templateImages[0].key).replace(/[^/]+$/, '')
      : ''
  );
  return templateImages
    .filter((img) => !existing.has(mediaRelativePathFromListing(img, tPrefix)))
    .map((img) => {
      const rel = mediaRelativePathFromListing(img, tPrefix);
      return { from: img.key, to: `${projectPrefix}${rel}` };
    });
}

export function mergeCopiedIntoProjectImages(existingImages, copiedImages, r2PublicUrl, projectPrefix = '') {
  const byPath = new Map();
  (existingImages || []).forEach((img) => {
    const e = normalizeMediaEntry(img, projectPrefix);
    const rel = mediaRelativePathFromListing(e, projectPrefix)
      || (e.folder ? `${e.folder}/${e.name}` : e.name);
    byPath.set(rel, {
      url: e.url || (r2PublicUrl && e.key ? `${r2PublicUrl}/${e.key}` : ''),
      name: e.name,
      key: e.key,
      type: e.type || inferMediaType(e.name),
      folder: e.folder || folderFromR2Key(e.key, projectPrefix),
      media_id: e.media_id || e.key || e.name,
    });
  });
  copiedImages.forEach((c) => {
    const name = c.to.split('/').pop();
    const folder = folderFromR2Key(c.to, projectPrefix);
    const rel = folder ? `${folder}/${name}` : name;
    byPath.set(rel, {
      url: c.url || (r2PublicUrl ? `${r2PublicUrl}/${c.to}` : ''),
      name,
      key: c.to,
      type: inferMediaType(name),
      folder,
      media_id: c.to,
    });
  });
  return [...byPath.values()].sort((a, b) => compareMediaNames(
    a.folder ? `${a.folder}/${a.name}` : a.name,
    b.folder ? `${b.folder}/${b.name}` : b.name,
  ));
}

/** Apply template folder tags into a project's imageDatasetConfig. */
export function mergeTemplateMediaFoldersIntoProject(projectConfig, templateMediaConfig) {
  const merged = mergeMediaFolderConfigs(projectConfig, templateMediaConfig);
  return {
    ...(projectConfig || {}),
    ...sanitizeMediaFolderConfig(merged),
  };
}

/**
 * Label for the template picker.
 * @param {object|null} progress - live R2 path overlap
 * @param {object|null} historyEntry - explicit import history for this template
 */
export function formatTemplateImportStatus(progress, historyEntry = null) {
  const catalog = progress?.totalInTemplate;
  if (historyEntry?.lastImportAt) {
    if (progress?.isComplete) {
      return `Imported (${progress.importedCount}/${progress.totalInTemplate})`;
    }
    if (progress?.hasStarted) {
      return `${progress.importedCount}/${progress.totalInTemplate} imported · ${progress.remaining} left`;
    }
    return historyEntry.isComplete
      ? `Imported (${historyEntry.importedCount}/${historyEntry.totalInTemplate})`
      : `${historyEntry.importedCount || 0}/${historyEntry.totalInTemplate || catalog || '?'} imported`;
  }
  if (catalog === 0) return 'No files in source folder';
  if (typeof catalog === 'number') return `${catalog} in catalog`;
  return '';
}

/** Primary CTA label for the import button. */
export function formatTemplateImportButtonLabel(progress, historyEntry = null, {
  loading = false,
  sourceKind = 'template',
} = {}) {
  if (loading) return 'Importing…';
  const noun = sourceKind === 'preview' ? 'preview library' : 'template';
  const hasHistory = Boolean(historyEntry?.lastImportAt);
  if (hasHistory && progress?.remaining > 0) {
    return `Resume import (${progress.remaining} remaining)`;
  }
  if (hasHistory && (progress?.isComplete || historyEntry?.isComplete)) {
    return `Re-check ${noun} (all copied)`;
  }
  return sourceKind === 'preview'
    ? 'Import from preview media library'
    : 'Import from selected template';
}
