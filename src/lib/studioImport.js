/**
 * Studio import: a prepared SP-Scheme upload (spSchemeImport.js) becomes a
 * project. All or nothing: the page's images go to the library first, then
 * the config and the media list are saved in ONE write. If anything fails,
 * the uploaded images are removed again, a project created for this import
 * is deleted, and nothing is saved.
 *
 * Replacing the page of an existing project works on a fresh read of it and
 * keeps the folders the old page was linked to when the new one names none.
 *
 * Folder and file name are a library entry's identity. An image with the same
 * folder, name and size as a library entry is not uploaded again. One with the
 * same folder and name but another size is uploaded and takes the old entry's
 * place in the same save; the old file is deleted from storage only after that
 * save succeeded, and never while the published version still uses it.
 */

import { finalizeSpSchemeImport, spSchemeMediaPlan, summarizeSpSchemeImport } from './spSchemeImport';
import { uploadPlannedMedia } from './spSchemeMediaImport';
import { deleteImagesFromR2, projectR2Prefix, r2KeyFromUrl, uploadImageToR2 } from './r2';
import { normalizeFolderPath, normalizeMediaEntry } from './mediaUtils';
import { createStudioProject, loadStudioProject, loadStudioRelease, removeStudioProject, saveStudioProject } from './studioData';
import { importedProjectName, projectConfig } from './studioProject';

export class StudioImportError extends Error {
  /**
   * @param {'invalid'|'create'|'signin'|'media'|'save'|'missing'} code
   * @param {string} message
   * @param {object} [extra] e.g. { failures: [{ name, error }] }
   */
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'StudioImportError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function identity(folder, name) {
  return `${normalizeFolderPath(folder)}\n${String(name || '')}`;
}

function entrySize(raw) {
  const size = Number(raw?.original_bytes ?? raw?.uploaded_bytes);
  return Number.isFinite(size) ? size : null;
}

function storedKey(entry) {
  return entry?.key || r2KeyFromUrl(entry?.url) || null;
}

/**
 * Sorts the planned files against the library (folder + file name is the identity):
 *   unchanged  same folder, name and size: left out of the plan
 *   replaced   same folder and name, another or unknown size: uploaded, and
 *              `oldEntries` lists the library entries it takes the place of
 *   uploaded   new names: uploaded
 * @returns {{ plan: object|null, uploaded: number, unchanged: number, replaced: number, oldEntries: object[] }}
 */
export function sortPlannedMedia(plan, library = [], projectPrefix = null) {
  const none = { plan: null, uploaded: 0, unchanged: 0, replaced: 0, oldEntries: [] };
  if (!plan?.files?.length) return none;
  const byIdentity = new Map();
  (library || []).forEach((raw) => {
    const entry = normalizeMediaEntry(raw, projectPrefix);
    if (!entry?.name) return;
    const id = identity(entry.folder, entry.name);
    if (!byIdentity.has(id)) byIdentity.set(id, []);
    byIdentity.get(id).push(raw);
  });
  const files = [];
  const oldEntries = [];
  let unchanged = 0;
  let replaced = 0;
  plan.files.forEach((file) => {
    const existing = byIdentity.get(identity(file.folder, file.path.split('/').pop())) || [];
    const size = file.bytes?.length;
    if (existing.length && existing.every((raw) => entrySize(raw) === size)) {
      unchanged += 1;
      return;
    }
    if (existing.length) {
      replaced += 1;
      oldEntries.push(...existing);
    }
    files.push(file);
  });
  return { plan: files.length ? { ...plan, files } : null, uploaded: files.length - replaced, unchanged, replaced, oldEntries };
}

// Old files a replaced entry pointed at, minus those the published version still uses.
async function oldKeysToDelete(target, oldEntries) {
  const keys = [...new Set(oldEntries.map(storedKey).filter(Boolean))];
  if (!keys.length) return [];
  const release = await loadStudioRelease(target.id);
  if (release === null) return [];
  const published = new Set((release?.media?.preloadedImages || []).map(storedKey).filter(Boolean));
  return keys.filter((key) => !published.has(key));
}

/**
 * @param {object} args
 * @param {{ upload, report, hosts?, allowed? }} args.prepared prepareSpSchemeUpload result (report revalidated with the chosen hosts)
 * @param {object|null} args.project the project whose page is replaced; null creates a new one
 * @param {string|null} args.userId owner id for media keys (`${userId}/${projectId}/…`)
 * @param {string} args.fallbackName name for a new project when the page has no title
 * @param {(p: { done: number, total: number }) => void} [args.onProgress] image upload progress
 * @returns {Promise<{ projectId: string, config: object, created: boolean, uploaded: number, unchanged: number, replaced: number }>}
 *   image counts: new in the library, already there unchanged, and replacing an older file
 */
export async function importIntoStudio({ prepared, project = null, userId = null, fallbackName = 'New study', onProgress = () => {} }) {
  const { upload, report } = prepared || {};
  if (!report?.ok || !upload) throw new StudioImportError('invalid', 'This upload cannot be imported.');
  const fullPlan = spSchemeMediaPlan(upload);
  if (fullPlan && !userId) throw new StudioImportError('signin', 'Sign in to upload the images.');

  let target = null;
  let created = false;
  if (project) {
    // The page and media list are replaced on what is stored now, not on an older copy.
    target = await loadStudioProject(project.id);
    if (!target) throw new StudioImportError('missing', 'This study was not found.');
  } else {
    const result = await createStudioProject(importedProjectName(summarizeSpSchemeImport(prepared), fallbackName));
    if (!result.success) throw new StudioImportError('create', result.error);
    created = true;
    target = (await loadStudioProject(result.project.id)) || { ...result.project, _surveyConfig: result.surveyConfig || {} };
  }

  const prefix = userId ? projectR2Prefix(userId, target.id) : null;
  const { plan, uploaded, unchanged, replaced, oldEntries } = sortPlannedMedia(fullPlan, target.preloadedImages, prefix);
  const oldRefs = new Set(oldEntries.map((entry) => storedKey(entry) || entry?.url).filter(Boolean));
  const uploadedKeys = [];
  try {
    let media = target;
    if (plan) {
      const result = await uploadPlannedMedia({
        plan,
        project: target,
        userId,
        upload: async (file, key) => {
          const res = await uploadImageToR2(file, key);
          if (res?.success) uploadedKeys.push(res.key || key);
          return res;
        },
        // Kept in memory: the media list is saved once, together with the config.
        onProjectUpdate: async () => {},
        onProgress,
      });
      if (result.failures.length) {
        throw new StudioImportError('media', result.failures[0].error, { failures: result.failures });
      }
      media = result.project;
    }
    const base = projectConfig(target);
    const config = finalizeSpSchemeImport(report, upload, base);
    // A new page without folders or images of its own keeps the folders the old page was linked to.
    if (config.spSite && !fullPlan && !config.spSite.mediaFolders?.length && base.spSite?.mediaFolders?.length) {
      config.spSite.mediaFolders = [...base.spSite.mediaFolders];
    }
    // A replaced entry leaves the library in the same save that adds its new file.
    const library = (media.preloadedImages || []).filter((entry) => !oldRefs.has(storedKey(entry) || entry?.url));
    const saved = await saveStudioProject({
      ...target,
      preloadedImages: library,
      preloadedAt: media.preloadedAt || null,
      preloadedSource: media.preloadedSource || null,
    }, config);
    if (!saved.success) throw new StudioImportError('save', saved.error);
    const oldKeys = await oldKeysToDelete(target, oldEntries).catch(() => []);
    if (oldKeys.length) {
      // A file left behind is harmless; the library no longer lists it.
      await deleteImagesFromR2(oldKeys, { allowedPrefix: prefix }).catch(() => null);
    }
    return { projectId: target.id, config, created, uploaded, unchanged, replaced };
  } catch (err) {
    if (uploadedKeys.length) {
      await deleteImagesFromR2(uploadedKeys, { allowedPrefix: `${userId}/${target.id}/` }).catch(() => null);
    }
    if (created) await removeStudioProject(target.id).catch(() => null);
    throw err;
  }
}
