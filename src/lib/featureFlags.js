const ASSISTANT_KEY = 'sp-assistant-enabled';
const SILICON_KEY = 'sp-silicon-experimental';

function readFlag(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored == null) return fallback;
  return stored !== 'false';
}

export function isAssistantEnabled() {
  return readFlag(ASSISTANT_KEY, true);
}

export function isSiliconExperimentalEnabled() {
  return readFlag(SILICON_KEY, true);
}

export function setAssistantEnabled(enabled) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ASSISTANT_KEY, enabled ? 'true' : 'false');
}

export function setSiliconExperimentalEnabled(enabled) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SILICON_KEY, enabled ? 'true' : 'false');
}
