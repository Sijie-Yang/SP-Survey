const STORAGE_KEY = 'sp_survey_browser_id';

/** Persistent anonymous browser id for duplicate-participant detection. */
export function getBrowserId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `b_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `b_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

/** Short completion code for Prolific / course credit verification. */
export function generateCompletionCode(participantId) {
  const src = String(participantId || '');
  let hash = 5381;
  for (let i = 0; i < src.length; i += 1) {
    hash = ((hash << 5) + hash) + src.charCodeAt(i);
  }
  return Math.abs(hash).toString(36).slice(0, 8).toUpperCase();
}
