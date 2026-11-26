/**
 * Researcher-owned response storage.
 * When enabled, the participant browser inserts one row with the anon key.
 * The platform does not copy, analyze, or sync that row, and never stores a service_role key.
 */

import { saveSurveyResponse, supabase } from './supabase';

export const DEFAULT_OWN_RESPONSE_TABLE = 'sp_survey_responses';

const TABLE_NAME = /^[a-z][a-z0-9_]{0,49}$/;
const OWN_RESPONSE_KEYS = new Set([
  'ownresponsesupabase',
  'own_response_supabase',
]);

export function stripOwnResponseSupabase(value) {
  if (Array.isArray(value)) return value.map(stripOwnResponseSupabase);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.entries(value).forEach(([key, child]) => {
    if (OWN_RESPONSE_KEYS.has(String(key).toLowerCase())) return;
    out[key] = stripOwnResponseSupabase(child);
  });
  return out;
}

function decodeBase64Url(segment) {
  const b64 = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Role claim from a JWT, or null when the value is not a readable JWT. */
export function jwtRoleClaim(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    const role = payload?.role;
    return typeof role === 'string' ? role.trim() : null;
  } catch {
    return null;
  }
}

export function isServiceRoleKey(token) {
  return jwtRoleClaim(token) === 'service_role';
}

export function normalizeProjectUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: false, error: 'empty-url' };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'bad-url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'https-only' };
  if (parsed.username || parsed.password) return { ok: false, error: 'bad-url' };
  if (!parsed.hostname) return { ok: false, error: 'bad-url' };
  return { ok: true, url: parsed.origin };
}

export function normalizeTableName(raw) {
  const trimmed = String(raw ?? '').trim();
  const table = trimmed || DEFAULT_OWN_RESPONSE_TABLE;
  if (!TABLE_NAME.test(table)) return { ok: false, error: 'bad-table' };
  return { ok: true, table };
}

/**
 * Settings to persist. Disabled stores `{ enabled: false }` only.
 * Enabled requires https URL and anon key, and refuses a service_role JWT.
 */
export function settingsForSave({ enabled, url, anonKey, table } = {}) {
  if (!enabled) return { ok: true, value: { enabled: false } };
  const projectUrl = normalizeProjectUrl(url);
  if (!projectUrl.ok) return projectUrl;
  const key = String(anonKey || '').trim();
  if (!key) return { ok: false, error: 'empty-key' };
  if (isServiceRoleKey(key)) return { ok: false, error: 'service-role' };
  const tableName = normalizeTableName(table);
  if (!tableName.ok) return tableName;
  return {
    ok: true,
    value: {
      enabled: true,
      url: projectUrl.url,
      anonKey: key,
      table: tableName.table,
    },
  };
}

export function readStoredOwnResponse(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const table = normalizeTableName(source.table);
  return {
    enabled: source.enabled === true,
    url: typeof source.url === 'string' ? source.url : '',
    anonKey: typeof source.anonKey === 'string' ? source.anonKey : '',
    table: table.ok ? table.table : DEFAULT_OWN_RESPONSE_TABLE,
  };
}

export function buildOwnResponseTableSql(tableName = DEFAULT_OWN_RESPONSE_TABLE) {
  const normalized = normalizeTableName(tableName);
  if (!normalized.ok) return normalized;
  const name = normalized.table;
  const sql = `-- SP-Survey: one response table in your Supabase project.
-- Default table name: ${DEFAULT_OWN_RESPONSE_TABLE}
-- Row Level Security is on. Only an anon INSERT policy is created.

create table if not exists public.${name} (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  created_at timestamptz not null default now(),
  participant_id text not null,
  language text,
  answers jsonb not null,
  metadata jsonb
);

alter table public.${name} enable row level security;

drop policy if exists ${name}_anon_insert on public.${name};
create policy ${name}_anon_insert
  on public.${name}
  for insert
  to anon
  with check (true);

revoke all on table public.${name} from public, anon, authenticated;
grant insert on table public.${name} to anon;
`;
  return { ok: true, table: name, sql };
}

export function isOwnResponseEnabled(sink) {
  return !!(sink && sink.enabled === true);
}

function isMissingResponseSinkRpc(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  return code === 'PGRST202'
    || code === '42883'
    || /could not find the function/i.test(message)
    || /get_participant_response_sink/i.test(message);
}

export function interpretParticipantResponseSink(data, error) {
  if (error) {
    if (isMissingResponseSinkRpc(error)) return { enabled: false };
    const err = new Error(error.message || 'Could not read where responses are stored.');
    err.cause = error;
    throw err;
  }
  if (!data || data.enabled !== true) return { enabled: false };
  if (data.rejected) {
    return { enabled: true, rejected: String(data.rejected) };
  }
  return {
    enabled: true,
    url: String(data.url || ''),
    anonKey: String(data.anonKey || ''),
    table: String(data.table || DEFAULT_OWN_RESPONSE_TABLE),
  };
}

export async function fetchParticipantResponseSink(projectId) {
  if (!supabase || !projectId) return { enabled: false };
  const { data, error } = await supabase.rpc('get_participant_response_sink', { p_id: projectId });
  return interpretParticipantResponseSink(data, error);
}

export function newResponseRowId() {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16 | 0;
    const value = char === 'x' ? rand : ((rand & 0x3) | 0x8);
    return value.toString(16);
  });
}

function prefersChinese(language) {
  return String(language || '').toLowerCase().startsWith('zh');
}

function redact(text, secret) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!secret) return raw;
  return raw.split(secret).join('[redacted]');
}

export function ownSupabaseFailureMessage(language, status, detail) {
  const zh = prefersChinese(language);
  const statusText = status ? String(status) : (zh ? '网络错误' : 'network error');
  const extra = detail ? ` ${detail}` : '';
  if (zh) {
    return `未能把回答写入研究者的 Supabase（${statusText}）。平台没有保存这份回答。${extra}`.trim();
  }
  return `Could not save your response to the researcher's Supabase (${statusText}). It was not saved on SP-Survey.${extra}`.trim();
}

function rejectedMessage(language, rejected) {
  const zh = prefersChinese(language);
  if (rejected === 'service-role' || rejected === 'service_role') {
    return zh
      ? '问卷配置了 service_role 密钥，已拒绝写入。平台没有保存这份回答。'
      : 'This survey is configured with a service_role key, which is refused. The response was not saved on SP-Survey.';
  }
  if (rejected === 'https-only') {
    return zh
      ? '研究者的 Supabase 地址不是 https。平台没有保存这份回答。'
      : "The researcher's Supabase URL is not https. The response was not saved on SP-Survey.";
  }
  return ownSupabaseFailureMessage(language, zh ? '配置无效' : 'invalid settings', '');
}

function responseRow(completeData) {
  const id = completeData.own_response_row_id || newResponseRowId();
  if (!completeData.own_response_row_id) completeData.own_response_row_id = id;
  const answers = completeData.responses && typeof completeData.responses === 'object'
    ? completeData.responses
    : {};
  return {
    id,
    project_id: completeData.project_id || null,
    participant_id: completeData.participant_id || null,
    language: completeData.language || null,
    answers,
    metadata: {
      survey_metadata: completeData.survey_metadata || null,
      displayed_images: completeData.displayed_images || null,
      displayed_media_groups: completeData.displayed_media_groups || null,
      displayed_media_categories: completeData.displayed_media_categories || null,
      raw_responses: completeData.raw_responses || null,
    },
  };
}

export async function postOwnSupabaseResponse(sink, completeData, fetchImpl = fetch) {
  const language = completeData?.language;
  if (sink?.rejected || isServiceRoleKey(sink?.anonKey)) {
    return {
      success: false,
      storage: 'own-supabase',
      error: new Error(rejectedMessage(language, sink?.rejected || 'service-role')),
    };
  }
  const decided = settingsForSave({
    enabled: true,
    url: sink?.url,
    anonKey: sink?.anonKey,
    table: sink?.table,
  });
  if (!decided.ok) {
    return {
      success: false,
      storage: 'own-supabase',
      error: new Error(rejectedMessage(language, decided.error)),
    };
  }
  const row = responseRow(completeData || {});
  const endpoint = `${decided.value.url}/rest/v1/${decided.value.table}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        apikey: decided.value.anonKey,
        Authorization: `Bearer ${decided.value.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch {
    return {
      success: false,
      storage: 'own-supabase',
      error: new Error(ownSupabaseFailureMessage(language)),
    };
  }
  if (response.status === 409) {
    const text = redact(await response.text(), decided.value.anonKey);
    if (text.includes('23505') || /duplicate key/i.test(text)) {
      return { success: true, storage: 'own-supabase', deduped: true, data: { id: row.id } };
    }
    return {
      success: false,
      storage: 'own-supabase',
      error: new Error(ownSupabaseFailureMessage(language, response.status, text.slice(0, 180))),
    };
  }
  if (response.ok) {
    return { success: true, storage: 'own-supabase', data: { id: row.id } };
  }
  const text = redact(await response.text().catch(() => ''), decided.value.anonKey).slice(0, 180);
  return {
    success: false,
    storage: 'own-supabase',
    error: new Error(ownSupabaseFailureMessage(language, response.status, text)),
  };
}

/**
 * Toggle off uses the platform insert. Toggle on posts to the researcher's
 * Supabase and does not call the platform insert, including when that post fails.
 */
export async function submitParticipantResponse(completeData, sink, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const platformInsert = deps.platformInsert || saveSurveyResponse;
  if (!isOwnResponseEnabled(sink)) {
    return platformInsert(completeData);
  }
  return postOwnSupabaseResponse(sink, completeData, fetchImpl);
}
