const PREFS_PREFIX = 'sp-admin-guide:v1:';
const PROGRESS_PREFIX = 'sp-admin-guide-progress:v1:';
export const GUIDE_PROGRESS_EVENT = 'sp-admin-guide-progress';

const DISPLAY_ONLY_TYPES = new Set(['html', 'expression', 'image', 'mediadisplay']);

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson(key) {
  const store = storage();
  if (!store) return {};
  try {
    const value = JSON.parse(store.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJson(key, value) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or privacy mode: the guide simply reappears next time.
  }
}

/** Dismissals are remembered per signed-in user on this browser. */
export function loadGuidePrefs(userId) {
  return readJson(PREFS_PREFIX + (userId || 'anonymous'));
}

export function saveGuidePrefs(userId, patch) {
  const next = { ...loadGuidePrefs(userId), ...patch };
  writeJson(PREFS_PREFIX + (userId || 'anonymous'), next);
  return next;
}

export function resetGuidePrefs(userId) {
  const store = storage();
  store?.removeItem(PREFS_PREFIX + (userId || 'anonymous'));
  return {};
}

export function loadGuideProgress(projectId) {
  return projectId ? readJson(PROGRESS_PREFIX + projectId) : {};
}

/** Record that the researcher previewed or shared a project (no server state exists for these). */
export function markGuideProgress(projectId, key) {
  if (!projectId || !key) return;
  const current = loadGuideProgress(projectId);
  if (current[key]) return;
  writeJson(PROGRESS_PREFIX + projectId, { ...current, [key]: Date.now() });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(GUIDE_PROGRESS_EVENT, { detail: { projectId, key } }));
  }
}

export function countAnswerableQuestions(surveyConfig) {
  return (surveyConfig?.pages || [])
    .flatMap((page) => page?.elements || [])
    .filter((question) => question && !DISPLAY_ONLY_TYPES.has(question.type))
    .length;
}

export const CHECKLIST_KEYS = ['media', 'questions', 'preview', 'published', 'shared', 'responses'];

/**
 * Derive checklist state from what the project already contains.
 * responseCount is null when it could not be read (e.g. self-hosted without Supabase).
 */
export function computeGuideChecklist({ project, surveyConfig, progress = {}, responseCount = null }) {
  const mediaCount = Array.isArray(project?.preloadedImages) ? project.preloadedImages.length : 0;
  const questionCount = countAnswerableQuestions(surveyConfig);
  const responses = Number(responseCount) || 0;
  const publishedVersion = Number(project?.publishedVersion) || 0;
  const items = {
    media: { done: mediaCount > 0, count: mediaCount },
    questions: { done: questionCount > 0, count: questionCount },
    preview: { done: Boolean(progress.preview) || responses > 0 },
    published: { done: publishedVersion > 0 || responses > 0, version: publishedVersion },
    shared: { done: Boolean(progress.shared) || responses > 0 },
    responses: { done: responses > 0, count: responses, unknown: responseCount == null },
  };
  const doneCount = CHECKLIST_KEYS.filter((key) => items[key].done).length;
  return { items, doneCount, total: CHECKLIST_KEYS.length, isNewProject: doneCount === 0 };
}
