import {
  AI_SIDEBAR_WIDTH,
  PROJECT_SIDEBAR_WIDTH,
  buildAssistantModelOptions,
  clearPendingRun,
  credentialConfigured,
  exclusiveSidebarOpen,
  formatToolDiagnostics,
  shouldShowToolDiagnostics,
  hasAppliedSurveyChange,
  isStaleAssistantRequest,
  latestRunStatus,
  loadingStatusFromEvents,
  undoBlockedByNewerEdits,
  assistantStageLabel,
  collapseRepeatedToolErrors,
  shouldReplaceAssistantTranscript,
  parseRoute,
  readPendingRun,
  readSessionId,
  readStoredRoute,
  readUndoSnapshot,
  resolveAssistantRoute,
  routeKey,
  sendBlockReason,
  workspaceChromeWidths,
  writePendingRun,
  writeSessionId,
  writeStoredRoute,
  writeUndoSnapshot,
  processHeadline,
  readProcessExpanded,
  writeProcessExpanded,
  writeResultFromTools,
  saveStatusFromRun,
  summarizeDraftDiff,
} from './surveyAssistantUtils';

const directory = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    configured: true,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', reasoningEfforts: false },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    configured: true,
    models: [
      {
        id: 'reasoner',
        name: 'Reasoner',
        reasoningEfforts: { low: {}, high: {} },
        defaultEffort: 'high',
      },
    ],
  },
  {
    id: 'native',
    displayName: 'Native',
    configured: true,
    authUnsupported: true,
    models: [{ id: 'secret' }],
  },
];

describe('surveyAssistantUtils', () => {
  test('builds configured model options and skips native-auth providers', () => {
    expect(buildAssistantModelOptions(directory)).toEqual([
      {
        value: 'openai::gpt-4o',
        provider: 'openai',
        model: 'gpt-4o',
        label: 'OpenAI / GPT-4o',
        shared: false,
        reasoningEfforts: false,
        defaultEffort: '',
      },
      {
        value: 'deepseek::reasoner',
        provider: 'deepseek',
        model: 'reasoner',
        label: 'DeepSeek / Reasoner',
        shared: false,
        reasoningEfforts: { low: {}, high: {} },
        defaultEffort: 'high',
      },
    ]);
  });

  test('resolves stored route when still valid, otherwise defaultRoute', () => {
    expect(resolveAssistantRoute({
      directory,
      storedRoute: 'deepseek::reasoner',
      storedEffort: 'low',
    })).toMatchObject({ route: 'deepseek::reasoner', effort: 'low' });

    expect(resolveAssistantRoute({
      directory,
      storedRoute: 'deepseek::reasoner',
      storedEffort: 'medium',
    })).toMatchObject({ route: 'deepseek::reasoner', effort: 'high' });

    expect(resolveAssistantRoute({
      directory,
      storedRoute: 'gone::model',
      status: { defaultRoute: { provider: 'openai', model: 'gpt-4o', reasoningEffort: '' } },
    })).toMatchObject({ route: 'openai::gpt-4o' });
  });

  test('persists session, route, and undo snapshots per project', () => {
    const storage = new Map();
    const api = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    writeSessionId(api, 'p1', 'sess-1');
    writeStoredRoute(api, 'p1', 'openai::gpt-4o', 'low');
    writeUndoSnapshot(api, 'p1', { title: 'Before' });

    expect(readSessionId(api, 'p1')).toBe('sess-1');
    expect(readStoredRoute(api, 'p1')).toEqual({ route: 'openai::gpt-4o', effort: 'low' });
    expect(readUndoSnapshot(api, 'p1')).toEqual({ title: 'Before' });
    expect(readSessionId(api, 'p2')).toBe('');
    expect(readUndoSnapshot(api, 'p2')).toBeNull();
  });

  test('persists pending runs per project and reads the latest run status', () => {
    const storage = new Map();
    const api = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    writePendingRun(api, 'p1', { status: 'running', startedAt: 123, sessionId: 'sess-1' });
    expect(readPendingRun(api, 'p1')).toEqual({
      status: 'running',
      startedAt: 123,
      sessionId: 'sess-1',
    });
    expect(latestRunStatus([
      { type: 'run.status', payload: { status: 'running' } },
      { type: 'assistant.message', payload: { content: 'Done' } },
      { type: 'run.status', payload: { status: 'completed' } },
    ])).toBe('completed');
    expect(hasAppliedSurveyChange([
      { type: 'tool.result', payload: { name: 'survey_get_draft', ok: true } },
      { type: 'tool.result', payload: { name: 'survey_apply_operations', ok: true } },
    ])).toBe(true);
    expect(hasAppliedSurveyChange([
      { type: 'tool.result', payload: { name: 'survey_submit_generated_draft', ok: true } },
    ])).toBe(true);
    expect(shouldShowToolDiagnostics('survey_capabilities', {
      receivedShape: { operationsType: 'missing', rootType: 'object' },
    })).toBe(false);
    expect(shouldShowToolDiagnostics('survey_submit_generated_draft', {
      receivedShape: { operationsType: 'missing' },
    })).toBe(false);
    expect(shouldShowToolDiagnostics('survey_validate', {
      rawArgsComplete: false,
      receivedShape: { rootType: 'unparsed' },
    })).toBe(true);
    expect(formatToolDiagnostics({
      code: 'INVALID_TOOL_ARGUMENTS',
      path: 'arguments',
      stopReason: 'toolUse',
      rawArgsComplete: false,
      argumentOrigin: 'raw_stream',
      byteLength: 8,
      receivedShape: { rootType: 'unparsed', operationsType: 'missing', keys: [] },
    })).toContain('rawArgsComplete=false');
    clearPendingRun(api, 'p1');
    expect(readPendingRun(api, 'p1')).toBeNull();
  });

  test('derives visible run progress from lifecycle events', () => {
    expect(loadingStatusFromEvents([
      { type: 'run.status', payload: { status: 'running' } },
      { type: 'step.start', payload: { step: 1 } },
      { type: 'tool.call', payload: { id: 'call-1', name: 'survey_validate' } },
    ])).toBe('Using survey_validate…');
    expect(loadingStatusFromEvents([
      { type: 'run.status', payload: { status: 'awaiting_approval' } },
    ])).toBe('Waiting for your approval…');
    expect(loadingStatusFromEvents([
      { type: 'tool.call', payload: { id: 'verify', name: 'survey_get_draft', verification: true } },
    ])).toBe('Verifying saved draft…');
    expect(loadingStatusFromEvents([
      { type: 'run.status', payload: { status: 'running' }, runId: 'old' },
      { type: 'tool.call', payload: { id: 'call-old', name: 'survey_apply_operations' }, runId: 'old' },
      { type: 'run.status', payload: { status: 'running' }, runId: 'new' },
    ], { runId: 'new', readOnly: true })).toBe('Looking up the current settings…');
    expect(undoBlockedByNewerEdits(
      { afterSignature: JSON.stringify({ title: 'ai' }) },
      { title: 'manual' },
    )).toBe(true);
    expect(undoBlockedByNewerEdits(
      { afterSignature: JSON.stringify({ title: 'ai' }) },
      { title: 'ai' },
    )).toBe(false);
  });

  test('does not replace a longer local transcript with a partial snapshot', () => {
    const current = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '已保存' },
      { role: 'user', content: '重新生成' },
    ];
    expect(shouldReplaceAssistantTranscript(current, [
      { role: 'assistant', content: '', tools: [{ name: 'survey_apply_operations', status: 'running' }] },
    ])).toBe(false);
    expect(shouldReplaceAssistantTranscript(current, [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '已保存' },
      { role: 'user', content: '重新生成' },
      { role: 'assistant', content: '', tools: [{ name: 'survey_apply_operations', status: 'running' }] },
    ])).toBe(true);
  });

  test('isolates stale assistant requests', () => {
    expect(isStaleAssistantRequest(
      { projectId: 'a', generation: 1 },
      { projectId: 'a', generation: 1 },
    )).toBe(false);
    expect(isStaleAssistantRequest(
      { projectId: 'a', generation: 1 },
      { projectId: 'b', generation: 1 },
    )).toBe(true);
    expect(isStaleAssistantRequest(
      { projectId: 'a', generation: 1 },
      { projectId: 'a', generation: 2 },
    )).toBe(true);
  });

  test('blocks send without a project, key, or model', () => {
    expect(sendBlockReason({ hasProject: false, apiKeyValid: true, platformMode: true })).toBe('no-project');
    expect(sendBlockReason({ hasProject: true, apiKeyValid: false, platformMode: true })).toBe('no-key');
    expect(sendBlockReason({
      hasProject: true,
      apiKeyValid: true,
      platformMode: true,
      routeUnavailable: 'missing',
    })).toBe('no-model');
    expect(sendBlockReason({
      hasProject: true,
      apiKeyValid: true,
      platformMode: true,
      routeUnavailable: '',
    })).toBe('');
  });

  test('treats directory/providers as configured credentials', () => {
    expect(credentialConfigured({ configuredProviders: ['openai'] })).toBe(true);
    expect(credentialConfigured({ providers: [{ key_hint: 'sk-…abcd' }] })).toBe(true);
    expect(credentialConfigured({ subsidizedRoutes: [{ provider: 'qwen-dashscope', model: 'qwen-plus' }] })).toBe(true);
    expect(credentialConfigured({ assistantConfigured: true })).toBe(true);
    expect(credentialConfigured({})).toBe(false);
  });

  test('labels shared Assistant models as free without exposing a key', () => {
    const options = buildAssistantModelOptions([
      {
        id: 'qwen-dashscope',
        displayName: 'Qwen DashScope',
        configured: true,
        shared: true,
        userConfigured: false,
        models: [{ id: 'deepseek-v3.2', label: 'DeepSeek V3.2', shared: true }],
      },
    ]);
    expect(options[0].shared).toBe(true);
    expect(options[0].label).toContain('Free');
    expect(options[0].label).not.toContain('免费');
    expect(buildAssistantModelOptions([
      {
        id: 'qwen-dashscope',
        displayName: 'Qwen DashScope',
        configured: true,
        shared: true,
        userConfigured: false,
        models: [{ id: 'deepseek-v3.2', label: 'DeepSeek V3.2', shared: true }],
      },
    ], { language: 'zh' })[0].label).toContain('免费');
  });

  test('desktop workspace reserves both sidebars; mobile AI overlays', () => {
    expect(workspaceChromeWidths({ projectOpen: true, aiOpen: true, isDesktop: true })).toEqual({
      left: PROJECT_SIDEBAR_WIDTH,
      right: AI_SIDEBAR_WIDTH,
    });
    expect(workspaceChromeWidths({ projectOpen: true, aiOpen: true, isDesktop: false })).toEqual({
      left: PROJECT_SIDEBAR_WIDTH,
      right: 0,
    });
    expect(exclusiveSidebarOpen({ isDesktop: false, otherIsOpen: true })).toEqual({ otherOpen: false });
    expect(exclusiveSidebarOpen({ isDesktop: true, otherIsOpen: true })).toEqual({ otherOpen: true });
  });

  test('merges repeated tool errors and labels generate stages', () => {
    expect(collapseRepeatedToolErrors([
      { name: 'survey_apply_operations', status: 'error', code: 'GENERATE_CONTRACT', result: 'a' },
      { name: 'survey_apply_operations', status: 'error', code: 'GENERATE_CONTRACT', result: 'b' },
      { name: 'survey_get_draft', status: 'done' },
    ])).toEqual([
      {
        name: 'survey_apply_operations',
        status: 'error',
        code: 'GENERATE_CONTRACT',
        result: 'b',
        repeatCount: 2,
        diagnostics: undefined,
      },
      { name: 'survey_get_draft', status: 'done', repeatCount: 1 },
    ]);
    expect(assistantStageLabel('repair_config', { repairAttempt: 1, repairLimit: 2 }))
      .toBe('Repairing configuration (1/2)');
  });

  test('parses provider/model route keys', () => {
    expect(routeKey('openai', 'gpt-4o')).toBe('openai::gpt-4o');
    expect(parseRoute('openai::gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o' });
    expect(parseRoute('')).toEqual({ provider: '', model: '' });
  });

  test('headlines process from real tool pageCount and remembers expand state', () => {
    expect(processHeadline([
      { name: 'survey_submit_generated_draft', status: 'done', result: { pageCount: 6, verified: true } },
    ])).toBe('已生成 6 页问卷，保存已核对');
    expect(processHeadline([
      { name: 'survey_validate', status: 'done', result: { pageCount: 3 } },
    ], { running: true })).toBe('已完成 3 页，正在检查题目设置');
    expect(processHeadline([
      { name: 'survey_get_draft', status: 'running' },
    ], { running: true })).toBe('正在生成问卷');
    expect(writeResultFromTools([
      { name: 'survey_get_draft', status: 'done', result: { title: 'old' } },
      { name: 'survey_submit_generated_draft', status: 'done', result: { pageCount: 2 } },
    ])?.result).toEqual({ pageCount: 2 });
    const storage = {
      data: {},
      getItem(key) { return this.data[key] || null; },
      setItem(key, value) { this.data[key] = value; },
    };
    writeProcessExpanded(storage, 'run-1', true);
    expect(readProcessExpanded(storage, 'run-1')).toBe(true);
    writeProcessExpanded(storage, 'run-1', false);
    expect(readProcessExpanded(storage, 'run-1')).toBe(false);
    expect(saveStatusFromRun({ metadata: { persisted: true, verified: true } })).toBe('saved_verified');
    expect(saveStatusFromRun({ metadata: { persisted: true } })).toBe('saved');
    expect(saveStatusFromRun({ metadata: { saveFailed: true } }, { status: 'error' })).toBe('save_failed');
    expect(saveStatusFromRun({ metadata: { persisted: true, verifyFailed: true } })).toBe('verify_incomplete');
    expect(summarizeDraftDiff(
      { title: 'A', pages: [{ elements: [{ name: 'q1', title: 'Old', type: 'rating' }] }] },
      { title: 'B', pages: [{ elements: [{ name: 'q1', title: 'New', type: 'rating', isRequired: true }] }] },
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'survey', field: 'title', to: 'B' }),
      expect.objectContaining({ target: 'q1', field: 'title', to: 'New' }),
      expect.objectContaining({ target: 'q1', field: 'isRequired', to: true }),
    ]));
  });
});
