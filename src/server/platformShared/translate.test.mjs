import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { acceptModelTranslations, handleSurveyTranslate } from './translate.mjs';

describe('survey translation assistant', () => {
  it('rejects translations that change numbers and ignores extra ids', () => {
    const items = [{ id: 'survey.title', text: 'Rate 1 to 5' }];
    const result = acceptModelTranslations(items, {
      translations: {
        'survey.title': '请打分一到五',
        'question:q1:choice:code_a': 'changed-code',
      },
    });
    assert.deepEqual(result.accepted, {});
    assert.deepEqual(result.rejected, ['survey.title']);
    const kept = acceptModelTranslations(items, { translations: { 'survey.title': '请为 1 到 5 打分' } });
    assert.equal(kept.accepted['survey.title'], '请为 1 到 5 打分');
    assert.equal(kept.accepted['question:q1:choice:code_a'], undefined);
  });

  it('does not call the model when the Assistant is not configured', async () => {
    const chat = mock.fn(async () => ({ content: '{"translations":{"survey.title":"你好"}}' }));
    await assert.rejects(
      () => handleSurveyTranslate({}, 'user', {
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        items: [{ id: 'survey.title', text: 'Hello' }],
      }, {
        loadUserAiSettings: async () => ({ assistant_provider: 'deepseek', assistant_model: 'deepseek-v4-pro' }),
        listProviderProfiles: async () => [],
        resolveAssistantBinding: async () => ({ credential: null }),
        chatCompletions: chat,
      }),
      (error) => error.code === 'CREDENTIALS_MISSING',
    );
    assert.equal(chat.mock.calls.length, 0);
  });
});
