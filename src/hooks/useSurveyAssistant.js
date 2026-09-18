import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getConversationHistory } from '../lib/conversationHistory';
import { getWorkingMemory } from '../lib/workingMemory';
import { getSessionLearning } from '../lib/sessionLearning';
import { sendChatMessage, validateChatApiKey, triggerMultiAgentReviewStream } from '../lib/chatApi';
import { postProcessAiConfig } from '../lib/designProtocol';
import { runSurveyQualityChecks } from '../lib/surveyQualityChecks';
import {
  answerAiRunApproval,
  archiveAiSession,
  cancelAiRun,
  discardAiInbox,
  listAiInbox,
  listAiRunApprovals,
  steerAiSession,
} from '../lib/agentApi';
import { loadSurveyConfigForProject } from '../lib/projectManager';
import {
  buildAssistantModelOptions,
  clearPendingRun,
  clearUndoSnapshot,
  credentialConfigured,
  hasAppliedSurveyChange,
  isPlatformMode as detectPlatformMode,
  isStaleAssistantRequest,
  latestRunStatus,
  loadingStatusFromEvents,
  parseRoute,
  readPendingRun,
  readSessionId,
  readStoredRoute,
  shouldReplaceAssistantTranscript,
  readUndoSnapshot,
  resolveAssistantRoute,
  sendBlockReason,
  writePendingRun,
  writeSessionId,
  writeStoredRoute,
  writeUndoSnapshot,
  undoBlockedByNewerEdits,
  summarizeDraftDiff,
} from './surveyAssistantUtils';
import { classifyUserIntent, initialLoadingStatus, shouldPrepareWrite } from './taskIntent';
import { RegionContext } from '../contexts/RegionContext';

function loadProjectFlag(projectId, key, fallback) {
  if (!projectId || typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(`${key}_${projectId}`);
  if (stored === null) return fallback;
  return stored === 'true';
}

function loadProjectString(projectId, key, fallback) {
  if (!projectId || typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(`${key}_${projectId}`) || fallback;
}

function loadProjectNumber(projectId, key, fallback) {
  if (!projectId || typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(`${key}_${projectId}`);
  return stored ? parseInt(stored, 10) : fallback;
}

const ASSISTANT_MODES = new Set(['agent', 'generate', 'adjust', 'question']);

function normalizeAssistantMode(value) {
  return ASSISTANT_MODES.has(value) ? value : 'agent';
}

export default function useSurveyAssistant({
  currentProject,
  surveyConfig,
  onSurveyConfigChange,
  enabled = true,
  editorSelection = null,
  hasUnsavedChanges = false,
  lastSavedConfig = null,
  onPrepareWrite = null,
} = {}) {
  const platformMode = detectPlatformMode();
  const harnessMode = true;
  const language = useContext(RegionContext)?.language || 'en';
  const projectId = currentProject?.id || null;

  const [openaiApiKey, setOpenaiApiKey] = useState(() => (
    platformMode ? '' : (typeof window !== 'undefined' ? window.localStorage.getItem('openaiApiKey') || '' : '')
  ));
  const [apiKeyValid, setApiKeyValid] = useState(() => (
    platformMode ? false : (typeof window !== 'undefined' && window.localStorage.getItem('apiKeyValid') === 'true')
  ));
  const [credentialHint, setCredentialHint] = useState('');
  const [assistantDirectory, setAssistantDirectory] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [assistantMode, setAssistantMode] = useState(() => normalizeAssistantMode(
    loadProjectString(projectId, 'assistantMode', 'agent'),
  ));
  const [aiSessionId, setAiSessionId] = useState(() => readSessionId(
    typeof window !== 'undefined' ? window.sessionStorage : null,
    projectId,
  ));
  const [activeRunId, setActiveRunId] = useState(() => (
    readPendingRun(typeof window !== 'undefined' ? window.sessionStorage : null, projectId)?.runId || ''
  ));
  const [pendingApproval, setPendingApproval] = useState(null);
  const [userMessage, setUserMessage] = useState('');
  const [steerTarget, setSteerTarget] = useState('next-step');
  const [writeConflict, setWriteConflict] = useState(null);
  const [inboxItems, setInboxItems] = useState([]);
  const [runDiffs, setRunDiffs] = useState({});
  const [aiUndoAvailable, setAiUndoAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [conversationMessages, setConversationMessages] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [contextEnabled, setContextEnabled] = useState(() => loadProjectFlag(projectId, 'contextEnabled', true));
  const [multiAgentReviewEnabled, setMultiAgentReviewEnabled] = useState(() => (
    loadProjectFlag(projectId, 'multiAgentReviewEnabled', false)
  ));
  const [reviewMode, setReviewMode] = useState(() => loadProjectString(projectId, 'reviewMode', '1v1'));
  const [maxReviewRounds, setMaxReviewRounds] = useState(() => loadProjectNumber(projectId, 'maxReviewRounds', 3));
  const [customPrompts, setCustomPrompts] = useState(null);

  const conversationHistoryRef = useRef(null);
  const workingMemoryRef = useRef(null);
  const sessionLearningRef = useRef(null);
  const chatEndRef = useRef(null);
  const aiUndoSnapshotRef = useRef(null);
  const isLoadingProjectSettings = useRef(false);
  const lastStatusRef = useRef(null);
  const projectIdRef = useRef(projectId);
  const generationRef = useRef(0);
  const surveyConfigRef = useRef(surveyConfig);
  const onChangeRef = useRef(onSurveyConfigChange);
  const enabledRef = useRef(enabled);

  const handleAssistantModeChange = useCallback((value) => {
    const nextMode = normalizeAssistantMode(value);
    setAssistantMode(nextMode);
    if (typeof window !== 'undefined' && projectIdRef.current) {
      window.localStorage.setItem(`assistantMode_${projectIdRef.current}`, nextMode);
    }
  }, []);

  if (projectIdRef.current !== projectId || enabledRef.current !== enabled) {
    if (projectIdRef.current !== projectId || !enabled) {
      generationRef.current += 1;
    }
    projectIdRef.current = projectId;
    enabledRef.current = enabled;
  }

  useEffect(() => {
    surveyConfigRef.current = surveyConfig;
  }, [surveyConfig]);

  useEffect(() => {
    onChangeRef.current = onSurveyConfigChange;
  }, [onSurveyConfigChange]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const applyResolvedRoute = useCallback((status, nextProjectId) => {
    const stored = readStoredRoute(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      nextProjectId,
    );
    const resolved = resolveAssistantRoute({
      directory: status?.directory || lastStatusRef.current?.directory,
      status: status || lastStatusRef.current,
      storedRoute: stored.route,
      storedEffort: stored.effort,
      language,
    });
    if (status?.directory) setAssistantDirectory(status.directory);
    setSelectedRoute(resolved.route);
    setSelectedEffort(resolved.effort);
    return resolved;
  }, [language]);

  const applyCredentialStatus = useCallback((status) => {
    if (!status) return;
    lastStatusRef.current = status;
    const configured = credentialConfigured(status);
    if (configured) {
      setApiKeyValid(true);
      setCredentialHint(status.openai?.hint || status.defaultRoute?.provider || '');
      setOpenaiApiKey('');
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('openaiApiKey');
        window.localStorage.removeItem('apiKeyValid');
      }
    } else {
      setApiKeyValid(false);
      setCredentialHint('');
    }
    applyResolvedRoute(status, projectIdRef.current);
  }, [applyResolvedRoute]);

  useEffect(() => {
    if (platformMode || !enabled) return undefined;
    if (openaiApiKey && typeof window !== 'undefined') {
      window.localStorage.setItem('openaiApiKey', openaiApiKey);
    }
    return undefined;
  }, [openaiApiKey, platformMode, enabled]);

  useEffect(() => {
    if (platformMode || !enabled) return undefined;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('apiKeyValid', apiKeyValid.toString());
    }
    return undefined;
  }, [apiKeyValid, platformMode, enabled]);

  useEffect(() => {
    if (!enabled || !harnessMode) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCredentialStatus } = await import('../lib/agentApi');
        const status = await getCredentialStatus();
        if (cancelled || !enabledRef.current || !status) return;
        applyCredentialStatus(status);
      } catch (err) {
        console.warn('Credential status check failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, harnessMode, projectId, applyCredentialStatus]);

  useEffect(() => {
    setIsLoading(false);
    setLoadingStatus('');
    setUserMessage('');

    if (!enabled) {
      setAiSessionId('');
      aiUndoSnapshotRef.current = null;
      setAiUndoAvailable(false);
      setSelectedRoute('');
      setSelectedEffort('');
      return;
    }

    const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
    setAiSessionId(readSessionId(storage, projectId));
    setActiveRunId(readPendingRun(storage, projectId)?.runId || '');
    const undo = readUndoSnapshot(storage, projectId);
    aiUndoSnapshotRef.current = undo;
    setAiUndoAvailable(Boolean(undo));
    applyResolvedRoute(lastStatusRef.current, projectId);
  }, [enabled, projectId, applyResolvedRoute]);

  useEffect(() => {
    if (!enabled || !harnessMode || !projectId || typeof window === 'undefined') return undefined;
    const storage = window.sessionStorage;
    const pending = readPendingRun(storage, projectId);

    let cancelled = false;
    let timer = null;
    let recoveringRun = pending?.status === 'running' || pending?.status === 'queued';
    const startedAt = Number(pending?.startedAt) || Date.now();
    const maxWaitMs = 20 * 60 * 1000;
    if (pending?.status === 'running' || pending?.status === 'queued') {
      setIsLoading(true);
      setLoadingStatus(pending?.status === 'queued' ? 'Queued…' : 'Continuing survey generation…');
    }

    const check = async () => {
      try {
        const { getAiSession, listAiSessions } = await import('../lib/agentApi');
        const storedSessionId = readSessionId(storage, projectId);
        let sessionId = pending?.sessionId || storedSessionId;
        if (!sessionId) {
          const listed = await listAiSessions(projectId);
          sessionId = listed?.sessions?.[0]?.id || '';
        }
        if (!sessionId) {
          if (pending?.status !== 'running') {
            if (pending) {
              clearPendingRun(storage, projectId);
              setIsLoading(false);
              setLoadingStatus('');
            }
            return;
          }
          if (!cancelled && Date.now() - startedAt < maxWaitMs) {
            timer = setTimeout(check, 1500);
          }
          return;
        }

        const detail = await getAiSession(sessionId);
        if (cancelled) return;
        if (detail?.assistantMode) {
          handleAssistantModeChange(detail.assistantMode);
        }
        if (sessionId !== storedSessionId) {
          writeSessionId(storage, projectId, sessionId);
          setAiSessionId(sessionId);
        }
        if (
          Array.isArray(detail?.messages)
          && shouldReplaceAssistantTranscript(conversationHistoryRef.current?.getAllMessages?.() || [], detail.messages)
        ) {
          const restored = conversationHistoryRef.current?.replaceMessages
            ? conversationHistoryRef.current.replaceMessages(detail.messages)
            : detail.messages;
          setConversationMessages(restored);
        }
        const runEvents = pending?.runId
          ? (detail?.events || []).filter((event) => !event.run_id || event.run_id === pending.runId)
          : detail?.events;
        const runRecord = pending?.runId
          ? detail?.runs?.find?.((run) => run.id === pending.runId)
          : detail?.run;
        const status = runRecord?.status || latestRunStatus(runEvents);
        if (status === 'awaiting_approval' && Date.now() - startedAt < maxWaitMs) {
          recoveringRun = true;
          const approvalResult = await listAiRunApprovals(runRecord?.id || pending?.runId);
          if (cancelled) return;
          setPendingApproval(approvalResult?.approvals?.[0] || null);
          writePendingRun(storage, projectId, {
            status: 'running',
            startedAt,
            sessionId,
            runId: runRecord?.id || pending?.runId,
          });
          setIsLoading(true);
          setLoadingStatus('Waiting for your approval…');
          timer = setTimeout(check, 1500);
          return;
        }
        if ((status === 'queued' || status === 'running' || (!status && (pending?.status === 'running' || pending?.status === 'queued')))
          && Date.now() - startedAt < maxWaitMs) {
          recoveringRun = true;
          writePendingRun(storage, projectId, {
            status: 'running',
            startedAt,
            sessionId,
            runId: pending?.runId,
          });
          setIsLoading(true);
          const live = loadingStatusFromEvents(runEvents);
          setLoadingStatus(
            live && !/Working on your request|Looking up the current settings|Thinking/.test(live)
              ? live
              : 'Continuing survey generation…',
          );
          timer = setTimeout(check, 1500);
          return;
        }
        if ((status === 'queued' || status === 'running') && pending?.runId) {
          await cancelAiRun(pending.runId).catch(() => null);
        }
        if (pending && status === 'completed' && hasAppliedSurveyChange(runEvents)) {
          window.dispatchEvent(new CustomEvent('sp-agent-run-complete', {
            detail: { projectId, sessionId, runId: pending?.runId },
          }));
        }
        clearPendingRun(storage, projectId);
        if (pending?.runId) setActiveRunId('');
        if (recoveringRun) {
          setIsLoading(false);
          setLoadingStatus('');
        }
      } catch (error) {
        if (!cancelled && (pending || recoveringRun) && Date.now() - startedAt < maxWaitMs) {
          timer = setTimeout(check, 2000);
        } else if (!cancelled && (pending || recoveringRun)) {
          clearPendingRun(storage, projectId);
          setIsLoading(false);
          setLoadingStatus('');
        }
      }
    };

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, harnessMode, projectId, handleAssistantModeChange]);

  useEffect(() => {
    if (!enabled || !projectId) return undefined;
    isLoadingProjectSettings.current = true;
    setContextEnabled(loadProjectFlag(projectId, 'contextEnabled', true));
    setMultiAgentReviewEnabled(loadProjectFlag(projectId, 'multiAgentReviewEnabled', false));
    setReviewMode(loadProjectString(projectId, 'reviewMode', '1v1'));
    setMaxReviewRounds(loadProjectNumber(projectId, 'maxReviewRounds', 3));
    setAssistantMode(normalizeAssistantMode(loadProjectString(projectId, 'assistantMode', 'agent')));
    const timer = setTimeout(() => {
      isLoadingProjectSettings.current = false;
    }, 100);
    return () => clearTimeout(timer);
  }, [enabled, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`contextEnabled_${projectId}`, contextEnabled.toString());
  }, [enabled, contextEnabled, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`multiAgentReviewEnabled_${projectId}`, multiAgentReviewEnabled.toString());
  }, [enabled, multiAgentReviewEnabled, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`reviewMode_${projectId}`, reviewMode);
  }, [enabled, reviewMode, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`maxReviewRounds_${projectId}`, maxReviewRounds.toString());
  }, [enabled, maxReviewRounds, projectId]);

  useEffect(() => {
    if (!enabled || !projectId || isLoadingProjectSettings.current) return;
    window.localStorage.setItem(`assistantMode_${projectId}`, assistantMode);
  }, [assistantMode, enabled, projectId]);

  useEffect(() => {
    if (!enabled || !projectId) {
      conversationHistoryRef.current = null;
      workingMemoryRef.current = null;
      sessionLearningRef.current = null;
      setConversationMessages([]);
      setRecommendations([]);
      return undefined;
    }
    conversationHistoryRef.current = getConversationHistory(projectId);
    setConversationMessages(conversationHistoryRef.current.getAllMessages());
    if (!contextEnabled) {
      workingMemoryRef.current = null;
      sessionLearningRef.current = null;
      setRecommendations([]);
      return undefined;
    }
    workingMemoryRef.current = getWorkingMemory(projectId);
    sessionLearningRef.current = getSessionLearning();
    setRecommendations(sessionLearningRef.current.getRecommendations(currentProject?.category || 'general'));
    return undefined;
  }, [enabled, projectId, contextEnabled, currentProject?.category]);

  const assistantModelOptions = useMemo(
    () => buildAssistantModelOptions(assistantDirectory, { language }),
    [assistantDirectory, language],
  );
  const selectedModelOption = assistantModelOptions.find((route) => route.value === selectedRoute);
  const assistantEffortOptions = selectedModelOption?.reasoningEfforts
    ? Object.keys(selectedModelOption.reasoningEfforts)
    : [];
  const routeUnavailable = platformMode && apiKeyValid && (!selectedRoute || !selectedModelOption)
    ? 'Select a configured model before sending. The previous provider may have been removed.'
    : '';
  const blockReason = sendBlockReason({
    hasProject: Boolean(projectId),
    apiKeyValid,
    platformMode,
    routeUnavailable,
    openaiApiKey,
  });

  const persistAssistantDefault = useCallback(async (provider, model, effort) => {
    try {
      const { saveAiSettings } = await import('../lib/agentApi');
      await saveAiSettings({
        default_provider: provider,
        assistant_provider: provider,
        assistant_model: model,
        assistant_reasoning_effort: effort || null,
      });
    } catch {
      // Session selection stays; default save is best-effort.
    }
  }, []);

  const handleAssistantRouteChange = useCallback((value) => {
    setSelectedRoute(value);
    const hit = assistantModelOptions.find((route) => route.value === value);
    const effort = hit?.defaultEffort
      || (hit?.reasoningEfforts ? Object.keys(hit.reasoningEfforts)[0] : '');
    setSelectedEffort(effort);
    writeStoredRoute(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      projectIdRef.current,
      value,
      effort,
    );
    if (hit) persistAssistantDefault(hit.provider, hit.model, effort);
  }, [assistantModelOptions, persistAssistantDefault]);

  const handleAssistantEffortChange = useCallback((effort) => {
    setSelectedEffort(effort);
    const { provider, model } = parseRoute(selectedRoute);
    writeStoredRoute(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      projectIdRef.current,
      selectedRoute,
      effort,
    );
    if (provider && model) persistAssistantDefault(provider, model, effort);
  }, [persistAssistantDefault, selectedRoute]);

  const refreshConversation = useCallback(() => {
    if (conversationHistoryRef.current) {
      setConversationMessages(conversationHistoryRef.current.getAllMessages());
    }
  }, []);

  const handleValidateApiKey = useCallback(async () => {
    setIsLoading(true);
    const result = await validateChatApiKey(openaiApiKey);
    setIsLoading(false);
    if (result.success) {
      setApiKeyValid(true);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('openai_api_key', openaiApiKey);
        window.localStorage.setItem('openaiApiKey', openaiApiKey);
        window.localStorage.setItem('apiKeyValid', 'true');
      }
      try {
        const { getCredentialStatus } = await import('../lib/agentApi');
        applyCredentialStatus(await getCredentialStatus());
      } catch {
        // Directory refresh is optional after a local key validate.
      }
      conversationHistoryRef.current?.addMessage('assistant',
        '✅ API key validated! I\'m ready to help you create and modify surveys. Just type what you need!',
        { actionType: 'system' },
      );
    } else {
      setApiKeyValid(false);
      conversationHistoryRef.current?.addMessage('assistant',
        '❌ Invalid API key. Please check and try again in settings.',
        { actionType: 'system', error: true },
      );
    }
    refreshConversation();
  }, [openaiApiKey, refreshConversation, applyCredentialStatus]);

  const applySurveyConfig = useCallback((nextConfig, request, metadata = {}) => {
    if (isStaleAssistantRequest(request, { projectId: projectIdRef.current, generation: generationRef.current })) {
      return false;
    }
    if (Object.keys(metadata).length) onChangeRef.current?.(nextConfig, metadata);
    else onChangeRef.current?.(nextConfig);
    return true;
  }, []);

  const handleRevertAiChange = useCallback(async (targetRunId = null) => {
    if (!aiUndoSnapshotRef.current) return;
    const undo = aiUndoSnapshotRef.current;
    if (targetRunId && undo.runId && undo.runId !== targetRunId) {
      conversationHistoryRef.current?.addMessage('assistant',
        '⚠️ 这张结果卡属于另一项任务，不能撤销当前稿。',
        { actionType: 'system', error: true },
      );
      refreshConversation();
      return;
    }
    const before = undo.before || undo;
    if (undoBlockedByNewerEdits(undo, postProcessAiConfig(surveyConfigRef.current || {}))) {
      conversationHistoryRef.current?.addMessage('assistant',
        '⚠️ Cannot revert the last AI change because the editor has newer edits.',
        { actionType: 'system', error: true },
      );
      refreshConversation();
      return;
    }
    const request = { projectId: projectIdRef.current, generation: generationRef.current };
    const restored = JSON.parse(JSON.stringify(before));
    let persistedRestored = false;
    if (undo.persisted && typeof onPrepareWrite === 'function') {
      const saved = await onPrepareWrite({
        surveyConfig: restored,
        expectedDraftUpdatedAt: undo.draftUpdatedAt,
      });
      if (saved?.ok === false) {
        conversationHistoryRef.current?.addMessage('assistant',
          saved.message || '⚠️ 撤销未能写回已保存草稿。',
          { actionType: 'system', error: true },
        );
        refreshConversation();
        return;
      }
      const verified = await loadSurveyConfigForProject(projectIdRef.current).catch(() => null);
      if (!verified || undoBlockedByNewerEdits(
        { afterSignature: JSON.stringify(postProcessAiConfig(restored)) },
        postProcessAiConfig(verified),
      )) {
        conversationHistoryRef.current?.addMessage('assistant',
          '⚠️ 撤销后回读草稿与目标配置不一致，未标记为已保存恢复。',
          { actionType: 'system', error: true },
        );
        refreshConversation();
        return;
      }
      persistedRestored = true;
      applySurveyConfig(restored, request, {
        persisted: true,
        draftUpdatedAt: saved?.draftUpdatedAt || undo.draftUpdatedAt,
      });
    } else {
      applySurveyConfig(restored, request);
    }
    aiUndoSnapshotRef.current = null;
    setAiUndoAvailable(false);
    clearUndoSnapshot(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      projectIdRef.current,
    );
    conversationHistoryRef.current?.addMessage('assistant',
      persistedRestored ? '已保存恢复' : '仅恢复到编辑器',
      { actionType: 'system' },
    );
    refreshConversation();
  }, [applySurveyConfig, onPrepareWrite, refreshConversation]);

  const handleClearHistory = useCallback(() => {
    if (harnessMode && aiSessionId) {
      archiveAiSession(aiSessionId).catch(() => null);
      writeSessionId(
        typeof window !== 'undefined' ? window.sessionStorage : null,
        projectIdRef.current,
        '',
      );
      setAiSessionId('');
    }
    conversationHistoryRef.current?.clear();
    setConversationMessages([]);
  }, [aiSessionId, harnessMode]);

  const handleDownloadHistory = useCallback(() => {
    const data = conversationHistoryRef.current?.export();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${projectIdRef.current || 'project'}_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleSendMessage = useCallback(async (override = {}) => {
    const outgoing = String(override.message != null ? override.message : userMessage).trim();
    const sendMode = override.assistantMode || assistantMode;
    if (!outgoing) return;
    const request = {
      projectId: projectIdRef.current,
      generation: generationRef.current,
    };
    if (!request.projectId) return;

    const { provider: routeProvider, model: routeModel } = parseRoute(selectedRoute);
    const selectedProvider = assistantDirectory.find((item) => item.id === routeProvider);
    if (platformMode && (!routeProvider || !routeModel || !selectedProvider?.configured)) {
      conversationHistoryRef.current?.addMessage('assistant',
        '⚠️ Select a configured model before sending. The previous provider may have been removed.',
        { actionType: 'system', error: true },
      );
      refreshConversation();
      return;
    }
    if (!apiKeyValid && !(openaiApiKey && !platformMode)) {
      conversationHistoryRef.current?.addMessage('assistant',
        platformMode
          ? '⚠️ Store an OpenAI / OpenRouter key under AI & Integrations first (toolbar AI button).'
          : '⚠️ Please configure and validate your API key in settings first.',
        { actionType: 'system', error: true },
      );
      refreshConversation();
      return;
    }

    const intent = classifyUserIntent(outgoing, sendMode);
    const editorDirty = Boolean(hasUnsavedChanges || editorSelection?.dirty || editorSelection?.pageDirty);
    if (
      editorDirty
      && shouldPrepareWrite({ assistantMode: sendMode, message: outgoing })
      && !(override.skipConflict && override.workingCopyCommitted)
    ) {
      setWriteConflict({ message: outgoing, assistantMode: sendMode });
      return;
    }

    if (
      shouldPrepareWrite({ assistantMode: sendMode, message: outgoing })
      && typeof onPrepareWrite === 'function'
      && !override.workingCopyCommitted
    ) {
      const prepared = await onPrepareWrite();
      if (prepared && prepared.ok === false) {
        conversationHistoryRef.current?.addMessage('assistant',
          prepared.message || '⚠️ Save or reconcile the editor draft before asking the Assistant to edit.',
          { actionType: 'system', error: true },
        );
        refreshConversation();
        return;
      }
    }

    if (override.assistantMode) handleAssistantModeChange(sendMode);

    conversationHistoryRef.current?.addMessage('user', outgoing, {
      actionType: 'chat',
      timestamp: new Date().toISOString(),
    });
    refreshConversation();

    const currentUserMessage = outgoing;
    if (intent.write) {
      const undo = {
        runId: null,
        before: JSON.parse(JSON.stringify(lastSavedConfig || surveyConfigRef.current || {})),
        afterSignature: null,
        persisted: false,
        draftUpdatedAt: currentProject?.draftUpdatedAt || null,
      };
      aiUndoSnapshotRef.current = undo;
      writeUndoSnapshot(
        typeof window !== 'undefined' ? window.sessionStorage : null,
        request.projectId,
        undo,
      );
    }
    const pendingStorage = typeof window !== 'undefined' ? window.sessionStorage : null;
    const pendingStartedAt = Date.now();
    writePendingRun(pendingStorage, request.projectId, {
      status: 'running',
      startedAt: pendingStartedAt,
      sessionId: aiSessionId || '',
    });
    setUserMessage('');
    setIsLoading(true);
    setLoadingStatus(initialLoadingStatus(sendMode, intent));

    const stillCurrent = () => !isStaleAssistantRequest(request, {
      projectId: projectIdRef.current,
      generation: generationRef.current,
    });

    let completedResult = null;
    try {
      const apiHistory = conversationHistoryRef.current?.getFormattedForOpenAI(10) || [];
      let enrichedHistory = apiHistory;
      if (contextEnabled && workingMemoryRef.current && sessionLearningRef.current) {
        enrichedHistory = [
          { role: 'system', content: sessionLearningRef.current.getContextForAI(currentProject?.category) },
          { role: 'system', content: workingMemoryRef.current.getContextForAI() },
          ...apiHistory,
        ];
      }

      const researchContext = request.projectId
        ? JSON.parse(window.localStorage.getItem(`researchContext_${request.projectId}`) || '{}')
        : {};

      const result = completedResult = await sendChatMessage(
        currentUserMessage,
        surveyConfigRef.current,
        enrichedHistory,
        openaiApiKey,
        platformMode ? false : multiAgentReviewEnabled,
        reviewMode,
        customPrompts,
        researchContext,
        {
          projectId: request.projectId,
          sessionId: aiSessionId || null,
          provider: routeProvider || null,
          model: routeModel || null,
          reasoningEffort: selectedEffort || null,
          assistantMode: sendMode,
          editorContext: {
            ...(editorSelection || {}),
            hasUnsavedChanges: Boolean(hasUnsavedChanges || editorSelection?.dirty),
            workingCopy: editorSelection?.workingCopy || null,
            baseline: editorSelection?.baseline || null,
            draftUpdatedAt: currentProject?.draftUpdatedAt || null,
            projectId: request.projectId,
          },
          onStarted: (started) => {
            writeSessionId(pendingStorage, request.projectId, started.sessionId);
            writePendingRun(pendingStorage, request.projectId, {
              status: 'running',
              startedAt: pendingStartedAt,
              sessionId: started.sessionId,
              runId: started.runId,
            });
            if (stillCurrent()) setAiSessionId(started.sessionId);
            if (stillCurrent()) setActiveRunId(started.runId);
          },
          onSnapshot: (snapshot) => {
            if (!stillCurrent()) return;
            if (snapshot?.currentRunId) setActiveRunId(snapshot.currentRunId);
            setLoadingStatus(loadingStatusFromEvents(snapshot?.events || [], {
              runId: snapshot?.currentRunId || activeRunId,
              readOnly: !intent.write,
            }));
            if (
              Array.isArray(snapshot?.messages)
              && shouldReplaceAssistantTranscript(
                conversationHistoryRef.current?.getAllMessages?.() || [],
                snapshot.messages,
              )
            ) {
              const restored = conversationHistoryRef.current?.replaceMessages
                ? conversationHistoryRef.current.replaceMessages(snapshot.messages)
                : snapshot.messages;
              setConversationMessages(restored);
            }
            const run = snapshot?.run;
            if (run?.status === 'awaiting_approval') {
              listAiRunApprovals(run.id).then((result) => {
                if (stillCurrent()) setPendingApproval(result?.approvals?.[0] || null);
              });
            } else {
              setPendingApproval(null);
            }
          },
        },
      );

      if (result.sessionId) {
        writeSessionId(
          typeof window !== 'undefined' ? window.sessionStorage : null,
          request.projectId,
          result.sessionId,
        );
      }
      if (!stillCurrent()) {
        writePendingRun(pendingStorage, request.projectId, {
          status: result.success ? 'completed' : 'failed',
          startedAt: pendingStartedAt,
          sessionId: result.sessionId || aiSessionId || '',
          runId: result.runId || activeRunId || undefined,
        });
        return;
      }
      clearPendingRun(pendingStorage, request.projectId);
      setActiveRunId('');
      if (result.sessionId) setAiSessionId(result.sessionId);

      if (result.intent === 'generate') {
        setLoadingStatus('Generating survey...');
      } else if (result.intent === 'adjust') {
        setLoadingStatus('Adjusting survey...');
      } else {
        setLoadingStatus('Processing...');
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!stillCurrent()) return;

      setIsLoading(false);
      setLoadingStatus('');

      if (result.success) {
        const restoredServerTranscript = harnessMode
          && Array.isArray(result.messages)
          && result.messages.length > 0;
        if (restoredServerTranscript && shouldReplaceAssistantTranscript(
          conversationHistoryRef.current?.getAllMessages?.() || [],
          result.messages,
        )) {
          const restored = conversationHistoryRef.current?.replaceMessages
            ? conversationHistoryRef.current.replaceMessages(result.messages)
            : result.messages;
          setConversationMessages(restored);
        }
        if (!restoredServerTranscript && result.chainOfThoughts && conversationHistoryRef.current) {
          const step1Key = result.chainOfThoughts.step1_research || result.chainOfThoughts.step1_understanding;
          if (step1Key) {
            conversationHistoryRef.current.addMessage('assistant',
              `**🧠 Step 1: ${result.intent === 'generate' ? 'Research Analysis' : 'Understanding Adjustment Goal'}**\n\n${step1Key}`,
              { type: 'chain-of-thoughts', step: 1, intent: result.intent },
            );
          }
          const step2Key = result.chainOfThoughts.step2_structure || result.chainOfThoughts.step2_planning;
          if (step2Key) {
            conversationHistoryRef.current.addMessage('assistant',
              `**📐 Step 2: ${result.intent === 'generate' ? 'Survey Structure Planning' : 'Adjustment Planning'}**\n\n${step2Key}`,
              { type: 'chain-of-thoughts', step: 2, intent: result.intent },
            );
          }
          const step3Key = result.chainOfThoughts.step3_generation || result.chainOfThoughts.step3_execution;
          if (step3Key) {
            conversationHistoryRef.current.addMessage('assistant',
              `**🔨 Step 3: ${result.intent === 'generate' ? 'Generation' : 'Execution'}**\n\n${step3Key}`,
              { type: 'chain-of-thoughts', step: 3, intent: result.intent },
            );
          }
        }

        if (!restoredServerTranscript) {
          conversationHistoryRef.current?.addMessage('assistant', result.message, {
            actionType: result.intent,
            timestamp: new Date().toISOString(),
          });
        }

        if (!restoredServerTranscript && result.multiAgentReview?.conversationMessages) {
          result.multiAgentReview.conversationMessages.forEach((msg) => {
            if (conversationHistoryRef.current && msg.content) {
              conversationHistoryRef.current.addMessage(msg.role || 'assistant', msg.content, {
                ...(msg.metadata || {}),
                timestamp: msg.timestamp || new Date().toISOString(),
                isMultiAgent: true,
              });
            }
          });
        }

        if (!restoredServerTranscript) refreshConversation();

        if (result.researchContext && request.projectId) {
          window.localStorage.setItem(`researchContext_${request.projectId}`, JSON.stringify(result.researchContext));
          window.dispatchEvent(new CustomEvent('researchContextUpdated', {
            detail: result.researchContext,
          }));
        }

        if (result.draftMutated && result.persisted) {
          let afterConfig = result.surveyConfig || null;
          if (!afterConfig) {
            afterConfig = await loadSurveyConfigForProject(request.projectId).catch(() => null);
          }
          const processedAfter = afterConfig ? postProcessAiConfig(afterConfig) : null;
          const before = aiUndoSnapshotRef.current?.before || JSON.parse(JSON.stringify(surveyConfigRef.current || {}));
          const undo = {
            runId: result.runId,
            before,
            afterSignature: processedAfter ? JSON.stringify(processedAfter) : null,
            persisted: true,
            draftUpdatedAt: result.draftUpdatedAt || null,
          };
          aiUndoSnapshotRef.current = undo;
          setAiUndoAvailable(true);
          writeUndoSnapshot(
            typeof window !== 'undefined' ? window.sessionStorage : null,
            request.projectId,
            undo,
          );
          if (processedAfter) {
            setRunDiffs((current) => ({
              ...current,
              [result.runId]: summarizeDraftDiff(before, processedAfter),
            }));
          }
          window.dispatchEvent(new CustomEvent('sp-agent-run-complete', {
            detail: {
              projectId: request.projectId,
              sessionId: result.sessionId,
              runId: result.runId,
            },
          }));
        }

        if (result.surveyConfig) {
          const processedConfig = postProcessAiConfig(result.surveyConfig);
          const wasPersisted = result.runtime
            ? result.persisted === true && result.draftMutated === true
            : Boolean(result.draftUpdatedAt);
          if (wasPersisted) {
            const undo = {
              runId: result.runId,
              before: aiUndoSnapshotRef.current?.before || JSON.parse(JSON.stringify(surveyConfigRef.current || {})),
              afterSignature: JSON.stringify(processedConfig),
              persisted: true,
              draftUpdatedAt: result.draftUpdatedAt || null,
            };
            aiUndoSnapshotRef.current = undo;
            setAiUndoAvailable(true);
            writeUndoSnapshot(
              typeof window !== 'undefined' ? window.sessionStorage : null,
              request.projectId,
              undo,
            );
          }
          const persistence = wasPersisted
            ? { persisted: true, draftUpdatedAt: result.draftUpdatedAt, source: 'assistant' }
            : {};
          if (!applySurveyConfig(processedConfig, request, persistence)) return;

          if (contextEnabled) {
            if (workingMemoryRef.current) {
              if (result.intent === 'generate') {
                workingMemoryRef.current.setSurveyGoal(currentUserMessage);
              }
              workingMemoryRef.current.addIteration(processedConfig, currentUserMessage);
              if (result.intent === 'adjust') {
                workingMemoryRef.current.addDesignDecision(currentUserMessage, 'User requested adjustment');
              }
            }
            sessionLearningRef.current?.recordProjectInteraction(
              request.projectId,
              currentProject?.category || 'general',
              result.intent === 'generate' ? 'generate_survey' : 'adjust_survey',
            );
          }

          if (!platformMode && multiAgentReviewEnabled && (result.intent === 'generate' || result.intent === 'adjust')) {
            setLoadingStatus('Starting Multi-Agent Review...');
            try {
              const customAgents = request.projectId && window.localStorage.getItem(`customAgents_${request.projectId}`)
                ? JSON.parse(window.localStorage.getItem(`customAgents_${request.projectId}`))
                : null;
              const reviewResearchContext = request.projectId
                ? JSON.parse(window.localStorage.getItem(`researchContext_${request.projectId}`) || '{}')
                : {};

              await triggerMultiAgentReviewStream(
                processedConfig,
                openaiApiKey,
                reviewMode,
                maxReviewRounds,
                (eventType, data) => {
                  if (!stillCurrent() || !conversationHistoryRef.current) return;
                  switch (eventType) {
                    case 'start':
                      conversationHistoryRef.current.addMessage('system',
                        `\n🔄 **Multi-Agent Review Started**\n\nMode: ${data.mode}\nExperts: ${data.totalAgents}\nMax Rounds: ${data.maxRounds}\n`,
                        { type: 'review-start', isMultiAgent: true },
                      );
                      break;
                    case 'round-start':
                      conversationHistoryRef.current.addMessage('system',
                        `\n📋 **Review Round ${data.round}**\n`,
                        { type: 'round-header', isMultiAgent: true, round: data.round },
                      );
                      setLoadingStatus(`Review Round ${data.round}...`);
                      break;
                    case 'agent-start':
                      setLoadingStatus(`${data.emoji} ${data.name} reviewing...`);
                      break;
                    case 'agent-review':
                      conversationHistoryRef.current.addMessage('assistant', data.formatted, {
                        type: 'agent-review',
                        isMultiAgent: true,
                        agentId: data.agentId,
                        round: data.round,
                      });
                      refreshConversation();
                      break;
                    case 'round-summary':
                      conversationHistoryRef.current.addMessage('assistant', data.formatted, {
                        type: 'round-summary',
                        isMultiAgent: true,
                        round: data.round,
                      });
                      refreshConversation();
                      break;
                    case 'revision-start':
                      conversationHistoryRef.current.addMessage('system',
                        `\n🔧 **Survey Designer**: Addressing feedback and revising survey...\n`,
                        { type: 'revision-start', isMultiAgent: true, round: data.round },
                      );
                      refreshConversation();
                      setLoadingStatus('Revising survey...');
                      break;
                    case 'revision-thinking': {
                      const stepTitle = data.step === 1 ? 'Understanding Expert Feedback'
                        : data.step === 2 ? 'Planning Changes' : 'Executing Revision';
                      conversationHistoryRef.current.addMessage('assistant',
                        `**${'🧠📐🔨'[data.step - 1]} Revision Step ${data.step}: ${stepTitle}**\n\n${data.content}`,
                        { type: 'revision-thinking', step: data.step, isMultiAgent: true },
                      );
                      refreshConversation();
                      break;
                    }
                    case 'revision-complete':
                      if (data.chainOfThoughts) {
                        if (data.chainOfThoughts.step1_understanding) {
                          conversationHistoryRef.current.addMessage('assistant',
                            `**🧠 Revision Step 1: Understanding Expert Feedback**\n\n${data.chainOfThoughts.step1_understanding}`,
                            { type: 'revision-cot', step: 1, isMultiAgent: true },
                          );
                        }
                        if (data.chainOfThoughts.step2_planning) {
                          conversationHistoryRef.current.addMessage('assistant',
                            `**📐 Revision Step 2: Planning Changes**\n\n${data.chainOfThoughts.step2_planning}`,
                            { type: 'revision-cot', step: 2, isMultiAgent: true },
                          );
                        }
                        if (data.chainOfThoughts.step3_execution) {
                          conversationHistoryRef.current.addMessage('assistant',
                            `**🔨 Revision Step 3: Executing Revision**\n\n${data.chainOfThoughts.step3_execution}`,
                            { type: 'revision-cot', step: 3, isMultiAgent: true },
                          );
                        }
                      }
                      conversationHistoryRef.current.addMessage('assistant',
                        '🔧 **Survey Designer**: Survey revised based on expert feedback. Ready for next review round.',
                        { type: 'revision-complete', isMultiAgent: true, round: data.round },
                      );
                      refreshConversation();
                      if (data.surveyConfig) {
                        applySurveyConfig(postProcessAiConfig(data.surveyConfig), request);
                      }
                      break;
                    case 'complete':
                      conversationHistoryRef.current.addMessage('system',
                        `\n🎯 **Review Complete**\n\n${data.reason}\n\nFinal Rating: ${data.finalRating}/10\nFinal Verdict: ${data.finalVerdict?.toUpperCase()}\n`,
                        { type: 'review-complete', isMultiAgent: true },
                      );
                      refreshConversation();
                      if (data.surveyConfig) {
                        applySurveyConfig(postProcessAiConfig(data.surveyConfig), request);
                      }
                      break;
                    case 'error':
                    case 'agent-error':
                    case 'revision-error':
                      conversationHistoryRef.current.addMessage('system',
                        `❌ Error: ${data.error || data.message}`,
                        { type: 'error', isMultiAgent: true },
                      );
                      refreshConversation();
                      break;
                    default:
                      break;
                  }
                },
                customAgents,
                currentUserMessage,
                reviewResearchContext,
                request.projectId,
              );
            } catch (error) {
              if (stillCurrent()) {
                conversationHistoryRef.current?.addMessage('system',
                  `❌ Multi-Agent Review failed: ${error.message}`,
                  { type: 'error', isMultiAgent: true },
                );
                refreshConversation();
              }
            } finally {
              if (stillCurrent()) setLoadingStatus('');
            }
          }
        }
      } else if (stillCurrent()) {
        conversationHistoryRef.current?.addMessage('assistant',
          `❌ Error: ${result.error}`,
          { actionType: 'error', error: true },
        );
        refreshConversation();
      }
    } catch (error) {
      if (!stillCurrent()) {
        writePendingRun(pendingStorage, request.projectId, {
          status: 'failed',
          startedAt: pendingStartedAt,
          sessionId: aiSessionId || '',
          runId: activeRunId || undefined,
        });
        return;
      }
      clearPendingRun(pendingStorage, request.projectId);
      setActiveRunId('');
      setIsLoading(false);
      setLoadingStatus('');
      conversationHistoryRef.current?.addMessage('assistant',
        `❌ Unexpected error: ${error.message}`,
        { actionType: 'error', error: true },
      );
      refreshConversation();
    }
    if (typeof listAiInbox === 'function' && (completedResult?.sessionId || aiSessionId)) {
      const inbox = await Promise.resolve(listAiInbox(completedResult?.sessionId || aiSessionId)).catch(() => null);
      if (inbox?.success) setInboxItems(inbox.inbox || []);
    }
  }, [
    aiSessionId,
    apiKeyValid,
    applySurveyConfig,
    assistantMode,
    assistantDirectory,
    contextEnabled,
    currentProject?.category,
    customPrompts,
    maxReviewRounds,
    multiAgentReviewEnabled,
    openaiApiKey,
    platformMode,
    harnessMode,
    refreshConversation,
    reviewMode,
    selectedEffort,
    selectedRoute,
    currentProject,
    editorSelection,
    handleAssistantModeChange,
    hasUnsavedChanges,
    lastSavedConfig,
    onPrepareWrite,
    userMessage,
  ]);

  const handleResolveWriteConflict = useCallback(async (action) => {
    const pending = writeConflict;
    if (!pending) return;
    if (action === 'save') {
      const prepared = typeof onPrepareWrite === 'function'
        ? await onPrepareWrite({ commitWorkingCopy: true })
        : { ok: true };
      if (prepared && prepared.ok === false) {
        conversationHistoryRef.current?.addMessage('assistant',
          prepared.message || '⚠️ Save or reconcile the editor draft before asking the Assistant to edit.',
          { actionType: 'system', error: true },
        );
        refreshConversation();
        return;
      }
      setWriteConflict(null);
      await handleSendMessage({
        ...pending,
        skipConflict: true,
        workingCopyCommitted: prepared?.committedWorkingCopy !== false,
      });
      return;
    }
    setWriteConflict(null);
  }, [handleSendMessage, onPrepareWrite, refreshConversation, writeConflict]);

  const handleDiscardInbox = useCallback(async (itemId) => {
    const result = await discardAiInbox(itemId);
    if (result?.success) {
      setInboxItems((current) => current.filter((item) => item.id !== itemId));
    }
  }, []);

  const handleCancelRun = useCallback(async () => {
    const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
    const pending = readPendingRun(storage, projectIdRef.current);
    const runId = activeRunId || pending?.runId;
    if (!runId) return;
    setLoadingStatus('Cancelling…');
    await cancelAiRun(runId);
    clearPendingRun(storage, projectIdRef.current);
    setActiveRunId('');
    setIsLoading(false);
    setLoadingStatus('');
    setPendingApproval(null);
    if (typeof listAiInbox === 'function' && aiSessionId) {
      const inbox = await Promise.resolve(listAiInbox(aiSessionId)).catch(() => null);
      if (inbox?.success) setInboxItems(inbox.inbox || []);
    }
  }, [activeRunId, aiSessionId]);

  const handleApprovalDecision = useCallback(async (approved) => {
    if (!pendingApproval?.id) return;
    setLoadingStatus(approved ? 'Resuming approved action…' : 'Cancelling denied action…');
    const result = await answerAiRunApproval(pendingApproval.id, approved);
    if (!result?.success || !approved) {
      setIsLoading(false);
      setLoadingStatus('');
    }
    setPendingApproval(null);
  }, [pendingApproval]);

  const handleRunQualityChecks = useCallback(() => {
    const reports = runSurveyQualityChecks(surveyConfigRef.current);
    const lines = reports.flatMap((report) => (
      (report.findings || []).map((item) => `- [${report.id}] ${item.issue} (${item.questionName || item.pageName || 'survey'}): ${item.suggestion}`)
    ));
    conversationHistoryRef.current?.addMessage('assistant',
      lines.length
        ? `On-demand design checks (read-only, no draft changes):\n${lines.join('\n')}`
        : 'On-demand design checks found no issues. The draft was not changed.',
      { actionType: 'quality-check' },
    );
    refreshConversation();
  }, [refreshConversation]);

  const handleSteerMessage = useCallback(async () => {
    const content = userMessage.trim();
    if (!content || !aiSessionId || !isLoading) return;
    const result = await steerAiSession(
      aiSessionId,
      content,
      steerTarget === 'after-run' ? 'after-run' : 'next-step',
      {
        assistantMode,
        projectId,
        parentRunId: activeRunId || null,
        editorContext: {
          questionName: editorSelection?.questionName || null,
          pageName: editorSelection?.pageName || null,
          dirty: Boolean(editorSelection?.dirty || editorSelection?.pageDirty),
          hasUnsavedChanges: Boolean(hasUnsavedChanges || editorSelection?.dirty || editorSelection?.pageDirty),
        },
      },
    );
    if (result?.success) {
      setUserMessage('');
      setLoadingStatus(steerTarget === 'after-run' ? 'Queued for after this task…' : 'Steering update queued…');
      if (typeof listAiInbox === 'function') {
        const inbox = await Promise.resolve(listAiInbox(aiSessionId)).catch(() => null);
        if (inbox?.success) setInboxItems(inbox.inbox || []);
      }
    }
  }, [activeRunId, aiSessionId, assistantMode, editorSelection, hasUnsavedChanges, isLoading, projectId, steerTarget, userMessage]);

  return {
    enabled,
    isPlatformMode: platformMode,
    messages: conversationMessages,
    userMessage,
    isLoading,
    loadingStatus,
    pendingApproval,
    apiKeyValid,
    openaiApiKey,
    credentialHint,
    modelOptions: assistantModelOptions,
    selectedRoute,
    selectedEffort,
    assistantMode,
    editorSelection,
    effortOptions: assistantEffortOptions,
    routeUnavailable,
    blockReason,
    canSend: !blockReason && Boolean(userMessage.trim()) && !isLoading,
    contextEnabled,
    multiAgentReviewEnabled,
    reviewMode,
    maxReviewRounds,
    recommendations,
    conversationHistoryRef,
    workingMemoryRef,
    sessionLearningRef,
    chatEndRef,
    aiUndoAvailable,
    writeConflict,
    inboxItems,
    runDiffs,
    currentProject,
    setUserMessage,
    setOpenaiApiKey,
    setContextEnabled,
    setMultiAgentReviewEnabled,
    setReviewMode,
    setMaxReviewRounds,
    setCustomPrompts,
    setAssistantMode,
    handleAssistantModeChange,
    handleSendMessage,
    handleCancelRun,
    handleApprovalDecision,
    handleSteerMessage,
    steerTarget,
    setSteerTarget,
    handleValidateApiKey,
    applyCredentialStatus,
    handleAssistantRouteChange,
    handleAssistantEffortChange,
    handleRevertAiChange,
    handleResolveWriteConflict,
    handleDiscardInbox,
    handleRunQualityChecks,
    handleClearHistory,
    handleDownloadHistory,
  };
}

export function chatPropsFromAssistant(assistant) {
  if (!assistant) return {};
  return {
    messages: assistant.messages,
    userMessage: assistant.userMessage,
    isLoading: assistant.isLoading,
    loadingStatus: assistant.loadingStatus,
    pendingApproval: assistant.pendingApproval,
    apiKeyValid: assistant.apiKeyValid,
    openaiApiKey: assistant.openaiApiKey,
    credentialHint: assistant.credentialHint,
    isPlatformMode: assistant.isPlatformMode,
    contextEnabled: assistant.contextEnabled,
    multiAgentReviewEnabled: assistant.multiAgentReviewEnabled,
    reviewMode: assistant.reviewMode,
    maxReviewRounds: assistant.maxReviewRounds,
    recommendations: assistant.recommendations,
    currentProject: assistant.currentProject,
    conversationHistoryRef: assistant.conversationHistoryRef,
    workingMemoryRef: assistant.workingMemoryRef,
    sessionLearningRef: assistant.sessionLearningRef,
    onMessageChange: assistant.setUserMessage,
    onSendMessage: assistant.handleSendMessage,
    onCancelRun: assistant.handleCancelRun,
    onApprovalDecision: assistant.handleApprovalDecision,
    onSteerMessage: assistant.handleSteerMessage,
    steerTarget: assistant.steerTarget,
    onSteerTargetChange: assistant.setSteerTarget,
    editorSelection: assistant.editorSelection,
    onApiKeyChange: assistant.setOpenaiApiKey,
    onValidateApiKey: assistant.handleValidateApiKey,
    onContextToggle: assistant.setContextEnabled,
    onMultiAgentReviewToggle: assistant.setMultiAgentReviewEnabled,
    onReviewModeChange: assistant.setReviewMode,
    onMaxReviewRoundsChange: assistant.setMaxReviewRounds,
    onClearHistory: assistant.handleClearHistory,
    onDownloadHistory: assistant.handleDownloadHistory,
    onPromptsChange: assistant.setCustomPrompts,
    onCredentialsChange: assistant.applyCredentialStatus,
    chatEndRef: assistant.chatEndRef,
    aiUndoAvailable: assistant.aiUndoAvailable,
    writeConflict: assistant.writeConflict,
    inboxItems: assistant.inboxItems,
    runDiffs: assistant.runDiffs,
    onRevertAiChange: assistant.handleRevertAiChange,
    onResolveWriteConflict: assistant.handleResolveWriteConflict,
    onDiscardInbox: assistant.handleDiscardInbox,
    onRunQualityChecks: assistant.handleRunQualityChecks,
    modelOptions: assistant.modelOptions,
    selectedRoute: assistant.selectedRoute,
    selectedEffort: assistant.selectedEffort,
    assistantMode: assistant.assistantMode,
    effortOptions: assistant.effortOptions,
    onRouteChange: assistant.handleAssistantRouteChange,
    onEffortChange: assistant.handleAssistantEffortChange,
    onAssistantModeChange: assistant.handleAssistantModeChange || assistant.setAssistantMode,
    onClearEditorFocus: assistant.onClearEditorFocus,
    routeUnavailable: assistant.routeUnavailable,
    blockReason: assistant.blockReason,
  };
}
