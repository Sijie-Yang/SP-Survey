import { ANALYSIS_ALGORITHM_VERSION } from './analysisVersion.js';
import { recordedRevisionSelection } from './recordedSurvey.js';
import { responseRecordKey } from './responseIdentity.js';

export const ANALYSIS_SCOPE_VERSION = '1.0.0';
export const DATA_SOURCES = Object.freeze(['human', 'practice', 'silicon']);

function text(value) {
  const next = value == null ? '' : String(value).trim();
  return next || null;
}

function bool(value, fallback = false) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

export function defaultAnalysisTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function createAnalysisScope(raw = {}) {
  const dataSource = DATA_SOURCES.includes(raw.dataSource) ? raw.dataSource : 'human';
  const includePractice = dataSource === 'practice' ? true : bool(raw.includePractice, false);
  return {
    version: ANALYSIS_SCOPE_VERSION,
    projectId: text(raw.projectId),
    dataSource,
    siliconRunId: dataSource === 'silicon' ? text(raw.siliconRunId) : null,
    surveyRevision: text(raw.surveyRevision),
    contractSource: raw.contractSource || null,
    dateFrom: text(raw.dateFrom),
    dateTo: text(raw.dateTo),
    timezone: text(raw.timezone) || defaultAnalysisTimezone(),
    sessionId: text(raw.sessionId),
    includePractice,
    excludeFlagged: bool(raw.excludeFlagged, false),
    untimedPolicy: raw.untimedPolicy === 'include' ? 'include' : 'exclude',
    questionName: text(raw.questionName),
    dimensionId: text(raw.dimensionId),
    mediaKey: text(raw.mediaKey),
    snapshotId: text(raw.snapshotId),
    generatedAt: text(raw.generatedAt),
    algorithmVersion: text(raw.algorithmVersion) || ANALYSIS_ALGORITHM_VERSION,
  };
}

export function analysisScopeKey(scope) {
  const next = createAnalysisScope(scope || {});
  return JSON.stringify({
    projectId: next.projectId,
    dataSource: next.dataSource,
    siliconRunId: next.siliconRunId,
    surveyRevision: next.surveyRevision,
    dateFrom: next.dateFrom,
    dateTo: next.dateTo,
    timezone: next.timezone,
    sessionId: next.sessionId,
    includePractice: next.includePractice,
    excludeFlagged: next.excludeFlagged,
    untimedPolicy: next.untimedPolicy,
    questionName: next.questionName,
    dimensionId: next.dimensionId,
    mediaKey: next.mediaKey,
  });
}

export function scopesEqual(a, b) {
  return analysisScopeKey(a) === analysisScopeKey(b);
}

export function analysisScopeFingerprint(scope, responseIds = []) {
  const ids = [...responseIds].map(String).sort();
  return `${analysisScopeKey(scope)}::${ids.length}::${ids.join(',')}`;
}

function dayBound(dateValue, timezone, endOfDay) {
  if (!dateValue) return null;
  const iso = endOfDay
    ? `${dateValue}T23:59:59.999`
    : `${dateValue}T00:00:00.000`;
  const asUtc = Date.parse(`${iso}Z`);
  if (!Number.isFinite(asUtc)) return null;
  if (!timezone || timezone === 'UTC') {
    if (!endOfDay) return asUtc;
    const next = new Date(`${dateValue}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime();
  }
  // Local / named zone: interpret the calendar day in that zone via Date.
  const start = new Date(`${dateValue}T00:00:00`);
  if (!Number.isFinite(start.getTime())) return null;
  if (!endOfDay) return start.getTime();
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function rowTimestampMs(row) {
  const raw = row?.created_at || row?.survey_metadata?.completion_time || row?.saved_at;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export function rowMatchesAnalysisScope(row, scope, { flagged = false } = {}) {
  const next = createAnalysisScope(scope);
  if (next.projectId && row?.project_id && row.project_id !== next.projectId) return false;
  if (next.dataSource === 'practice' && !row?.survey_metadata?.practice_mode) return false;
  if (next.dataSource !== 'practice' && !next.includePractice && row?.survey_metadata?.practice_mode) {
    return false;
  }
  if (next.dataSource === 'silicon') {
    const runId = row?.survey_metadata?.silicon_run_id || row?.run_id;
    if (next.siliconRunId && runId !== next.siliconRunId) return false;
    if (row?.source && row.source !== 'silicon') return false;
  } else if (row?.source === 'silicon' || row?.survey_metadata?.silicon_run_id) {
    return false;
  }
  if (next.surveyRevision) {
    const revision = row?.survey_metadata?.survey_revision || 'historical_unknown';
    if (revision !== next.surveyRevision) return false;
  }
  if (next.sessionId && row?.survey_metadata?.session_id !== next.sessionId) return false;
  if (next.excludeFlagged && flagged) return false;
  const ts = rowTimestampMs(row);
  if (next.dateFrom || next.dateTo) {
    if (ts == null) return next.untimedPolicy === 'include';
    const start = next.dateFrom ? dayBound(next.dateFrom, next.timezone, false) : -Infinity;
    const end = next.dateTo ? dayBound(next.dateTo, next.timezone, true) : Infinity;
    if (start != null && ts < start) return false;
    if (end != null && ts >= end) return false;
  }
  return true;
}

export function filterRowsByScope(rows, scope, { flaggedKeys = new Set() } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    rowMatchesAnalysisScope(row, scope, {
      flagged: flaggedKeys.has(responseRecordKey(row)),
    })
  ));
}

export function resolveScopeRevision(rows, scope) {
  const next = createAnalysisScope(scope);
  if (next.surveyRevision) return next.surveyRevision;
  return recordedRevisionSelection(rows, '') || null;
}

export function describeContractSource(rows, resolvedRevision) {
  const relevant = (rows || []).filter((row) => (
    !resolvedRevision || (row.survey_metadata?.survey_revision || 'historical_unknown') === resolvedRevision
  ));
  const missing = relevant.filter((row) => !row.survey_metadata?.survey_response_contract?.questions);
  if (!relevant.length) return { contractSource: 'current_draft', missingContractCount: 0 };
  if (missing.length === relevant.length) {
    return { contractSource: 'current_draft_fallback', missingContractCount: missing.length };
  }
  if (missing.length) {
    return { contractSource: 'mixed_frozen', missingContractCount: missing.length };
  }
  return { contractSource: 'frozen', missingContractCount: 0 };
}

export function toToolFilters(scope) {
  const next = createAnalysisScope(scope);
  return {
    projectId: next.projectId,
    dataSource: next.dataSource,
    siliconRunId: next.siliconRunId,
    includePractice: next.includePractice,
    excludeFlagged: next.excludeFlagged,
    dateFrom: next.dateFrom,
    dateTo: next.dateTo,
    timezone: next.timezone,
    sessionId: next.sessionId,
    surveyRevision: next.surveyRevision,
    questionName: next.questionName,
    dimensionId: next.dimensionId,
    mediaKey: next.mediaKey,
    untimedPolicy: next.untimedPolicy,
  };
}
