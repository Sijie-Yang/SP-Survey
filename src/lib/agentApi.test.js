import {
  cancelAiRun,
  sendAgentChat,
  steerAiSession,
} from './agentApi';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
      })),
    },
  },
}));

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  });
}

describe('Agent API asynchronous runs', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  test('starts a run and resolves it from the server-backed session', async () => {
    global.fetch
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        queued: true,
        sessionId: 'session-1',
        runId: 'run-1',
        assistantMode: 'generate',
      }, 202))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        run: {
          id: 'run-1',
          status: 'completed',
          result: {
            assistantMode: 'generate',
            intent: 'generate',
            message: 'Saved.',
            draftUpdatedAt: 'v2',
            draftMutated: true,
            persisted: true,
          },
        },
        events: [],
        messages: [{ role: 'assistant', content: 'Saved.' }],
      }));
    const onStarted = jest.fn();

    const result = await sendAgentChat({
      message: 'Generate a survey',
      projectId: 'project-1',
      assistantMode: 'generate',
      onStarted,
    });

    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }));
    expect(result).toEqual(expect.objectContaining({
      success: true,
      runId: 'run-1',
      draftMutated: true,
      persisted: true,
      message: 'Saved.',
    }));
  });

  test('streams intermediate session snapshots while the run is queued', async () => {
    global.fetch
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        queued: true,
        sessionId: 'session-1',
        runId: 'run-1',
      }, 202))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        run: { id: 'run-1', status: 'running' },
        events: [
          { seq: 1, type: 'run.status', payload: { status: 'running' } },
          { seq: 2, type: 'tool.call', payload: { id: '1', name: 'survey_get_draft' } },
        ],
        messages: [{
          role: 'assistant',
          content: '',
          tools: [{ id: '1', name: 'survey_get_draft', status: 'running' }],
        }],
        nextCursor: 2,
      }))
      .mockImplementationOnce(() => jsonResponse({
        success: true,
        run: {
          id: 'run-1',
          status: 'completed',
          result: { message: 'Saved.', draftMutated: true, persisted: true, surveyConfig: { title: 'Saved' } },
        },
        events: [{ seq: 3, type: 'run.status', payload: { status: 'completed' } }],
        messages: [{ role: 'assistant', content: 'Saved.' }],
        nextCursor: 3,
      }));
    const onSnapshot = jest.fn();

    const result = await sendAgentChat({
      message: 'Generate a survey',
      projectId: 'project-1',
      onSnapshot,
    });

    expect(onSnapshot).toHaveBeenCalled();
    expect(onSnapshot.mock.calls[0][0].messages[0].tools[0].name).toBe('survey_get_draft');
    expect(result.success).toBe(true);
    expect(result.surveyConfig).toEqual({ title: 'Saved' });
    expect(global.fetch.mock.calls[2][0]).toContain('/api/agent/sessions/session-1?after=2');
  });

  test('cancels the server run when the browser watcher times out', async () => {
    const { waitForAgentRun } = await import('./agentApi');
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/cancel')) return jsonResponse({ success: true });
      return jsonResponse({
        success: true,
        run: { id: 'run-stuck', status: 'running' },
        runs: [{ id: 'run-stuck', status: 'running' }],
        events: [],
        messages: [],
      });
    });
    const result = await waitForAgentRun('session-1', 'run-stuck', { intervalMs: 1, timeoutMs: 5 });
    expect(result.success).toBe(false);
    expect(result.code).toBe('AGENT_RUN_TIMEOUT');
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/api/agent/runs/run-stuck/cancel'))).toBe(true);
  });

  test('exposes cancellation and steering endpoints', async () => {
    global.fetch.mockImplementation(() => jsonResponse({ success: true }));
    await cancelAiRun('run-1');
    await steerAiSession('session-1', 'Use fewer pages');
    expect(global.fetch.mock.calls[0][0]).toContain('/api/agent/runs/run-1/cancel');
    expect(global.fetch.mock.calls[1][0]).toContain('/api/agent/sessions/session-1/steer');
  });
});
