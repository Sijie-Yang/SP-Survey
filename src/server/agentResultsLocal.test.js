const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const {
  parseResultsQuery,
  listResponses,
  exportResponses,
  summarizeResponses,
} = require('./agentResultsLocal');

describe('local agent results helpers', () => {
  test('parses MCP-style result query defaults', () => {
    expect(parseResultsQuery({})).toMatchObject({
      view: 'overview',
      dataSource: 'live',
      includePractice: false,
      limit: 100,
      offset: 0,
    });
    expect(parseResultsQuery({ view: 'question', questionName: 'comfort', includePractice: 'true' })).toMatchObject({
      view: 'question',
      questionName: 'comfort',
      includePractice: true,
    });
  });

  test('lists, exports, and summarizes local response files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-survey-results-'));
    const responsesPath = path.join(root, 'responses');
    const projectsPath = path.join(root, 'projects');
    await fs.ensureDir(responsesPath);
    await fs.ensureDir(projectsPath);
    await fs.writeJson(path.join(responsesPath, 'a.json'), {
      id: 'a',
      project_id: 'proj_1',
      participant_id: 'p1',
      created_at: '2026-02-01T00:00:00.000Z',
      responses: { comfort: { answer: 5 } },
    });
    await fs.writeJson(path.join(responsesPath, 'other.json'), {
      id: 'b',
      project_id: 'proj_other',
      participant_id: 'p2',
      responses: { comfort: 1 },
    });
    const surveyConfig = {
      pages: [{ name: 'page1', elements: [{ type: 'rating', name: 'comfort' }] }],
    };
    const listed = await listResponses(fs, { responsesPath, projectsPath, surveyConfig }, 'proj_1', {
      includeAnswers: true,
    });
    expect(listed.total).toBe(1);
    expect(listed.responses[0].responses.comfort).toEqual({ answer: 5 });

    const exported = await exportResponses(fs, { responsesPath, projectsPath, surveyConfig }, 'proj_1', {
      format: 'both',
    });
    expect(exported.n).toBe(1);
    expect(exported.responses[0].id).toBe('a');
    expect(exported.wideCsv).toContain('comfort');

    const summary = await summarizeResponses(fs, {
      responsesPath,
      projectsPath,
      surveyConfig,
      projectName: 'Walk',
    }, 'proj_1', { view: 'overview' });
    expect(summary.projectName).toBe('Walk');
    expect(summary.n_total).toBe(1);
    expect(summary.questions[0].n_answered).toBe(1);
    await fs.remove(root);
  });
});
