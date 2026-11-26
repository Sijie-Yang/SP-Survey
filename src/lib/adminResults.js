/** OSS has no platform-admin response API. Kept so Results Analysis can share Platform code. */
import { supabase } from './supabase';
import { restoreResponseContracts } from './slimResponses';
import { loadSurveyResponsePage, RESPONSE_INTERACTIVE_BATCH, RESPONSE_INTERACTIVE_KEY_PAGE } from './responsePageLoader';

const API_BASE = process.env.REACT_APP_SERVER_URL || process.env.REACT_APP_API_URL || '';

export class AdminResultsError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'AdminResultsError';
    Object.assign(this, extra);
  }
}

export async function fetchAdminResponsePage() {
  throw new AdminResultsError('Platform admin response loading is not available in the self-hosted edition.', {
    code: 'ADMIN_RESULTS_UNAVAILABLE',
    stage: 'oss',
    status: 404,
  });
}

/** Per-load state: contracts already received (sent once per load) and whether the slim RPC exists ('auto' until the first page says). */
export function createResponseLoadSession() {
  return { contracts: new Map(), mode: 'auto' };
}

function perRequestSignal(parent) {
  const timeout = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : null;
  if (parent && timeout && typeof AbortSignal.any === 'function') return AbortSignal.any([parent, timeout]);
  return parent || timeout || undefined;
}

function restorePage({ responses, contracts: received, mode }, loadSession) {
  const contracts = loadSession?.contracts || new Map();
  for (const [key, contract] of Object.entries(received || {})) contracts.set(key, contract);
  if (loadSession && (mode === 'legacy' || mode === 'slim')) loadSession.mode = mode;
  return restoreResponseContracts(responses, contracts);
}

const SUPABASE_URL = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

/**
 * Exact row count for the loading bar. Null when the count header is unavailable.
 * `filters` adds PostgREST filters, e.g. { 'survey_metadata->>practice_mode': 'eq.true' }.
 */
export async function countOwnerResponses(projectId, { signal, filters = null } = {}) {
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {};
  const token = session?.access_token || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token || !projectId) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/survey_responses?${new URLSearchParams({
      ...(filters || {}),
      project_id: `eq.${projectId}`,
      select: 'id',
    })}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
      cache: 'no-store',
      signal: perRequestSignal(signal),
    });
    if (!res.ok) return null;
    const header = res.headers.get('content-range') || '';
    const total = header.includes('/') ? Number(header.split('/').pop()) : NaN;
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/** Owner Results: same page loader as the admin Worker, through PostgREST with the owner's session (RLS). */
export async function fetchOwnerResponsePage(projectId, after = null, loadSession = createResponseLoadSession(), { onProgress, signal } = {}) {
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {};
  const token = session?.access_token || SUPABASE_ANON_KEY;
  const rest = async ({ path, method = 'GET', query = '', body }) => {
    const res = await fetch(`${SUPABASE_URL}${path}${query}`, {
      method,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: perRequestSignal(signal),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      throw Object.assign(new Error(data?.message || res.statusText || 'Supabase request failed'), {
        status: res.status, code: data?.code, details: data,
      });
    }
    return data;
  };
  // Short pages stay inside the database statement timeout and leave a connection for auth.
  const page = await loadSurveyResponsePage(rest, projectId, {
    after,
    mode: loadSession.mode,
    knownContracts: [...loadSession.contracts.keys()],
    keyLimit: RESPONSE_INTERACTIVE_KEY_PAGE,
    legacyKeyLimit: RESPONSE_INTERACTIVE_KEY_PAGE,
    batchSize: RESPONSE_INTERACTIVE_BATCH,
    concurrency: 1,
    onProgress,
  });
  return restorePage(page, loadSession);
}
