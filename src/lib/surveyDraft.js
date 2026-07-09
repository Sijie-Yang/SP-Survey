const DRAFT_PREFIX = 'survey_draft_';

export function buildDraftKey(projectId, participantId) {
  return `${DRAFT_PREFIX}${projectId}_${participantId}`;
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
  localStorage.setItem(key, JSON.stringify({
    ...payload,
    participantId,
    projectId,
    savedAt: new Date().toISOString(),
  }));
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
