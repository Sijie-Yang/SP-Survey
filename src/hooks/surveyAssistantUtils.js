export const AI_SIDEBAR_OPEN_KEY = 'sp-ai-sidebar-open';
export const AI_SIDEBAR_WIDTH = 420;
export const PROJECT_SIDEBAR_WIDTH = 400;
export const AI_SIDEBAR_ID = 'admin-ai-sidebar';

export function readSidebarOpen(storage) {
  if (!storage) return false;
  return storage.getItem(AI_SIDEBAR_OPEN_KEY) === 'true';
}

export function writeSidebarOpen(storage, open) {
  if (!storage) return;
  storage.setItem(AI_SIDEBAR_OPEN_KEY, open ? 'true' : 'false');
}
