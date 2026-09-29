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
jest.mock('../lib/chatApi', () => ({
  sendChatMessage: (...args) => mockSendChatMessage(...args),
  validateChatApiKey: jest.fn(),
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
}));
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

describe('useSurveyAssistant review apply and undo', () => {
  beforeEach(() => {
    conversationHistory.__resetHistory();
    mockApplyAgentReview.mockReset();
    mockLoadSurveyConfigForProject.mockReset();
    sessionStorage.clear();
    localStorage.clear();
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
});
