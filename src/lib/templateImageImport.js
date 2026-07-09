/** Template → project image import helpers (Supabase Storage copy + progress tracking). */

import { listImagesFromR2 } from './r2';
import { supabase, isSupabaseConfigured, reinitializeSupabase } from './supabase';
import { inferMediaType } from './mediaUtils';

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

/**
 * Compare template storage folder vs project folder by filename.
 * Supports resume: already-copied files count as imported.
 */
export async function computeTemplateImportProgress(templateId, userId, projectId) {
  if (!templateId || !projectId) {
    return { totalInTemplate: 0, importedCount: 0, remaining: 0, isComplete: true, templateImages: [], error: null };
  }
  const templatePrefix = `templates/${templateId}/`;
  const projectPrefix = `${userId}/${projectId}/`;

  const [listed, existing] = await Promise.all([
    listImagesFromR2(templatePrefix),
    listImagesFromR2(projectPrefix),
  ]);

  if (!listed.success) {
    return {
      totalInTemplate: 0,
      importedCount: 0,
      remaining: 0,
      isComplete: false,
      templateImages: [],
      error: listed.error || 'Failed to list template images',
    };
  }

  const existingNames = new Set((existing.images || []).map((i) => i.name));
  const templateImages = listed.images || [];
  const importedCount = templateImages.filter((img) => existingNames.has(img.name)).length;
  const totalInTemplate = templateImages.length;
  const remaining = Math.max(0, totalInTemplate - importedCount);

  return {
    totalInTemplate,
    importedCount,
    remaining,
    isComplete: totalInTemplate === 0 || remaining === 0,
    templateImages,
    existingNames,
    error: null,
  };
}

export function buildTemplateCopyTodo(templateImages, existingNames, projectPrefix) {
  return templateImages
    .filter((img) => !existingNames.has(img.name))
    .map((img) => ({ from: img.key, to: `${projectPrefix}${img.name}` }));
}

function publicUrlForKey(key) {
  if (!key || !isSupabaseConfigured()) return '';
  try {
    reinitializeSupabase();
    if (!supabase) return '';
    const { data } = supabase.storage.from('survey-images').getPublicUrl(key);
    return data.publicUrl;
  } catch {
    return '';
  }
}

export function mergeCopiedIntoProjectImages(existingImages, copiedImages) {
  const byName = new Map();
  (existingImages || []).forEach((img) => {
    byName.set(img.name, {
      url: img.url || publicUrlForKey(img.key),
      name: img.name,
      key: img.key,
      type: img.type || inferMediaType(img.name),
    });
  });
  copiedImages.forEach((c) => {
    const destKey = c.to || c.destKey;
    const name = destKey.split('/').pop();
    byName.set(name, {
      url: c.url || publicUrlForKey(destKey),
      name,
      key: destKey,
      type: inferMediaType(name),
    });
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatTemplateImportStatus(progress) {
  if (!progress) return '';
  if (progress.totalInTemplate === 0) return 'No images in template folder';
  if (progress.isComplete) return `Complete (${progress.importedCount}/${progress.totalInTemplate})`;
  return `${progress.importedCount}/${progress.totalInTemplate} imported · ${progress.remaining} remaining`;
}
