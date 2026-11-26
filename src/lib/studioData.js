/**
 * Studio's reads and writes, on top of projectManager. Every write drops the
 * classic editor's clean working copy of the project (see studioState.js).
 *
 * Writes are patches: writeStudioProject reads the project fresh, applies the
 * change and saves once, so a write never puts back an older name, media list
 * or page that another write (or another tab, or an agent) saved meanwhile.
 *
 * Self-hosted: projects always live in files on the local server (npm run dev)
 * and every save is live; releasing and deploying stay on the classic Host tab.
 */

import {
  createProject,
  deleteProject,
  getProjectById,
  getUserProjects,
  saveProjectDraftOptimistic,
  saveProjectFull,
} from './projectManager';
import { API_ROOT } from './apiConfig';
import { countOwnerResponses } from './adminResults';
import { deleteImagesFromR2, isR2Configured, listImagesFromR2 } from './r2';
import { loadSurveyConfig } from './surveyStorage';
import { sameReleaseValue } from './releaseComparison';
import { forgetClassicEditingState } from './studioState';
import { projectConfig, sortProjectsNewestFirst } from './studioProject';
import { loadStudioResponses, studioExportRows } from './studioResults';

const LOCAL_API = API_ROOT;

/** Self-hosted Studio always works on local project files (the Supabase here only holds responses and media). */
export const isStudioLocalMode = () => true;

/** The built-in Assistant runs on the local server with the researcher's own key. */
export const isStudioAiAvailable = () => true;

async function localJson(path, init) {
  const res = await fetch(`${LOCAL_API}${path}`, init);
  if (!res.ok) throw new Error(`Local server: ${res.status}`);
  return res.json();
}

/** The researcher's projects, newest first, each with its draft config. */
export async function listStudioProjects() {
  if (!isStudioLocalMode()) return sortProjectsNewestFirst(await getUserProjects());
  // The local server lists file names only; read each project once.
  try {
    const { files = [] } = await localJson('/projects');
    const ids = files.filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, ''));
    const rows = await Promise.all(ids.map((id) => localJson(`/projects/${encodeURIComponent(id)}`).catch(() => null)));
    return sortProjectsNewestFirst(rows
      .filter((row) => row?.success && row.project?.id)
      .map((row) => ({ ...row.project, _surveyConfig: row.surveyConfig || {} })));
  } catch {
    return [];
  }
}

/**
 * One project with its draft config, or null. Someone else's project comes
 * back through the participant view, without an owner: that is not one the
 * researcher can edit, so it counts as not found.
 */
export async function loadStudioProject(projectId) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  if (!isStudioLocalMode() && !project.userId) return null;
  if (project._surveyConfig) return project;
  const config = await loadSurveyConfig(projectId);
  return { ...project, _surveyConfig: config || {} };
}

/**
 * The version participants get, to tell whether the draft has changes they
 * do not see. undefined: not release-managed (or local mode); null: it could
 * not be read.
 * @returns {Promise<{ config: object, media: object } | null | undefined>}
 */
export async function loadStudioRelease() {
  return undefined;
}

function storedProject(project) {
  const { _surveyConfig: _config, accessRole: _role, ...row } = project || {};
  return row;
}

/** Save the project row (name, media) and its draft config in one write. */
export async function saveStudioProject(project, config) {
  const result = await saveProjectFull(storedProject(project), config);
  if (result.success) forgetClassicEditingState(project.id);
  return result;
}

/**
 * Change the stored project: read it fresh, apply `change`, save once.
 * `change(project, config)` returns `{ fields?, config? }` (or nothing):
 * fields of the project row (name, description, media list) and the next
 * draft config. A config-only change carries the draft stamp it was made on;
 * when another write landed in between, the change is applied again to the
 * newer draft.
 * @returns {Promise<{ success: boolean, project?: object, error?: string, unchanged?: boolean }>}
 */
export async function writeStudioProject(projectId, change, { attempts = 3 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const fresh = await loadStudioProject(projectId);
    if (!fresh) return { success: false, error: 'not found' };
    const current = projectConfig(fresh);
    const { fields = null, config = null } = change(fresh, current) || {};
    const configChanged = Boolean(config) && !sameReleaseValue(config, current);
    if (!fields && !configChanged) return { success: true, project: fresh, unchanged: true };
    const nextConfig = configChanged ? config : current;
    let result;
    if (!fields) {
      // eslint-disable-next-line no-await-in-loop
      result = await saveProjectDraftOptimistic(projectId, nextConfig, { expectedDraftUpdatedAt: fresh.draftUpdatedAt || null });
      if (result.conflict) continue; // eslint-disable-line no-continue
      if (result.code === 'DRAFT_SAVE_RPC_MISSING') {
        // eslint-disable-next-line no-await-in-loop
        result = await saveProjectFull(storedProject(fresh), nextConfig);
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      result = await saveProjectFull(storedProject({ ...fresh, ...fields }), nextConfig);
    }
    if (!result?.success) return { success: false, error: result?.error || 'Save failed' };
    forgetClassicEditingState(projectId);
    return {
      success: true,
      project: {
        ...fresh,
        ...(fields || {}),
        _surveyConfig: nextConfig,
        draftUpdatedAt: result.draftUpdatedAt || fresh.draftUpdatedAt || null,
        lastModified: new Date().toISOString(),
      },
    };
  }
  return { success: false, conflict: true, error: 'The study was being changed somewhere else at the same time. Try again.' };
}

export async function createStudioProject(name) {
  const result = await createProject({ name });
  if (result.success) forgetClassicEditingState(result.project.id);
  return result;
}

// The project's own images (only under its prefix; template media is never touched).
async function removeProjectImages(userId, projectId) {
  if (!userId || !projectId || !isR2Configured()) return;
  const prefix = `${userId}/${projectId}/`;
  const listed = await listImagesFromR2(prefix);
  const keys = (listed.success ? listed.images : []).map((img) => img.key).filter((key) => key && key.startsWith(prefix));
  for (let i = 0; i < keys.length; i += 50) {
    // eslint-disable-next-line no-await-in-loop
    await deleteImagesFromR2(keys.slice(i, i + 50), { allowedPrefix: prefix });
  }
}

/**
 * Delete the project, then its own images. The row goes first, so a failed
 * delete never leaves a study whose images are gone.
 */
export async function removeStudioProject(projectId, { userId = null } = {}) {
  const result = await deleteProject(projectId);
  if (!result.success) return result;
  if (isStudioLocalMode()) {
    // deleteProject leaves the local file in place.
    await localJson(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).catch(() => null);
  }
  forgetClassicEditingState(projectId, { evenUnsaved: true });
  await removeProjectImages(userId, projectId).catch(() => null);
  return result;
}

/**
 * How many responses the download holds: researcher practice runs only when
 * the survey includes them (silicon runs live in their own table). Null when
 * it cannot be told.
 */
export async function countStudioResponses(projectId, config = {}) {
  if (!projectId) return null;
  if (isStudioLocalMode()) {
    try {
      return studioExportRows(await loadStudioResponses(projectId), config).length;
    } catch {
      return null;
    }
  }
  const total = await countOwnerResponses(projectId);
  if (!total || config?.includeResearcherPractice === true) return total;
  const practice = await countOwnerResponses(projectId, { filters: { 'survey_metadata->>practice_mode': 'eq.true' } });
  return practice === null ? null : Math.max(0, total - practice);
}

/** Self-hosted: release and deploy on the classic editor's Host tab. */
export async function publishStudioProject() {
  return { success: false, code: 'failed', error: 'Release and deploy on the Host tab of the classic editor.' };
}
