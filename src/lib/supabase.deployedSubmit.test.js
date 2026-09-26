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

describe('deployed participant supabase rpc payload', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.dontMock('@supabase/supabase-js');
  });

  test('submit_survey_response gets displayed_images, categories, and the snapshot project id', async () => {
    const rpc = jest.fn(async () => ({ data: { id: 'row-1', deduped: false }, error: null }));
    jest.resetModules();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        rpc,
        from: jest.fn(),
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseKey: 'anon-key-for-tests-123456',
      }),
    }));
    process.env = {
      ...originalEnv,
      REACT_APP_SUPABASE_URL: 'http://127.0.0.1:54321',
      REACT_APP_SUPABASE_ANON_KEY: 'anon-key-for-tests-123456',
    };
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const { saveSurveyResponse } = require('./supabase');
    const result = await saveSurveyResponse({
      participant_id: 'p_test',
      project_id: 'proj_1790395257759_zg721qdtz',
      responses: {
        qa_imagerating: { trials: [{ shown_media_categories: ['park', 'street'] }] },
      },
      displayed_images: { qa_imagerating: ['https://example.test/a.jpg'] },
      displayed_media_categories: { qa_imagerating: ['park', 'street'] },
      survey_metadata: { completion_code: 'ABC123' },
    });

    expect(result.success).toBe(true);
    expect(result.storage).toBe('supabase');
    expect(rpc).toHaveBeenCalledWith('submit_survey_response', {
      p_response: expect.objectContaining({
        project_id: 'proj_1790395257759_zg721qdtz',
        displayed_images: { qa_imagerating: ['https://example.test/a.jpg'] },
        displayed_media_categories: { qa_imagerating: ['park', 'street'] },
      }),
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/responses'))).toEqual([]);
  });
});
