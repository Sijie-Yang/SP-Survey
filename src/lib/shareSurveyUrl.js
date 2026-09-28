/**
 * Resolve the participant survey URL used by Share (link + QR).
 * A saved http(s) URL is used as-is when it already has a path;
 * a bare origin becomes /survey?project=<id>. Invalid or empty values
 * fall back to the local Live Survey link.
 */
export function localSurveyUrl(origin, projectId) {
  if (!origin || !projectId) return null;
  return `${String(origin).replace(/\/+$/, '')}/survey?project=${encodeURIComponent(projectId)}`;
}

function parseHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function resolveShareSurveyUrl({ deployedParticipantUrl, projectId, origin } = {}) {
  const fallback = localSurveyUrl(origin, projectId);
  const parsed = parseHttpUrl(deployedParticipantUrl);
  if (!parsed) {
    return { url: fallback, isDeployed: false };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (!path) {
    parsed.pathname = '/survey';
    parsed.search = projectId ? `project=${encodeURIComponent(projectId)}` : '';
    parsed.hash = '';
    return { url: parsed.toString(), isDeployed: true };
  }
  return { url: String(deployedParticipantUrl).trim(), isDeployed: true };
}

export function isLocalhostSurveyUrl(url) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
