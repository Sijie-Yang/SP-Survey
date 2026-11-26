import { analysisScopeKey, createAnalysisScope, scopesEqual } from './analysisScope.js';

const PREFIX = 'sp-results-report:';

function storage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function reportStorageKey(projectId) {
  return `${PREFIX}${projectId || 'unknown'}`;
}

export function hasReportContent(report) {
  return Boolean(
    (typeof report?.narrative === 'string' && report.narrative.trim())
    || (Array.isArray(report?.findings) && report.findings.some((finding) => typeof finding?.text === 'string' && finding.text.trim()))
  );
}

// Use the completed request's output, never a render's previous chat transcript.
export function reportFromAnalysisResult(result, { scope, overview } = {}) {
  if (result?.success !== true || (result.status && result.status !== 'completed')
    || typeof result.message !== 'string' || !result.message.trim()) return null;
  return createResultsReport({
    scope, overview, narrative: result.message.trim(),
    provider: result.provider, model: result.model, runId: result.runId,
  });
}

export function createResultsReport({
  scope,
  overview,
  findings = [],
  narrative = '',
  model = null,
  provider = null,
  runId = null,
  status = 'completed',
} = {}) {
  const normalized = createAnalysisScope(scope || overview?.scope || {});
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    status,
    scope: normalized,
    scopeKey: analysisScopeKey(normalized),
    snapshotId: overview?.scope?.snapshotId || normalized.snapshotId,
    counts: overview?.counts || null,
    findings,
    narrative,
    model,
    provider,
    runId,
    algorithmVersion: normalized.algorithmVersion,
  };
}

export function readResultsReport(projectId) {
  const db = storage();
  if (!db || !projectId) return null;
  try {
    const raw = JSON.parse(db.getItem(reportStorageKey(projectId)) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

export function writeResultsReport(projectId, report) {
  if (report?.status !== 'completed' || !hasReportContent(report)) return null;
  const db = storage();
  if (!db || !projectId) throw new Error('Report storage is unavailable');
  db.setItem(reportStorageKey(projectId), JSON.stringify(report));
  return report;
}

export function deleteResultsReport(projectId) {
  const db = storage();
  if (!db || !projectId) throw new Error('Report storage is unavailable');
  db.removeItem(reportStorageKey(projectId));
}

export function reportStaleness(report, currentScope, currentSnapshotId) {
  if (!report) return { exists: false, stale: false, reason: null };
  const scopeChanged = currentScope ? !scopesEqual(report.scope, currentScope) : false;
  const dataChanged = currentSnapshotId && report.snapshotId && report.snapshotId !== currentSnapshotId;
  return {
    exists: true,
    stale: Boolean(scopeChanged || dataChanged),
    reason: scopeChanged ? 'scope_changed' : (dataChanged ? 'data_changed' : null),
  };
}
