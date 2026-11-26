import { sendChatMessage } from './chatApi';

const mockSendAgentChat = jest.fn();

jest.mock('./supabase', () => ({
  supabase: {},
}));

jest.mock('./agentApi', () => ({
  sendAgentChat: (...args) => mockSendAgentChat(...args),
}));

describe('chatApi assistant mode transport', () => {
  beforeEach(() => {
    mockSendAgentChat.mockReset();
  });

  test('passes the explicit mode to the Agent API', async () => {
    mockSendAgentChat.mockResolvedValue({ success: true, assistantMode: 'adjust' });

    await sendChatMessage(
      'Shorten the questions',
      { title: 'Survey' },
      [],
      '',
      false,
      '1v1',
      null,
      null,
      {
        projectId: 'project-1',
        sessionId: 'session-1',
        assistantMode: 'adjust',
      },
    );

    expect(mockSendAgentChat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Shorten the questions',
      projectId: 'project-1',
      sessionId: 'session-1',
      assistantMode: 'adjust',
    }));
  });

  test('forwards hosted run snapshots to the Assistant UI', async () => {
    const onSnapshot = jest.fn();
    mockSendAgentChat.mockResolvedValue({ success: true });

    await sendChatMessage(
      'Generate it',
      { title: 'Survey' },
      [],
      '',
      false,
      '1v1',
      null,
      null,
      { projectId: 'project-1', onSnapshot },
    );

    expect(mockSendAgentChat).toHaveBeenCalledWith(expect.objectContaining({ onSnapshot }));
  });
});
