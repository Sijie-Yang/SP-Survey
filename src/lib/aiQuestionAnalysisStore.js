/**
 * Saved AI analyses are kept in the project's metadata (resultsAiAnalyses,
 * keyed by question name), so they belong to the project, not to one survey
 * revision, and every export sees the same code.
 * Self-hosted: the metadata sits in the local project file (via the local server).
 */
import { API_ROOT } from './apiConfig';

export async function saveQuestionAnalysis(projectId, questionName, entry) {
  if (!projectId || !questionName) throw new Error('Open a project to save the analysis.');
  const base = `${API_ROOT}/agent/projects/${encodeURIComponent(projectId)}/metadata`;
  const current = await fetch(base, { cache: 'no-store' }).then((res) => res.json()).catch(() => null);
  if (!current?.success) throw new Error(current?.error || 'The local SP-Survey server is not running (npm run dev).');
  const saved = current.metadata?.resultsAiAnalyses;
  const analyses = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
  if (entry) analyses[questionName] = entry;
  else delete analyses[questionName];
  const res = await fetch(base, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set: { resultsAiAnalyses: analyses } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.error || `Saving the analysis failed (HTTP ${res.status}).`);
  return body.metadata;
}
