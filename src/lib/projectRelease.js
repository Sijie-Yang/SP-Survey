import { API_ROOT } from './apiConfig';
import { publicMediaConfig } from './releaseComparison';

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function emptyReleaseState(projectId) {
  return {
    project_id: projectId,
    release_managed: false,
    published_version: 0,
    draft_updated_at: null,
    saved_at: null,
    survey_config_draft: null,
    survey_config_published: null,
    preloaded_images: [],
    image_dataset_config: {},
    published_media: { preloadedImages: [], imageDatasetConfig: {} },
    versions: [],
  };
}

export function normalizeStoredRelease(stored = {}, projectId) {
  const project = stored.project || {};
  const draft = stored.surveyConfig || null;
  const published = stored.publishedSurveyConfig || null;
  return {
    project_id: projectId || project.id,
    release_managed: !!stored.releaseManaged,
    published_version: Number(stored.publishedVersion || 0),
    draft_updated_at: stored.draftUpdatedAt || stored.savedAt || project.lastModified || null,
    saved_at: stored.savedAt || null,
    survey_config_draft: draft,
    survey_config_published: published,
    preloaded_images: draft?.preloadedImages || project.preloadedImages || [],
    image_dataset_config: project.imageDatasetConfig || stored.imageDatasetConfig || {},
    published_media: stored.publishedMedia || {
      preloadedImages: published?.preloadedImages || [],
      imageDatasetConfig: publicMediaConfig(project.imageDatasetConfig || {}),
    },
    versions: Array.isArray(stored.releaseHistory) ? stored.releaseHistory : [],
  };
}

export function liveSurveyConfigFromStored(stored) {
  if (!stored) return null;
  if (stored.releaseManaged && stored.publishedSurveyConfig) return stored.publishedSurveyConfig;
  return stored.surveyConfig || null;
}

export async function fetchStoredProject(projectId) {
  const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error('Project not found');
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Project not found');
  return data;
}

export async function getProjectReleaseState(projectId) {
  const data = await fetchStoredProject(projectId);
  return normalizeStoredRelease({
    project: data.project,
    surveyConfig: data.surveyConfig,
    publishedSurveyConfig: data.publishedSurveyConfig,
    publishedMedia: data.publishedMedia,
    releaseManaged: data.releaseManaged,
    publishedVersion: data.publishedVersion,
    releaseHistory: data.releaseHistory,
    draftUpdatedAt: data.draftUpdatedAt,
    savedAt: data.savedAt,
    imageDatasetConfig: data.project?.imageDatasetConfig,
  }, projectId);
}

export async function getProjectReleaseVersions(projectId) {
  const state = await getProjectReleaseState(projectId);
  return state.versions || [];
}

export async function releaseProjectVersion(projectId, expectedDraftUpdatedAt, { summary = '', restoreVersion = null } = {}) {
  const response = await fetch(`${API_ROOT}/projects/${encodeURIComponent(projectId)}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedDraftUpdatedAt, summary, restoreVersion }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Release failed');
  }
  return data;
}

export function buildReleasePayload(stored, { summary = '', restoreVersion = null } = {}) {
  const now = new Date().toISOString();
  const history = Array.isArray(stored.releaseHistory) ? stored.releaseHistory.slice() : [];
  const source = restoreVersion
    ? history.find((row) => row.version === restoreVersion)
    : null;
  const config = clone(source?.config || stored.surveyConfig || { pages: [] });
  const media = clone(source?.media_snapshot || {
    preloadedImages: config.preloadedImages || [],
    imageDatasetConfig: publicMediaConfig(stored.project?.imageDatasetConfig || {}),
  });
  const nextVersion = Number(stored.publishedVersion || 0) + 1;
  const entry = {
    version: nextVersion,
    releasedAt: now,
    summary: String(summary || '').trim(),
    config,
    media_snapshot: media,
  };
  return {
    ...stored,
    releaseManaged: true,
    publishedVersion: nextVersion,
    publishedSurveyConfig: config,
    publishedMedia: media,
    releaseHistory: [entry, ...history].slice(0, 50),
    lastReleasedAt: now,
  };
}
