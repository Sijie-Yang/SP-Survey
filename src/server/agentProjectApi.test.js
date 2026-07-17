const {
  buildProjectUrls,
  createDefaultSurveyConfig,
  findSecretFields,
  isLoopbackAddress,
  isSafeProjectId,
  restoreStoredSecrets,
  sanitizeForAgent,
  validateSurveyConfig,
} = require('./agentProjectApi');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { registerAgentProjectApi } = require('./agentProjectApi');

describe('SP-Survey local agent API contract', () => {
  test('validates pages and unique question names', () => {
    const valid = validateSurveyConfig({
      pages: [{ name: 'intro', elements: [{ type: 'rating', name: 'safety' }] }],
    });
    expect(valid).toMatchObject({ valid: true, pageCount: 1, questionCount: 1 });

    const duplicate = validateSurveyConfig({
      pages: [{
        name: 'study',
        elements: [
          { type: 'rating', name: 'safety' },
          { type: 'comment', name: 'safety' },
        ],
      }],
    });
    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors[0].message).toContain('Duplicate question name');
  });

  test('removes credentials from reads and preserves stored credentials on writes', () => {
    const stored = {
      title: 'Study',
      integration: { apiKey: 'keep-me', model: 'example' },
    };
    expect(sanitizeForAgent(stored)).toEqual({
      title: 'Study',
      integration: { model: 'example' },
    });
    expect(findSecretFields({ integration: { apiKey: 'do-not-send' } })).toEqual(['integration.apiKey']);
    expect(restoreStoredSecrets({
      title: 'Revised study',
      integration: { model: 'revised' },
    }, stored)).toEqual({
      title: 'Revised study',
      integration: { apiKey: 'keep-me', model: 'revised' },
    });
  });

  test('accepts only safe project ids and returns direct application URLs', () => {
    expect(isSafeProjectId('proj_123-abc')).toBe(true);
    expect(isSafeProjectId('../secret')).toBe(false);
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.0.2.10')).toBe(false);
    expect(buildProjectUrls('proj_123', 'http://localhost:3000/')).toEqual({
      admin: 'http://localhost:3000/admin',
      liveSurvey: 'http://localhost:3000/survey?project=proj_123',
    });
    expect(validateSurveyConfig(createDefaultSurveyConfig('New study')).valid).toBe(true);
  });

  test('creates a credential-free local project through the agent API', async () => {
    const projectsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-survey-agent-create-'));
    const handlers = {};
    const app = {
      use: (route, handler) => { handlers[`USE ${route}`] = handler; },
      get: (route, handler) => { handlers[`GET ${route}`] = handler; },
      patch: (route, handler) => { handlers[`PATCH ${route}`] = handler; },
      post: (route, handler) => { handlers[`POST ${route}`] = handler; },
    };
    registerAgentProjectApi(app, { fs, projectsPath, clientOrigin: 'http://localhost:3000' });
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };

    await handlers['POST /api/agent/projects']({
      body: {
        name: 'Created by agent',
        description: 'A local study',
        surveyConfig: {
          title: 'Created by agent',
          pages: [{ name: 'page1', elements: [{ type: 'rating', name: 'comfort' }] }],
        },
      },
    }, response);

    expect(response.statusCode).toBe(201);
    expect(response.payload.project.name).toBe('Created by agent');
    expect(Object.prototype.hasOwnProperty.call(response.payload.project, 'supabaseConfig')).toBe(false);
    expect(response.payload.urls.liveSurvey).toContain(response.payload.project.id);
    const stored = await fs.readJson(path.join(projectsPath, `${response.payload.project.id}.json`));
    expect(stored.project.imageDatasetConfig.supabaseKey).toBe('');
    expect(stored.surveyConfig.pages[0].elements[0].name).toBe('comfort');
    await fs.remove(projectsPath);
  });

  test('patches only surveyConfig, creates a backup, and keeps stored credentials', async () => {
    const projectsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-survey-agent-'));
    const projectId = 'proj_test';
    const stored = {
      project: {
        id: projectId,
        name: 'Agent test',
        supabaseConfig: { supabaseKey: 'project-secret' },
      },
      surveyConfig: {
        pages: [{
          name: 'original',
          elements: [{ type: 'rating', name: 'rating', apiKey: 'question-secret' }],
        }],
      },
      supabaseConfig: { serviceRoleKey: 'root-secret' },
      savedAt: '2026-01-01T00:00:00.000Z',
    };
    await fs.writeJson(path.join(projectsPath, `${projectId}.json`), stored);

    const handlers = {};
    const app = {
      use: (route, handler) => { handlers[`USE ${route}`] = handler; },
      get: (route, handler) => { handlers[`GET ${route}`] = handler; },
      patch: (route, handler) => { handlers[`PATCH ${route}`] = handler; },
      post: (route, handler) => { handlers[`POST ${route}`] = handler; },
    };
    registerAgentProjectApi(app, { fs, projectsPath, clientOrigin: 'http://localhost:3000' });

    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await handlers['PATCH /api/agent/projects/:projectId/survey']({
      params: { projectId },
      body: {
        expectedSavedAt: stored.savedAt,
        surveyConfig: {
          pages: [{
            name: 'revised',
            elements: [{ type: 'rating', name: 'rating' }],
          }],
        },
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({ success: true, projectId });
    const updated = await fs.readJson(path.join(projectsPath, `${projectId}.json`));
    expect(updated.project.supabaseConfig.supabaseKey).toBe('project-secret');
    expect(updated.supabaseConfig.serviceRoleKey).toBe('root-secret');
    expect(updated.surveyConfig.pages[0].name).toBe('revised');
    expect(updated.surveyConfig.pages[0].elements[0].apiKey).toBe('question-secret');
    expect(await fs.pathExists(path.join(projectsPath, response.payload.backup))).toBe(true);

    await fs.remove(projectsPath);
  });
});
