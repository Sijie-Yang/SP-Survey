export const AI_SESSION_PREFIX = 'ai_session_';
export const AI_UNDO_PREFIX = 'ai_undo_';
export const AI_ROUTE_PREFIX = 'ai_route_';
export const AI_PENDING_RUN_PREFIX = 'ai_pending_run_';
export const AI_SIDEBAR_OPEN_KEY = 'sp-ai-sidebar-open';
export const AI_SIDEBAR_WIDTH = 420;
export const PROJECT_SIDEBAR_WIDTH = 400;
export const AI_SIDEBAR_ID = 'admin-ai-sidebar';

export function isPlatformMode() {
  // OSS is always self-hosted. A user's own Supabase URL must not flip hosted-catalog / vault UI.
  return false;
}

export function routeKey(provider, model) {
  if (!provider || !model) return '';
  return `${provider}::${model}`;
}

export function parseRoute(value) {
  const [provider, model] = String(value || '').split('::');
  return { provider: provider || '', model: model || '' };
}

function firstEffort(model) {
  if (!model?.reasoningEfforts) return '';
  if (typeof model.reasoningEfforts !== 'object') return '';
  return Object.keys(model.reasoningEfforts)[0] || '';
}

function validEffort(model, ...candidates) {
  const allowed = model?.reasoningEfforts && typeof model.reasoningEfforts === 'object'
    ? Object.keys(model.reasoningEfforts)
    : [];
  if (!allowed.length) return '';
  return candidates.find((effort) => effort && allowed.includes(effort))
    || firstEffort(model);
}

export function sharedModelSuffix(language = 'en') {
  return language === 'zh' ? ' (免费)' : ' (Free)';
}

export function buildAssistantModelOptions(directory = [], { language = 'en' } = {}) {
  const options = [];
  const suffix = sharedModelSuffix(language);
  (directory || []).forEach((provider) => {
    if (!provider.configured || provider.authUnsupported) return;
    (provider.models || []).forEach((model) => {
      if (!model.id) return;
      options.push({
        value: routeKey(provider.id, model.id),
        provider: provider.id,
        model: model.id,
        label: `${provider.displayName || provider.id} / ${model.label || model.name || model.id}${model.shared && !provider.userConfigured ? suffix : ''}`,
        shared: Boolean(model.shared || (provider.shared && !provider.userConfigured)),
        reasoningEfforts: model.reasoningEfforts || false,
        defaultEffort: model.defaultEffort || '',
      });
    });
  });
  return options;
}

export function resolveAssistantRoute({
  directory,
  status,
  storedRoute = '',
  storedEffort = '',
  language = 'en',
} = {}) {
  const options = buildAssistantModelOptions(directory || status?.directory || [], { language });
  if (storedRoute && options.some((item) => item.value === storedRoute)) {
    const hit = options.find((item) => item.value === storedRoute);
    return {
      route: storedRoute,
      effort: validEffort(hit, storedEffort, hit?.defaultEffort),
      options,
    };
  }
  const route = status?.defaultRoute;
  if (route?.provider && route?.model) {
    const value = routeKey(route.provider, route.model);
    if (options.some((item) => item.value === value)) {
      const hit = options.find((item) => item.value === value);
      return {
        route: value,
        effort: validEffort(hit, storedEffort, route.reasoningEffort, hit?.defaultEffort),
        options,
      };
    }
  }
  const first = options[0];
  return {
    route: first?.value || '',
    effort: first?.defaultEffort || firstEffort(first) || '',
    options,
  };
}

export function readStoredRoute(storage, projectId) {
  if (!projectId || !storage) return { route: '', effort: '' };
  try {
    const raw = storage.getItem(`${AI_ROUTE_PREFIX}${projectId}`);
    if (!raw) return { route: '', effort: '' };
    const parsed = JSON.parse(raw);
    return { route: parsed.route || '', effort: parsed.effort || '' };
  } catch {
    return { route: '', effort: '' };
  }
}

export function writeStoredRoute(storage, projectId, route, effort) {
  if (!projectId || !storage) return;
  storage.setItem(`${AI_ROUTE_PREFIX}${projectId}`, JSON.stringify({
    route: route || '',
    effort: effort || '',
  }));
}

export function readSessionId(storage, projectId) {
  if (!projectId || !storage) return '';
  return storage.getItem(`${AI_SESSION_PREFIX}${projectId}`) || '';
}

export function writeSessionId(storage, projectId, sessionId) {
  if (!projectId || !storage || !sessionId) return;
  storage.setItem(`${AI_SESSION_PREFIX}${projectId}`, sessionId);
}

export function readPendingRun(storage, projectId) {
  if (!projectId || !storage) return null;
  try {
    const raw = storage.getItem(`${AI_PENDING_RUN_PREFIX}${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writePendingRun(storage, projectId, value = {}) {
  if (!projectId || !storage) return;
  storage.setItem(`${AI_PENDING_RUN_PREFIX}${projectId}`, JSON.stringify({
    status: value.status || 'running',
    startedAt: value.startedAt || Date.now(),
    sessionId: value.sessionId || '',
    ...(value.runId ? { runId: value.runId } : {}),
  }));
}

export function clearPendingRun(storage, projectId) {
  if (!projectId || !storage) return;
  storage.removeItem(`${AI_PENDING_RUN_PREFIX}${projectId}`);
}

export function latestRunStatus(events = []) {
  return [...events]
    .reverse()
    .find((event) => event?.type === 'run.status')
    ?.payload?.status || '';
}

export function shouldReplaceAssistantTranscript(current = [], incoming = []) {
  if (!Array.isArray(incoming) || incoming.length === 0) return false;
  if (!Array.isArray(current) || current.length === 0) return true;
  if (incoming.length >= current.length) return true;
  const currentUsers = current.filter((message) => message.role === 'user').map((message) => message.content);
  const incomingUsers = incoming.filter((message) => message.role === 'user').map((message) => message.content);
  return currentUsers.every((text) => incomingUsers.includes(text));
}

const DRAFT_WRITE_TOOLS = new Set([
  'survey_apply_operations',
  'survey_submit_generated_draft',
]);

export function isDraftWriteTool(name) {
  return DRAFT_WRITE_TOOLS.has(name);
}

export function hasAppliedSurveyChange(events = []) {
  return events.some((event) => (
    event?.type === 'tool.result'
    && isDraftWriteTool(event?.payload?.name)
    && event?.payload?.ok !== false
  ));
}

const OPERATIONS_OPTIONAL_TOOLS = new Set([
  'survey_capabilities',
  'survey_get_draft',
  'survey_validate',
  'survey_preview_urls',
  'survey_submit_generated_draft',
]);

export function shouldShowToolDiagnostics(name, diagnostics = {}) {
  if (!diagnostics || typeof diagnostics !== 'object') return false;
  if (diagnostics.code || diagnostics.parseError || diagnostics.rawArgsComplete === false) return true;
  if (OPERATIONS_OPTIONAL_TOOLS.has(name)) return false;
  return Boolean(diagnostics.receivedShape && diagnostics.receivedShape.operationsType
    && diagnostics.receivedShape.operationsType !== 'missing');
}

export function formatToolDiagnostics(diagnostics = {}) {
  if (!diagnostics || typeof diagnostics !== 'object') return '';
  const shape = diagnostics.receivedShape && typeof diagnostics.receivedShape === 'object'
    ? diagnostics.receivedShape
    : null;
  return [
    diagnostics.code && `code=${diagnostics.code}`,
    diagnostics.path && `path=${diagnostics.path}`,
    diagnostics.stopReason && `stopReason=${diagnostics.stopReason}`,
    diagnostics.rawArgsComplete !== undefined && diagnostics.rawArgsComplete !== null
      ? `rawArgsComplete=${diagnostics.rawArgsComplete}`
      : '',
    diagnostics.argumentOrigin && `argumentOrigin=${diagnostics.argumentOrigin}`,
    diagnostics.byteLength != null && `byteLength=${diagnostics.byteLength}`,
    diagnostics.parseError && `parseError=${diagnostics.parseError}`,
    shape?.rootType && `rootType=${shape.rootType}`,
    Array.isArray(shape?.keys) && `keys=${shape.keys.join(',')}`,
    shape?.operationsType && `operationsType=${shape.operationsType}`,
    shape?.operationsLength != null && `operationsLength=${shape.operationsLength}`,
    Array.isArray(shape?.ops) && `ops=${shape.ops.join(',')}`,
    shape?.surveyConfigType && `surveyConfigType=${shape.surveyConfigType}`,
    shape?.hasTopLevelSurveyConfig != null && `hasTopLevelSurveyConfig=${shape.hasTopLevelSurveyConfig}`,
    shape?.pageCount != null && `pageCount=${shape.pageCount}`,
    shape?.wrappedIn && `wrappedIn=${shape.wrappedIn}`,
  ].filter(Boolean).join('\n');
}

export function loadingStatusFromEvents(events = [], { runId, readOnly = false } = {}) {
  const scoped = runId
    ? events.filter((event) => (!event.run_id && !event.runId) || event.run_id === runId || event.runId === runId)
    : events;
  if (readOnly && scoped.some((event) => event?.type === 'run.stage' && event.payload?.stage === 'repair_config')) {
    return 'Current mode is read-only…';
  }
  const recent = [...scoped].reverse();
  const status = latestRunStatus(scoped);
  if (status === 'awaiting_approval' || recent.some((event) => event?.type === 'approval.ask')) {
    return 'Waiting for your approval…';
  }
  const activeCall = recent.find((event) => event?.type === 'tool.call' && !scoped.some((candidate) => (
    candidate?.type === 'tool.result'
    && candidate?.payload?.id
    && candidate.payload.id === event.payload?.id
  )));
  if (activeCall?.payload?.verification) return 'Verifying saved draft…';
  const stageEvent = recent.find((event) => event?.type === 'run.stage');
  if (stageEvent?.payload?.stage === 'repair_config') {
    return assistantStageLabel('repair_config', stageEvent.payload);
  }
  if (activeCall?.payload?.name) return `Using ${activeCall.payload.name}…`;
  if (recent.some((event) => event?.type === 'llm.retry')) return 'Retrying model request…';
  if (recent.some((event) => event?.type === 'context.compact')) return 'Compacting context and continuing…';
  const step = recent.find((event) => event?.type === 'step.start')?.payload?.step;
  if (Number.isFinite(step)) return `Working on step ${step + 1}…`;
  if (status === 'queued') return 'Queued…';
  if (status === 'running') return readOnly ? 'Looking up the current settings…' : 'Working on your request…';
  return 'Thinking…';
}

export function readUndoSnapshot(storage, projectId) {
  if (!projectId || !storage) return null;
  try {
    const raw = storage.getItem(`${AI_UNDO_PREFIX}${projectId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeUndoSnapshot(storage, projectId, config) {
  if (!projectId || !storage || !config) return;
  storage.setItem(`${AI_UNDO_PREFIX}${projectId}`, JSON.stringify(config));
}

export function clearUndoSnapshot(storage, projectId) {
  if (!projectId || !storage) return;
  storage.removeItem(`${AI_UNDO_PREFIX}${projectId}`);
}

export function undoBlockedByNewerEdits(undo, currentConfig) {
  if (!undo?.afterSignature) return false;
  return JSON.stringify(currentConfig) !== undo.afterSignature;
}

export function isStaleAssistantRequest(request, current) {
  return !request?.projectId
    || !current?.projectId
    || request.projectId !== current.projectId
    || request.generation !== current.generation;
}

export function credentialConfigured(status) {
  return Boolean(
    status?.openai?.configured
    || status?.assistantConfigured
    || (status?.configuredProviders || []).length
    || (status?.subsidizedRoutes || []).length
    || (status?.providers || []).some((row) => row.key_hint)
  );
}

export function sendBlockReason({
  hasProject,
  apiKeyValid,
  platformMode,
  routeUnavailable,
  openaiApiKey,
}) {
  if (!hasProject) return 'no-project';
  if (platformMode && !apiKeyValid) return 'no-key';
  if (!platformMode && !apiKeyValid && !openaiApiKey) return 'no-key';
  if (routeUnavailable) return 'no-model';
  return '';
}

export function readSidebarOpen(storage) {
  if (!storage) return false;
  return storage.getItem(AI_SIDEBAR_OPEN_KEY) === 'true';
}

export function writeSidebarOpen(storage, open) {
  if (!storage) return;
  storage.setItem(AI_SIDEBAR_OPEN_KEY, open ? 'true' : 'false');
}

export function workspaceChromeWidths({ projectOpen, aiOpen, isDesktop }) {
  return {
    left: projectOpen ? PROJECT_SIDEBAR_WIDTH : 0,
    right: isDesktop && aiOpen ? AI_SIDEBAR_WIDTH : 0,
  };
}

export function exclusiveSidebarOpen({ isDesktop, otherIsOpen }) {
  return {
    otherOpen: isDesktop ? otherIsOpen : false,
  };
}

export function collapseRepeatedToolErrors(tools = []) {
  const collapsed = [];
  for (const tool of tools) {
    const previous = collapsed[collapsed.length - 1];
    const sameError = tool?.status === 'error'
      && previous?.status === 'error'
      && previous.name === tool.name
      && (previous.code || '') === (tool.code || '');
    if (sameError) {
      previous.repeatCount = Number(previous.repeatCount || 1) + 1;
      previous.result = tool.result;
      previous.diagnostics = tool.diagnostics || previous.diagnostics;
      continue;
    }
    collapsed.push({ ...tool, repeatCount: 1 });
  }
  return collapsed;
}

const PROCESS_OPEN_PREFIX = 'ai_process_open_';

export function processTranscriptKey(message = {}) {
  return message.runId || message.metadata?.runId || message.id || '';
}

export function readProcessExpanded(storage, key) {
  if (!storage || !key) return null;
  const value = storage.getItem(`${PROCESS_OPEN_PREFIX}${key}`);
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

export function writeProcessExpanded(storage, key, open) {
  if (!storage || !key) return;
  storage.setItem(`${PROCESS_OPEN_PREFIX}${key}`, open ? '1' : '0');
}

export function processHeadline(tools = [], { running = false } = {}) {
  const collapsed = collapseRepeatedToolErrors(tools);
  const latest = [...collapsed].reverse().find((tool) => tool?.result && typeof tool.result === 'object');
  const pageCount = Number(latest?.result?.pageCount);
  const verified = latest?.result?.verified === true || latest?.verification === true;
  const saved = isDraftWriteTool(latest?.name) && latest?.status === 'done';
  if (Number.isFinite(pageCount) && pageCount > 0) {
    if (running) return `已完成 ${pageCount} 页，正在检查题目设置`;
    if (verified) return `已生成 ${pageCount} 页问卷，保存已核对`;
    if (saved) return `已生成 ${pageCount} 页问卷，已保存`;
    return `已生成 ${pageCount} 页`;
  }
  if (running) return '正在生成问卷';
  if (verified) return '保存已核对';
  if (saved) return '已保存';
  return collapsed.some((tool) => tool.status === 'error') ? '生成未完成' : '执行过程';
}

export function writeResultFromTools(tools = []) {
  return [...tools].reverse().find((tool) => (
    isDraftWriteTool(tool?.name) && tool.status === 'done' && tool.result
  )) || null;
}

function namedQuestions(config = {}) {
  const out = {};
  for (const page of config.pages || []) {
    for (const element of page.elements || []) {
      if (element?.name) out[element.name] = element;
    }
  }
  return out;
}

export function saveStatusFromRun(message = {}, writeResult = null) {
  const meta = message.metadata || {};
  const result = (writeResult?.result && typeof writeResult.result === 'object')
    ? writeResult.result
    : {};
  const persisted = meta.persisted === true || result.persisted === true;
  const verified = meta.verified === true || result.verified === true;
  const saveFailed = meta.saveFailed === true || result.persisted === false
    || writeResult?.status === 'error';
  const verifyFailed = meta.verifyFailed === true || (persisted && result.verified === false);
  if (saveFailed && !persisted) return 'save_failed';
  if (persisted && verified) return 'saved_verified';
  if (persisted && verifyFailed) return 'verify_incomplete';
  if (persisted) return 'saved';
  if (writeResult) return 'verify_incomplete';
  return 'verify_incomplete';
}

export function summarizeDraftDiff(before = {}, after = {}) {
  const changes = [];
  if ((before.title || '') !== (after.title || '')) {
    changes.push({ target: 'survey', field: 'title', from: before.title || '', to: after.title || '' });
  }
  const beforeTheme = JSON.stringify(before.theme || {});
  const afterTheme = JSON.stringify(after.theme || {});
  if (beforeTheme !== afterTheme) {
    changes.push({ target: 'survey', field: 'theme', from: before.theme || null, to: after.theme || null });
  }
  const beforeQs = namedQuestions(before);
  const afterQs = namedQuestions(after);
  const names = new Set([...Object.keys(beforeQs), ...Object.keys(afterQs)]);
  for (const name of names) {
    const prev = beforeQs[name];
    const next = afterQs[name];
    if (!prev && next) {
      changes.push({ target: name, field: 'added', to: next.type || next.title || name });
      continue;
    }
    if (prev && !next) {
      changes.push({ target: name, field: 'removed' });
      continue;
    }
    for (const field of ['title', 'type', 'isRequired', 'choices']) {
      const a = field === 'choices' ? JSON.stringify(prev[field] || []) : prev[field];
      const b = field === 'choices' ? JSON.stringify(next[field] || []) : next[field];
      if (a !== b) changes.push({ target: name, field, from: a, to: b });
    }
  }
  return changes;
}

export function assistantStageLabel(stage, {
  repairAttempt = 0,
  repairLimit = 2,
} = {}) {
  if (stage === 'read_requirements') return 'Reading requirements';
  if (stage === 'build_survey') return 'Building survey';
  if (stage === 'repair_config') {
    return `Repairing configuration (${Math.min(repairAttempt, repairLimit)}/${repairLimit})`;
  }
  if (stage === 'save') return 'Saving';
  if (stage === 'verify') return 'Verifying';
  return '';
}
