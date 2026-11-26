import { countOwnerResponses } from './adminResults';
import { isSupabaseConfigured } from './supabase';
import { tf } from '../contexts/adminI18n';

const FILE_SERVER = process.env.REACT_APP_SERVER_URL
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

function readTimestamp(project, camel, snake) {
  const value = project?.[camel] || project?.[snake];
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

/** Publish time when the survey has one; otherwise the project created time. */
export function surveyAgeSource(project) {
  const published = readTimestamp(project, 'publishedAt', 'published_at');
  if (published != null) return { kind: 'published', at: published };
  const created = readTimestamp(project, 'createdAt', 'created_at');
  if (created != null) return { kind: 'created', at: created };
  return null;
}

export function formatSurveyAgeWhen(elapsedMs, t) {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60000);
  if (minutes < 1) return t.surveyAgeWhenJustNow;
  if (minutes < 60) {
    return tf(minutes === 1 ? t.surveyAgeWhenMinute : t.surveyAgeWhenMinutes, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return tf(hours === 1 ? t.surveyAgeWhenHour : t.surveyAgeWhenHours, { n: hours });
  }
  const days = Math.floor(hours / 24);
  return tf(days === 1 ? t.surveyAgeWhenDay : t.surveyAgeWhenDays, { n: days });
}

export function formatSurveyAgeCount(count, t) {
  const n = Math.max(0, Number(count) || 0);
  return tf(n === 1 ? t.surveyAgeAnswer : t.surveyAgeAnswers, { n });
}

/**
 * One line for the open project header.
 * responseCount: number of stored responses, null if unreadable, undefined while loading.
 */
export function formatSurveyAgeLabel({ project, responseCount, now = Date.now(), t }) {
  const source = surveyAgeSource(project);
  const countText = responseCount === undefined
    ? t.surveyAgeCountLoading
    : responseCount === null
      ? t.surveyAgeAnswersUnknown
      : formatSurveyAgeCount(responseCount, t);
  if (!source) {
    if (responseCount == null) return '';
    return countText;
  }
  const when = formatSurveyAgeWhen(now - source.at, t);
  const template = source.kind === 'published' ? t.surveyAgePublished : t.surveyAgeCreated;
  return tf(template, { when, count: countText });
}

export function countMatchingProjectResponses(rows, projectId) {
  if (!projectId) return 0;
  return (rows || []).reduce((total, row) => total + (row?.project_id === projectId ? 1 : 0), 0);
}

/** Prefer an explicit count payload; otherwise count rows for this project only. */
export function responseCountFromPayload(payload, projectId) {
  if (payload && Array.isArray(payload.responses)) {
    return countMatchingProjectResponses(payload.responses, projectId);
  }
  const count = Number(payload?.count);
  return Number.isFinite(count) ? count : null;
}

export async function countStoredProjectResponses(projectId, {
  platform = isSupabaseConfigured(),
  countOwner = countOwnerResponses,
  fetchImpl = fetch,
  fileServer = FILE_SERVER,
} = {}) {
  if (!projectId) return null;
  if (platform) return countOwner(projectId);
  try {
    const query = new URLSearchParams({ countOnly: '1', projectId });
    const res = await fetchImpl(`${fileServer}/api/responses?${query}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const payload = await res.json();
    return responseCountFromPayload(payload, projectId);
  } catch {
    return null;
  }
}
