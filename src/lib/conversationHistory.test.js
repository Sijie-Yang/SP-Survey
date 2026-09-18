import { ConversationHistory } from './conversationHistory';

describe('ConversationHistory', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test('replaces local history with normalized server messages', () => {
    const history = new ConversationHistory('project-1');
    history.addMessage('user', 'Old local message');

    expect(history.replaceMessages([
      {
        id: 'event-1',
        role: 'user',
        content: 'Design a survey',
        createdAt: '2026-09-15T10:00:00.000Z',
      },
      {
        id: 'event-2',
        role: 'assistant',
        content: 'Survey saved.',
        createdAt: '2026-09-15T10:00:01.000Z',
        tools: [{ id: '1', name: 'survey_apply_operations', status: 'done' }],
      },
    ])).toEqual([
      expect.objectContaining({ id: 'event-1', content: 'Design a survey' }),
      expect.objectContaining({
        id: 'event-2',
        content: 'Survey saved.',
        tools: [{ id: '1', name: 'survey_apply_operations', status: 'done' }],
      }),
    ]);

    const reloaded = new ConversationHistory('project-1');
    expect(reloaded.getAllMessages()).toHaveLength(2);
    expect(reloaded.getAllMessages()[1].metadata.recovered).toBe(true);
  });
});
