import { act, renderHook, waitFor } from '@testing-library/react';
import useSurveyAssistant from './useSurveyAssistant';
import * as conversationHistory from '../lib/conversationHistory';

jest.mock('../lib/conversationHistory', () => {
  const historyStore = new Map();
  return {
    getConversationHistory: (projectId) => {
      if (!historyStore.has(projectId)) historyStore.set(projectId, []);
      const history = historyStore.get(projectId);
      return {
        addMessage: (role, content, metadata = {}) => {
          history.push({
            id: `${role}-${history.length}`,
            role,
            content,
            timestamp: new Date().toISOString(),
            metadata,
          });
        },
        getAllMessages: () => [...history],
        replaceMessages: (messages) => {
          history.splice(0, history.length, ...messages);
          return [...history];
        },
        getFormattedForOpenAI: () => history.map((msg) => ({ role: msg.role, content: msg.content })),
        clear: () => { history.length = 0; },
        export: () => [...history],
      };
    },
    __resetHistory: () => historyStore.clear(),
  };
});

jest.mock('../lib/workingMemory', () => ({
  getWorkingMemory: () => ({
    getContextForAI: () => 'working',
    setSurveyGoal: jest.fn(),
    addIteration: jest.fn(),
    addDesignDecision: jest.fn(),
    export: () => ({}),
    clear: jest.fn(),
  }),
}));

jest.mock('../lib/sessionLearning', () => ({
  getSessionLearning: () => ({
    getRecommendations: () => [],
    getContextForAI: () => 'session',
    recordProjectInteraction: jest.fn(),
    export: () => ({}),
  }),
}));

const mockSendChatMessage = jest.fn();
const mockTriggerMultiAgentReviewStream = jest.fn();
jest.mock('../lib/chatApi', () => ({
  sendChatMessage: (...args) => mockSendChatMessage(...args),
  validateChatApiKey: jest.fn(),
  triggerMultiAgentReviewStream: (...args) => mockTriggerMultiAgentReviewStream(...args),
}));

jest.mock('../lib/designProtocol', () => ({
  postProcessAiConfig: (config) => config,
}));

const mockSaveAiSettings = jest.fn();
const mockListAiSessions = jest.fn();
const mockGetAiSession = jest.fn();
const mockApplyAgentReview = jest.fn();
const mockEstimateAgentReview = jest.fn(async () => ({ success: false }));
jest.mock('../lib/agentApi', () => ({
  applyAgentReview: (...args) => mockApplyAgentReview(...args),
  estimateAgentReview: (...args) => mockEstimateAgentReview(...args),
  saveAiSettings: (...args) => mockSaveAiSettings(...args),
  getCredentialStatus: jest.fn(),
  listAiSessions: (...args) => mockListAiSessions(...args),
  getAiSession: (...args) => mockGetAiSession(...args),
  listAiInbox: jest.fn(async () => ({ success: true, inbox: [] })),
  discardAiInbox: jest.fn(async () => ({ success: true })),
  archiveAiSession: jest.fn(),
  cancelAiRun: jest.fn(),
  listAiRunApprovals: jest.fn(),
  steerAiSession: jest.fn(),
  answerAiRunApproval: jest.fn(),
  switchSpSchemeEditor: (...args) => mockSwitchSpSchemeEditor(...args),
}));
const mockSwitchSpSchemeEditor = jest.fn();
const mockLoadSurveyConfigForProject = jest.fn(async () => null);
jest.mock('../lib/projectManager', () => ({
  loadSurveyConfigForProject: (...args) => mockLoadSurveyConfigForProject(...args),
}));

const directory = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    configured: true,
    models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    configured: true,
    models: [{ id: 'reasoner', label: 'Reasoner', reasoningEfforts: { low: {}, high: {} }, defaultEffort: 'high' }],
  },
];

function project(id) {
  return { id, name: id, category: 'general' };
}

describe('useSurveyAssistant', () => {
  beforeEach(() => {
    conversationHistory.__resetHistory();
    mockSendChatMessage.mockReset();
    mockTriggerMultiAgentReviewStream.mockReset();
    mockSaveAiSettings.mockReset();
    mockListAiSessions.mockReset();
    mockGetAiSession.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
  });

  afterEach(() => {
    delete process.env.REACT_APP_SUPABASE_URL;
    jest.useRealTimers();
  });

  test('restores session, route, and undo snapshot when switching projects', async () => {
    sessionStorage.setItem('ai_session_p1', 'sess-p1');
    sessionStorage.setItem('ai_route_p1', JSON.stringify({ route: 'deepseek::reasoner', effort: 'low' }));
    sessionStorage.setItem('ai_undo_p1', JSON.stringify({ title: 'Before P1' }));
    sessionStorage.setItem('ai_session_p2', 'sess-p2');
    sessionStorage.setItem('ai_route_p2', JSON.stringify({ route: 'openai::gpt-4o', effort: '' }));

    const onChange = jest.fn();
    const { result, rerender } = renderHook(
      ({ currentProject }) => useSurveyAssistant({
        currentProject,
        surveyConfig: { title: 'Live' },
        onSurveyConfigChange: onChange,
      }),
      { initialProps: { currentProject: project('p2') } },
    );

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai', 'deepseek'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });

    expect(result.current.selectedRoute).toBe('openai::gpt-4o');
    expect(result.current.aiUndoAvailable).toBe(false);

    rerender({ currentProject: project('p1') });

    await waitFor(() => {
      expect(result.current.selectedRoute).toBe('deepseek::reasoner');
    });
    expect(result.current.selectedEffort).toBe('low');
    expect(result.current.aiUndoAvailable).toBe(true);

    act(() => {
      result.current.handleRevertAiChange();
    });
    expect(onChange).toHaveBeenCalledWith({ title: 'Before P1' });
    expect(result.current.aiUndoAvailable).toBe(false);
    expect(sessionStorage.getItem('ai_undo_p1')).toBeNull();
  });

  test('ignores a late response after the user switches projects', async () => {
    jest.useFakeTimers();
    let resolveSend;
    mockSendChatMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    const onChange = jest.fn();
    const { result, rerender } = renderHook(
      ({ currentProject, surveyConfig }) => useSurveyAssistant({
        currentProject,
        surveyConfig,
        onSurveyConfigChange: onChange,
      }),
      { initialProps: { currentProject: project('p1'), surveyConfig: { title: 'A' } } },
    );

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });

    act(() => {
      result.current.setUserMessage('rewrite this survey');
    });

    let pending;
    act(() => {
      pending = result.current.handleSendMessage();
    });
    expect(mockSendChatMessage).toHaveBeenCalled();

    rerender({ currentProject: project('p2'), surveyConfig: { title: 'B' } });

    await act(async () => {
      resolveSend({
        success: true,
        message: 'done',
        intent: 'adjust',
        sessionId: 'late-session',
        surveyConfig: { title: 'Hijacked' },
      });
      jest.advanceTimersByTime(600);
      await pending;
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('ai_session_p2')).toBeFalsy();
    expect(result.current.messages.some((msg) => msg.content === 'done')).toBe(false);
    jest.useRealTimers();
  });

  test('restores a running indicator and messages after refresh', async () => {
    jest.useFakeTimers();
    sessionStorage.setItem('ai_pending_run_p1', JSON.stringify({
      status: 'running',
      startedAt: Date.now(),
      sessionId: 'sess-p1',
    }));
    mockGetAiSession
      .mockResolvedValueOnce({
        events: [{ type: 'run.status', payload: { status: 'running' } }],
        messages: [{ role: 'assistant', content: 'Working…' }],
      })
      .mockResolvedValueOnce({
        events: [{ type: 'run.status', payload: { status: 'completed' } }],
        messages: [{ role: 'assistant', content: 'Done.' }],
      });

    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    await act(async () => {});
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingStatus).toMatch(/Continuing/);

    await act(async () => {
      jest.advanceTimersByTime(1600);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toEqual([{ role: 'assistant', content: 'Done.' }]);
    expect(sessionStorage.getItem('ai_pending_run_p1')).toBeNull();
    jest.useRealTimers();
  });

  test('restores the latest hosted conversation after a completed-page refresh', async () => {
    sessionStorage.setItem('ai_session_p1', 'sess-p1');
    mockGetAiSession.mockResolvedValue({
      events: [{ type: 'run.status', payload: { status: 'completed' } }],
      messages: [
        { id: 'event-1', role: 'user', content: 'Design a survey' },
        { id: 'event-2', role: 'assistant', content: 'Survey saved.' },
      ],
    });

    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        { id: 'event-1', role: 'user', content: 'Design a survey' },
        { id: 'event-2', role: 'assistant', content: 'Survey saved.' },
      ]);
    });
    expect(mockGetAiSession).toHaveBeenCalledWith('sess-p1');
  });

  test('one conversation per study: opening it in the other editor keeps the chosen mode', async () => {
    sessionStorage.setItem('ai_session_p1', 'sess-p1');
    mockGetAiSession.mockResolvedValue({
      assistantMode: 'agent',
      events: [{ type: 'run.status', payload: { status: 'completed' } }],
      messages: [
        { id: 'event-1', role: 'user', content: 'Make a page' },
        { id: 'event-2', role: 'assistant', content: 'Page saved.' },
      ],
    });
    // Studio opens the study in SP-Scheme mode and remembers it.
    const studio = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: {},
      defaultMode: 'spscheme',
      onSurveyConfigChange: jest.fn(),
    }));
    await waitFor(() => expect(studio.result.current.messages).toHaveLength(2));
    expect(studio.result.current.assistantMode).toBe('spscheme');
    expect(localStorage.getItem('assistantMode_p1')).toBe('spscheme');
    studio.unmount();
    // The classic editor (no default, no page) shows the same conversation in the same mode.
    const classic = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));
    await waitFor(() => expect(classic.result.current.messages).toHaveLength(2));
    expect(classic.result.current.assistantMode).toBe('spscheme');
  });

  test('leaving SP-Scheme on a study with a page asks first, then backs up the page and switches', async () => {
    mockSwitchSpSchemeEditor.mockReset();
    mockSwitchSpSchemeEditor.mockResolvedValue({ success: true, changed: true, draftUpdatedAt: 'd2' });
    const classicConfig = { title: 'Live', pages: [{ name: 'p1', elements: [] }], spSchemeBackupAt: 'now' };
    mockLoadSurveyConfigForProject.mockResolvedValueOnce(classicConfig);
    const onChange = jest.fn();
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live', spSite: { html: '<html></html>' } },
      defaultMode: 'spscheme',
      onSurveyConfigChange: onChange,
    }));
    expect(result.current.assistantMode).toBe('spscheme');
    act(() => result.current.requestAssistantModeChange('agent'));
    expect(result.current.modeSwitch).toEqual({ to: 'agent' });
    expect(result.current.assistantMode).toBe('spscheme');
    act(() => { result.current.handleModeSwitchChoice('cancel'); });
    expect(result.current.modeSwitch).toBeNull();
    expect(mockSwitchSpSchemeEditor).not.toHaveBeenCalled();

    act(() => result.current.requestAssistantModeChange('agent'));
    await act(async () => { await result.current.handleModeSwitchChoice('switch'); });
    expect(mockSwitchSpSchemeEditor).toHaveBeenCalledWith('p1', 'classic');
    expect(onChange).toHaveBeenCalledWith(classicConfig, expect.objectContaining({ persisted: true, draftUpdatedAt: 'd2' }));
    expect(result.current.assistantMode).toBe('agent');
    expect(result.current.modeSwitch).toBeNull();
  });

  test('a study without a page switches mode at once', () => {
    mockSwitchSpSchemeEditor.mockReset();
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      defaultMode: 'spscheme',
      onSurveyConfigChange: jest.fn(),
    }));
    act(() => result.current.requestAssistantModeChange('agent'));
    expect(result.current.modeSwitch).toBeNull();
    expect(result.current.assistantMode).toBe('agent');
    expect(mockSwitchSpSchemeEditor).not.toHaveBeenCalled();
  });

  test('streams hosted snapshots into the conversation while a run is in progress', async () => {
    let extras;
    mockSendChatMessage.mockImplementation((...args) => {
      extras = args[8];
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('Generate a safety survey'));
    await act(async () => {
      result.current.handleSendMessage();
    });
    await act(async () => {
      extras.onSnapshot({
        events: [
          { type: 'run.status', payload: { status: 'running' } },
          { type: 'tool.call', payload: { id: '1', name: 'survey_apply_operations' } },
        ],
        messages: [
          { id: 'u1', role: 'user', content: 'Generate a safety survey' },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            tools: [{ id: '1', name: 'survey_apply_operations', status: 'running' }],
          },
        ],
        run: { id: 'run-1', status: 'running' },
      });
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingStatus).toBe('Using survey_apply_operations…');
    expect(result.current.messages[1].tools[0]).toEqual({
      id: '1',
      name: 'survey_apply_operations',
      status: 'running',
    });
  });

  test('keeps conversation display persistence when context enrichment is disabled', async () => {
    localStorage.setItem('contextEnabled_p1', 'false');
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('remember this message'));
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Remembered.',
      intent: 'question',
      sessionId: 'sess-p1',
    });
    let completion;
    await act(async () => {
      completion = await result.current.handleSendMessage();
    });
    expect(completion).toMatchObject({ success: true, message: 'Remembered.' });
    expect(result.current.messages.map((message) => message.content)).toEqual([
      'remember this message',
      'Remembered.',
    ]);
  });

  test.each(['cancelled', 'failed'])('returns the %s result without treating it as a completed report', async (status) => {
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'], directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    const output = { success: false, status, error: 'Analysis did not finish.' };
    mockSendChatMessage.mockResolvedValue(output);
    let completion;
    await act(async () => {
      completion = await result.current.handleSendMessage({ message: 'Analyze current results', assistantMode: 'question' });
    });
    expect(completion).toEqual(output);
    expect(result.current.isLoading).toBe(false);
  });

  test('persists the project mode and sends it to the hosted assistant', async () => {
    localStorage.setItem('assistantMode_p1', 'generate');
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Answer only.',
      intent: 'question',
      assistantMode: 'question',
      sessionId: 'sess-p1',
    });
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    // Older stored modes open as Classic; only SP-Scheme and Classic remain.
    expect(result.current.assistantMode).toBe('agent');
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => {
      result.current.handleAssistantModeChange('spscheme');
      result.current.setUserMessage('Explain the current survey');
    });
    await waitFor(() => {
      expect(localStorage.getItem('assistantMode_p1')).toBe('spscheme');
    });
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(mockSendChatMessage.mock.calls[0][8]).toEqual(expect.objectContaining({
      projectId: 'p1',
      assistantMode: 'spscheme',
    }));
  });

  test('updates survey config after a successful send', async () => {
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Updated',
      intent: 'adjust',
      sessionId: 'sess-new',
      surveyConfig: { title: 'After AI' },
      draftUpdatedAt: '2026-09-15T06:00:00.000Z',
    });
    const onChange = jest.fn();
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Before AI' },
      onSurveyConfigChange: onChange,
    }));

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('make it shorter'));
    await act(async () => {
      await result.current.handleSendMessage();
    });

    expect(onChange).toHaveBeenCalledWith(
      { title: 'After AI' },
      {
        persisted: true,
        draftUpdatedAt: '2026-09-15T06:00:00.000Z',
        source: 'assistant',
      },
    );
    expect(sessionStorage.getItem('ai_session_p1')).toBe('sess-new');
    expect(result.current.aiUndoAvailable).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('ai_undo_p1'))).toEqual(expect.objectContaining({
      before: { title: 'Before AI' },
      afterSignature: JSON.stringify({ title: 'After AI' }),
    }));
    expect(mockSendChatMessage).toHaveBeenCalledWith(
      'make it shorter',
      { title: 'Before AI' },
      expect.any(Array),
      '',
      false,
      '1v1',
      null,
      {},
      expect.objectContaining({
        projectId: 'p1',
        provider: 'openai',
        model: 'gpt-4o',
      }),
    );
  });

  test('applies a review revision with an undo snapshot and reverts it through the save path', async () => {
    const before = { title: 'Before review', pages: [{ name: 'p1', elements: [{ name: 'q1', type: 'text' }] }] };
    const after = { title: 'Before review', pages: [{ name: 'p1', elements: [{ name: 'q1', type: 'text', description: 'Round 1' }] }] };
    mockApplyAgentReview.mockResolvedValue({
      success: true,
      rounds: [1],
      surveyConfig: after,
      draftUpdatedAt: '2026-09-29T07:00:00.000Z',
      messages: [],
    });
    mockLoadSurveyConfigForProject.mockResolvedValue(before);
    const onPrepareWrite = jest.fn(async () => ({ ok: true, draftUpdatedAt: '2026-09-29T07:05:00.000Z' }));
    let config = before;
    const onChange = jest.fn((next) => { config = next; });
    const { result, rerender } = renderHook(() => useSurveyAssistant({
      currentProject: { ...project('p1'), draftUpdatedAt: '2026-09-29T06:00:00.000Z' },
      surveyConfig: config,
      onSurveyConfigChange: onChange,
      onPrepareWrite,
    }));

    await act(async () => {
      await result.current.handleApplyReview('run-review', [1]);
    });
    rerender();
    expect(mockApplyAgentReview).toHaveBeenCalledWith('run-review', [1]);
    expect(onChange).toHaveBeenLastCalledWith(after, {
      persisted: true,
      draftUpdatedAt: '2026-09-29T07:00:00.000Z',
      source: 'assistant',
    });
    expect(result.current.aiUndoAvailable).toBe(true);

    await act(async () => {
      await result.current.handleRevertAiChange();
    });
    expect(onPrepareWrite).toHaveBeenCalledWith({
      surveyConfig: before,
      expectedDraftUpdatedAt: '2026-09-29T07:00:00.000Z',
    });
    expect(onChange).toHaveBeenLastCalledWith(before, expect.objectContaining({ persisted: true }));
    expect(result.current.aiUndoAvailable).toBe(false);
  });

  test('reports a review apply conflict without touching the editor', async () => {
    mockApplyAgentReview.mockResolvedValue({ success: false, status: 409, code: 'DRAFT_WRITE_CONFLICT', error: 'Draft changed' });
    const onChange = jest.fn();
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Current' },
      onSurveyConfigChange: onChange,
    }));
    await act(async () => {
      await result.current.handleApplyReview('run-review', [1]);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.aiUndoAvailable).toBe(false);
    expect(result.current.messages.at(-1).content).toMatch(/draft changed after this review/i);
  });

  test('keeps the current session route when saving the default model fails', async () => {
    mockSaveAiSettings.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));

    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai', 'deepseek'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });

    await act(async () => {
      result.current.handleAssistantRouteChange('deepseek::reasoner');
    });

    expect(result.current.selectedRoute).toBe('deepseek::reasoner');
    expect(result.current.selectedEffort).toBe('high');
    expect(JSON.parse(sessionStorage.getItem('ai_route_p1'))).toEqual({
      route: 'deepseek::reasoner',
      effort: 'high',
    });
  });

  // 'does not expose the legacy multi-agent path to the hosted runtime' is platform-only (self-hosted keeps the local path).

  test('sends editor focus and refuses to send when the dirty draft cannot be saved', async () => {
    const onPrepareWrite = jest.fn(async () => ({ ok: false, message: 'Save failed' }));
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: { ...project('p1'), draftUpdatedAt: '2026-09-16T00:00:00.000Z' },
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
      editorSelection: { pageName: 'page1', questionName: 'q1', panel: 'builder' },
      hasUnsavedChanges: true,
      onPrepareWrite,
    }));
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('edit this question'));
    await act(async () => {
      await result.current.handleSendMessage();
    });
    expect(onPrepareWrite).not.toHaveBeenCalled();
    expect(mockSendChatMessage).not.toHaveBeenCalled();
    expect(result.current.writeConflict).toEqual({
      message: 'edit this question',
      assistantMode: 'agent',
    });

    await act(async () => {
      await result.current.handleResolveWriteConflict('save');
    });
    expect(onPrepareWrite).toHaveBeenCalled();
    expect(mockSendChatMessage).not.toHaveBeenCalled();
    expect(result.current.messages.some((msg) => String(msg.content).includes('Save failed'))).toBe(true);

    onPrepareWrite.mockResolvedValue({ ok: true });
    mockSendChatMessage.mockResolvedValue({
      success: true,
      message: 'Edited.',
      intent: 'adjust',
    });
    await act(async () => {
      await result.current.handleResolveWriteConflict('save');
    });
    expect(mockSendChatMessage.mock.calls[0][8]).toEqual(expect.objectContaining({
      editorContext: expect.objectContaining({
        pageName: 'page1',
        questionName: 'q1',
        panel: 'builder',
        projectId: 'p1',
        draftUpdatedAt: '2026-09-16T00:00:00.000Z',
      }),
    }));
  });

  test('holds the request when a page working copy is dirty', async () => {
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live', pages: [{ name: 'p', title: 'Page' }] },
      onSurveyConfigChange: jest.fn(),
      editorSelection: { pageName: 'p', pageDirty: true, pageWorkingCopy: { name: 'p', title: 'Edited page' } },
    }));
    await act(async () => {
      result.current.applyCredentialStatus({
        configuredProviders: ['openai'],
        directory,
        defaultRoute: { provider: 'openai', model: 'gpt-4o' },
      });
    });
    act(() => result.current.setUserMessage('把这道题设为必答'));
    await act(async () => {
      await result.current.handleSendMessage();
    });
    expect(mockSendChatMessage).not.toHaveBeenCalled();
    expect(result.current.writeConflict).toEqual({
      message: '把这道题设为必答',
      assistantMode: 'agent',
    });
  });

  test('refuses AI undo after later human edits', async () => {
    sessionStorage.setItem('ai_undo_p1', JSON.stringify({
      before: { title: 'Before AI' },
      afterSignature: JSON.stringify({ title: 'After AI' }),
    }));
    const onChange = jest.fn();
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Human edit' },
      onSurveyConfigChange: onChange,
    }));
    await waitFor(() => {
      expect(result.current.aiUndoAvailable).toBe(true);
    });
    act(() => {
      result.current.handleRevertAiChange();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.messages.some((msg) => String(msg.content).includes('newer edits'))).toBe(true);
  });

  test('treats a queued pending run as in progress', async () => {
    sessionStorage.setItem('ai_pending_run_p1', JSON.stringify({
      status: 'queued',
      startedAt: Date.now(),
      sessionId: 'sess-p1',
    }));
    mockGetAiSession.mockResolvedValue({
      events: [{ type: 'run.status', payload: { status: 'queued' } }],
      run: { id: 'run-1', status: 'queued' },
      messages: [],
    });
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: project('p1'),
      surveyConfig: { title: 'Live' },
      onSurveyConfigChange: jest.fn(),
    }));
    await act(async () => {});
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingStatus).toMatch(/Queued/);
  });

  test('does not send when no project is selected', async () => {
    const { result } = renderHook(() => useSurveyAssistant({
      currentProject: null,
      surveyConfig: { title: 'None' },
      onSurveyConfigChange: jest.fn(),
    }));
    act(() => result.current.setUserMessage('hello'));
    await act(async () => {
      await result.current.handleSendMessage();
    });
    expect(mockSendChatMessage).not.toHaveBeenCalled();
    expect(result.current.blockReason).toBe('no-project');
  });
});

describe('assistant modes', () => {
  it('opens SP-Scheme studies in SP-Scheme mode and classic surveys in Classic mode', () => {
    const { defaultAssistantMode } = jest.requireActual('./useSurveyAssistant');
    expect(defaultAssistantMode({ spSite: { html: '<html></html>' } })).toBe('spscheme');
    expect(defaultAssistantMode({ pages: [] })).toBe('agent');
    expect(defaultAssistantMode({ pages: [] }, 'spscheme')).toBe('spscheme');
    expect(defaultAssistantMode({ spSite: { html: 'x' } }, 'review')).toBe('spscheme');
  });
});
