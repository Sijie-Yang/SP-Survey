import { API_BASE_URL } from './apiConfig';

const API_BASE = API_BASE_URL || '';

async function agentFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      error: data.error || res.statusText,
      code: data.code,
      status: res.status,
      ...data,
    };
  }
  return data;
}

function localKeyHint() {
  if (typeof window === 'undefined') return { key: '', valid: false, openrouter: false };
  const key = window.localStorage.getItem('openaiApiKey') || '';
  const valid = window.localStorage.getItem('apiKeyValid') === 'true';
  return { key, valid, openrouter: key.startsWith('sk-or-') };
}

export function getAgentApiBase() {
  return API_BASE;
}

export function getPublicAppOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin.replace(/\/$/, '');
  return 'http://localhost:3000';
}

export function getMcpEndpoint() {
  return `${getPublicAppOrigin()}/api/agent`;
}

export async function listMcpConnections() {
  return { success: true, connections: [] };
}

export async function getCredentialStatus() {
  const { key, valid, openrouter } = localKeyHint();
  const providerId = openrouter ? 'openrouter' : 'openai';
  const models = openrouter
    ? [
      { id: 'openai/gpt-4o', label: 'GPT-4o', vision: true, input: ['text', 'image'] },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', vision: true, input: ['text', 'image'] },
    ]
    : [
      { id: 'gpt-4o', label: 'GPT-4o', vision: true, input: ['text', 'image'] },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', vision: true, input: ['text', 'image'] },
    ];
  const directory = key && valid
    ? [{
      id: providerId,
      configured: true,
      userConfigured: true,
      displayName: openrouter ? 'OpenRouter' : 'OpenAI',
      models,
    }]
    : [];
  return {
    success: true,
    assistantConfigured: Boolean(key && valid),
    openai: { configured: Boolean(key && valid && !openrouter) },
    configuredProviders: directory.map((row) => row.id),
    directory,
    defaultRoute: directory[0] ? { provider: directory[0].id, model: models[0].id } : null,
    siliconRoute: directory[0] ? { provider: directory[0].id, model: models[0].id } : null,
  };
}

export async function saveAiSettings() {
  return { success: true };
}

export async function sendAgentChat({
  message,
  currentConfig,
  conversationHistory,
  researchContext,
  customPrompts,
  enableMultiAgentReview = false,
  reviewMode = '1v1',
  projectId,
  sessionId,
  provider,
  model,
  reasoningEffort,
  assistantMode = 'agent',
  onStarted,
  onSnapshot,
  editorContext = null,
  apiKey = '',
}) {
  const { key } = localKeyHint();
  const started = await agentFetch('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      currentConfig,
      conversationHistory,
      researchContext,
      customPrompts,
      enableMultiAgentReview,
      reviewMode,
      projectId,
      sessionId,
      provider,
      model,
      reasoningEffort,
      assistantMode,
      editorContext,
      apiKey: apiKey || key,
    }),
  });
  if (!started?.success || !started?.queued || !started?.sessionId || !started?.runId) {
    return started;
  }
  onStarted?.(started);
  return waitForAgentRun(started.sessionId, started.runId, { started, onSnapshot });
}

export async function listAiSessions(projectId) {
  return agentFetch(`/api/agent/sessions?projectId=${encodeURIComponent(projectId || '')}`);
}

export async function getAiSession(sessionId, after = 0) {
  const query = after > 0 ? `?after=${encodeURIComponent(after)}` : '';
  return agentFetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}${query}`);
}

export async function archiveAiSession(sessionId) {
  return agentFetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function getAiRun(runId) {
  return agentFetch(`/api/agent/runs/${encodeURIComponent(runId)}`);
}

export async function cancelAiRun(runId) {
  return agentFetch(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
}

export async function steerAiSession(sessionId, content, target = 'next-step', extra = {}) {
  return agentFetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/steer`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      kind: 'steer',
      target,
      assistantMode: extra.assistantMode || null,
      projectId: extra.projectId || null,
      parentRunId: extra.parentRunId || null,
      editorContext: extra.editorContext || null,
    }),
  });
}

export async function listAiRunApprovals() {
  return { success: true, approvals: [] };
}

export async function answerAiRunApproval() {
  return { success: true };
}

export async function listAiInbox() {
  return { success: true, items: [] };
}

export async function discardAiInbox() {
  return { success: true };
}

function runStatusFromEvents(events = [], runId) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (runId && event.run_id && event.run_id !== runId) continue;
    if (event.type === 'run.status' && event.payload?.status) return event.payload.status;
  }
  return '';
}

function runChangedDraft(events = [], runId) {
  return events.some((event) => (
    (!runId || !event.run_id || event.run_id === runId)
    && event.type === 'tool.result'
    && (event.payload?.name === 'survey_apply_operations' || event.payload?.name === 'survey_submit_generated_draft')
    && event.payload?.ok !== false
  ));
}

export async function waitForAgentRun(sessionId, runId, {
  started = {},
  intervalMs = 750,
  timeoutMs = 20 * 60 * 1000,
  onSnapshot,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let after = 0;
  let events = [];
  const currentRunId = runId;
  while (Date.now() < deadline) {
    const snapshot = await getAiSession(sessionId, after);
    if (!snapshot?.success) return snapshot;
    if (Array.isArray(snapshot.events) && snapshot.events.length) {
      events = events.concat(snapshot.events);
      after = Number(snapshot.nextCursor || snapshot.events.at(-1)?.seq || after);
    }
    onSnapshot?.({ ...snapshot, events, currentRunId });
    const run = snapshot.run?.id === currentRunId
      ? snapshot.run
      : snapshot.runs?.find?.((item) => item.id === currentRunId);
    const status = run?.status || runStatusFromEvents(events, currentRunId);
    if (status === 'completed') {
      const result = run?.result || {};
      return {
        success: true,
        runtime: started.runtime || 'local',
        sessionId,
        runId: currentRunId,
        messages: snapshot.messages || result.messages || [],
        surveyConfig: result.surveyConfig,
        intent: result.intent,
        message: result.message,
        draftMutated: result.draftMutated ?? runChangedDraft(events, currentRunId),
        persisted: result.persisted ?? result.draftMutated ?? runChangedDraft(events, currentRunId),
        draftUpdatedAt: result.draftUpdatedAt || null,
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      return {
        success: false,
        sessionId,
        runId: currentRunId,
        error: run?.error || snapshot.error || `Run ${status}`,
        messages: snapshot.messages || [],
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { success: false, error: 'Assistant run timed out', sessionId, runId };
}

export async function listSiliconPersonas(projectId) {
  return agentFetch(`/api/agent/silicon/personas?projectId=${encodeURIComponent(projectId)}`);
}

export async function saveSiliconPersona(body) {
  return agentFetch('/api/agent/silicon/personas', {
    method: 'POST',
    body: JSON.stringify({ ...body, apiKey: localKeyHint().key }),
  });
}

export async function deleteSiliconPersona(id) {
  return agentFetch(`/api/agent/silicon/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listSiliconRuns(projectId) {
  return agentFetch(`/api/agent/silicon/runs?projectId=${encodeURIComponent(projectId)}`);
}

export async function createSiliconRun(body) {
  return agentFetch('/api/agent/silicon/runs', {
    method: 'POST',
    body: JSON.stringify({ ...body, apiKey: localKeyHint().key }),
  });
}

export async function processSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/process`, { method: 'POST' });
}

export async function cancelSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
}

export async function resumeSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' });
}

export async function retryFailedSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/retry-failed`, { method: 'POST' });
}

export async function listSiliconTasks() {
  return agentFetch('/api/agent/silicon/tasks');
}

export async function getSiliconProgress(runId, after = 0) {
  const cursor = after ? `?after=${encodeURIComponent(after)}` : '';
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/progress${cursor}`);
}

export async function getSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}`);
}

export async function listSiliconResponses(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/responses`);
}

export async function getSiliconCompare(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/compare`);
}

export async function exportSiliconRun(runId) {
  return agentFetch(`/api/agent/silicon/runs/${encodeURIComponent(runId)}/export`);
}
