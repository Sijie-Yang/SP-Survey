/**
 * Studio and the classic editor share one project. The classic editor keeps a
 * per-tab working copy in sessionStorage (`project_editing_states`); after
 * Studio writes a project a clean copy is stale, so Studio drops it and the
 * classic editor loads the saved draft instead. A copy that holds unsaved
 * edits is kept: only the researcher can decide to save or drop those, and
 * Studio tells them so (classicHasUnsavedEdits).
 *
 * Links between the two live in adminDeepLink.js (adminProjectPath, studioPathForProject).
 */

const EDITING_STATES_KEY = 'project_editing_states';

function readEditingStates() {
  try {
    const raw = sessionStorage.getItem(EDITING_STATES_KEY);
    const states = raw ? JSON.parse(raw) : null;
    return states && typeof states === 'object' ? states : null;
  } catch {
    return null;
  }
}

/**
 * Forget the classic editor's clean working copy of this project (no-op when
 * there is none). A copy with unsaved edits is kept unless `evenUnsaved` (the
 * project is gone).
 */
export function forgetClassicEditingState(projectId, { evenUnsaved = false } = {}) {
  if (!projectId) return;
  const states = readEditingStates();
  if (!states || !Object.prototype.hasOwnProperty.call(states, projectId)) return;
  if (!evenUnsaved && states[projectId]?.hasUnsavedChanges === true) return;
  delete states[projectId];
  try {
    sessionStorage.setItem(EDITING_STATES_KEY, JSON.stringify(states));
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

/** True when the classic editor (this tab) holds edits of this project that are not saved yet. */
export function classicHasUnsavedEdits(projectId) {
  if (!projectId) return false;
  return readEditingStates()?.[projectId]?.hasUnsavedChanges === true;
}
