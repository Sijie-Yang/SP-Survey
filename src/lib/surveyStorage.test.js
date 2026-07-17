import { API_ROOT } from './apiConfig';
import { loadSurveyConfig } from './surveyStorage';

describe('self-hosted survey config storage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('loads survey JSON from the local API and normalizes legacy booleans', async () => {
    const surveyConfig = {
      title: 'Self-hosted survey',
      showQuestionNumbers: true,
      showProgressBar: false,
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true, surveyConfig }),
    });

    const result = await loadSurveyConfig('project-123');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(`${API_ROOT}/projects/project-123`);
    expect(result).toEqual({
      title: 'Self-hosted survey',
      showQuestionNumbers: 'on',
      showProgressBar: 'off',
    });
  });

  test('returns null when the local project API has no survey config', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    await expect(loadSurveyConfig('missing')).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
