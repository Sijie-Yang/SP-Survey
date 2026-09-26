jest.mock('../config/deploymentConfig', () => ({
  deploymentConfig: { id: 'proj_deployed' },
  getPreloadedImages: () => [],
  isImagePreloaded: () => false,
  isDeployedParticipant: () => true,
}));

import { saveSurveyResponse } from './supabase';

describe('deployed participant submit', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('does not POST answers to the local file API', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock;

    const result = await saveSurveyResponse({
      participant_id: 'p_test',
      project_id: 'proj_deployed',
      responses: { safety: 4 },
      displayed_images: { safety: ['https://example.test/a.jpg'] },
      survey_metadata: { completion_code: 'ABC123' },
    });

    expect(result.success).toBe(false);
    expect(result.storage).toBe('none');
    const fileCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/responses'));
    expect(fileCalls).toEqual([]);
  });
});
