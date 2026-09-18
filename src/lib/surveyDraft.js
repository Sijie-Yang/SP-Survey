const DRAFT_PREFIX = 'survey_draft_';
const PENDING_PREFIX = 'survey_pending_';

/** Keep the answered questions/media snapshot, but use the current UI language. */
export function restoreDraftSurveyJson(draft, currentConfig) {
  if (!draft?.finalSurveyJson) return null;
  const restored = JSON.parse(JSON.stringify(draft.finalSurveyJson));
  if (currentConfig?.locale != null) restored.locale = currentConfig.locale;
  // Older snapshots disabled the native bar without recording the custom bar's setting.
  // Recover that UI preference from current settings; new snapshots keep it explicitly.
  if (restored._spProgressEnabled == null && currentConfig?.showProgressBar != null) {
    restored.showProgressBar = currentConfig.showProgressBar;
  }
  return restored;
}

export function buildDraftKey(projectId, participantId) {
  return `${DRAFT_PREFIX}${projectId}_${participantId}`;
}

export function buildPendingKey(projectId, participantId) {
  return `${PENDING_PREFIX}${projectId}_${participantId}`;
}

export function findDraftForProject(projectId) {
  if (!projectId) return null;
  const prefix = `${DRAFT_PREFIX}${projectId}_`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      try {
        const draft = JSON.parse(localStorage.getItem(key));
        if (draft?.surveyData) return { key, draft };
      } catch {
        // ignore corrupt entries
      }
    }
  }
  return null;
}

export function saveDraft(projectId, participantId, payload) {
  if (!projectId || !participantId) return;
  const key = buildDraftKey(projectId, participantId);
  try {
    localStorage.setItem(key, JSON.stringify({
      ...payload,
      participantId,
      projectId,
      savedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('saveDraft failed (quota?):', err?.message || err);
  }
}

export function clearDraft(projectId, participantId) {
  if (!projectId || !participantId) return;
  localStorage.removeItem(buildDraftKey(projectId, participantId));
}

export function clearDraftByKey(key) {
  if (key) localStorage.removeItem(key);
}

/** Remove every in-progress draft for a project (any participant). */
export function clearAllDraftsForProject(projectId) {
  if (!projectId) return;
  const prefix = `${DRAFT_PREFIX}${projectId}_`;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

/** Persist before sending so refresh/retry recovers even without a server acknowledgement. */
export function savePendingSubmission(projectId, participantId, completeData, meta = {}) {
  if (!projectId || !participantId || !completeData) return false;
  try {
    localStorage.setItem(buildPendingKey(projectId, participantId), JSON.stringify({
      completeData,
      meta,
      participantId,
      projectId,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch (err) {
    console.warn('savePendingSubmission failed (quota?):', err?.message || err);
    return false;
  }
}

export function findPendingSubmission(projectId) {
  if (!projectId) return null;
  const prefix = `${PENDING_PREFIX}${projectId}_`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      try {
        const pending = JSON.parse(localStorage.getItem(key));
        if (pending?.completeData) return { key, pending };
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export function clearPendingSubmission(projectId, participantId) {
  if (!projectId || !participantId) return;
  localStorage.removeItem(buildPendingKey(projectId, participantId));
}

export function clearPendingByKey(key) {
  if (key) localStorage.removeItem(key);
}
