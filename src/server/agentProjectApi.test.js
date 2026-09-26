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
      delete: (route, handler) => { handlers[`DELETE ${route}`] = handler; },
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
      delete: (route, handler) => { handlers[`DELETE ${route}`] = handler; },
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

  test('applies incremental operations to the local draft', async () => {
    const projectsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-survey-agent-ops-'));
    const projectId = 'proj_ops';
    await fs.writeJson(path.join(projectsPath, `${projectId}.json`), {
      project: { id: projectId, name: 'Ops' },
      surveyConfig: { pages: [{ name: 'page1', elements: [] }] },
      savedAt: '2026-01-01T00:00:00.000Z',
      draftUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    const handlers = {};
    const app = {
      use: (route, handler) => { handlers[`USE ${route}`] = handler; },
      get: (route, handler) => { handlers[`GET ${route}`] = handler; },
      patch: (route, handler) => { handlers[`PATCH ${route}`] = handler; },
      post: (route, handler) => { handlers[`POST ${route}`] = handler; },
      delete: (route, handler) => { handlers[`DELETE ${route}`] = handler; },
    };
    registerAgentProjectApi(app, { fs, projectsPath, clientOrigin: 'http://localhost:3000' });
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await handlers['POST /api/agent/projects/:projectId/operations']({
      params: { projectId },
      body: {
        expectedDraftUpdatedAt: '2026-01-01T00:00:00.000Z',
        operations: [{
          op: 'addQuestion',
          pageName: 'page1',
          question: { type: 'rating', name: 'comfort', title: 'Comfort' },
        }],
      },
    }, response);
    expect(response.statusCode).toBe(200);
    expect(response.payload.applied[0].op).toBe('addQuestion');
    expect(response.payload.inverse[0].op).toBe('removeQuestion');
    const updated = await fs.readJson(path.join(projectsPath, `${projectId}.json`));
    expect(updated.surveyConfig.pages[0].elements[0].name).toBe('comfort');
    await fs.remove(projectsPath);
  });

  test('creates from a template, duplicates, exports, imports, and summarizes local results', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-survey-agent-life-'));
    const projectsPath = path.join(root, 'projects');
    const templatesPath = path.join(root, 'templates');
    const userTemplatesPath = path.join(root, 'user-templates');
    const responsesPath = path.join(root, 'responses');
    await fs.ensureDir(projectsPath);
    await fs.ensureDir(templatesPath);
    await fs.ensureDir(userTemplatesPath);
    await fs.ensureDir(responsesPath);
    await fs.writeJson(path.join(templatesPath, '2025-demo-walk.json'), {
      id: '2025-demo-walk',
      name: 'Walk study',
      description: 'A street walk',
      author: 'Demo',
      year: '2025',
      category: 'Custom',
      tags: ['official'],
      config: {
        title: 'Walk study',
        pages: [{ name: 'page1', elements: [{ type: 'rating', name: 'comfort', rateMin: 1, rateMax: 5 }] }],
      },
    });

    const handlers = {};
    const app = {
      use: (route, handler) => { handlers[`USE ${route}`] = handler; },
      get: (route, handler) => { handlers[`GET ${route}`] = handler; },
      patch: (route, handler) => { handlers[`PATCH ${route}`] = handler; },
      post: (route, handler) => { handlers[`POST ${route}`] = handler; },
      delete: (route, handler) => { handlers[`DELETE ${route}`] = handler; },
    };
    registerAgentProjectApi(app, {
      fs,
      projectsPath,
      templatesPath,
      userTemplatesPath,
      responsesPath,
      clientOrigin: 'http://localhost:3000',
    });
    const response = () => ({
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    });

    const listed = response();
    await handlers['GET /api/agent/templates']({}, listed);
    expect(listed.payload.templates[0]).toMatchObject({
      id: '2025-demo-walk',
      name: 'Walk study',
      isApproved: true,
    });

    const created = response();
    await handlers['POST /api/agent/projects/from-template']({
      body: { templateId: '2025-demo-walk' },
    }, created);
    expect(created.statusCode).toBe(201);
    expect(created.payload.project.name).toBe('Walk study');
    expect(created.payload.note).toMatch(/media was not copied/i);
    expect(created.payload.surveyConfig.pages[0].elements[0].name).toBe('comfort');
    const projectId = created.payload.project.id;

    const exported = response();
    await handlers['GET /api/agent/projects/:projectId/export']({ params: { projectId } }, exported);
    expect(exported.payload.package.surveyConfig.pages[0].elements[0].name).toBe('comfort');
    expect(exported.payload.package.project).not.toHaveProperty('supabaseConfig');

    const imported = response();
    await handlers['POST /api/agent/projects/import']({
      body: exported.payload,
    }, imported);
    expect(imported.statusCode).toBe(201);
    expect(imported.payload.project.id).not.toBe(projectId);

    const secrets = response();
    await handlers['POST /api/agent/projects/import']({
      body: { name: 'Bad', surveyConfig: { pages: [] }, apiKey: 'secret' },
    }, secrets);
    expect(secrets.statusCode).toBe(400);
    expect(secrets.payload.secretFields).toContain('apiKey');

    const copied = response();
    await handlers['POST /api/agent/projects/:projectId/duplicate']({
      params: { projectId },
      body: {},
    }, copied);
    expect(copied.statusCode).toBe(201);
    expect(copied.payload.project.name).toBe('Walk study (Copy)');

    const saveTpl = response();
    await handlers['POST /api/agent/projects/:projectId/save-as-template']({
      params: { projectId },
      body: { confirm: true, author: 'Researcher' },
    }, saveTpl);
    expect(saveTpl.payload.success).toBe(true);
    expect(saveTpl.payload.status).toBe('saved');
    expect(await fs.pathExists(path.join(userTemplatesPath, `${saveTpl.payload.templateId}.json`))).toBe(true);

    await fs.writeJson(path.join(responsesPath, 'response_one.json'), {
      id: 'r1',
      project_id: projectId,
      participant_id: 'p1',
      created_at: '2026-01-02T00:00:00.000Z',
      responses: { comfort: 4 },
      survey_metadata: { practice_mode: false },
    });
    await fs.writeJson(path.join(responsesPath, 'response_practice.json'), {
      id: 'r2',
      project_id: projectId,
      participant_id: 'p2',
      created_at: '2026-01-03T00:00:00.000Z',
      responses: { comfort: 2 },
      survey_metadata: { practice_mode: true },
    });

    const listedResponses = response();
    await handlers['GET /api/agent/projects/:projectId/responses']({
      params: { projectId },
      query: {},
    }, listedResponses);
    expect(listedResponses.payload.total).toBe(1);
    expect(listedResponses.payload.responses[0].answer_question_count).toBe(1);

    const exportedCsv = response();
    await handlers['GET /api/agent/projects/:projectId/responses/export']({
      params: { projectId },
      query: { format: 'wide_csv' },
    }, exportedCsv);
    expect(exportedCsv.payload.n).toBe(1);
    expect(exportedCsv.payload.wideCsv).toContain('comfort');
    expect(exportedCsv.payload.wideCsv).toContain('4');

    const summary = response();
    await handlers['GET /api/agent/projects/:projectId/results/summary']({
      params: { projectId },
      query: { view: 'overview' },
    }, summary);
    expect(summary.payload.n_total).toBe(2);
    expect(summary.payload.n_in_export).toBe(1);
    expect(summary.payload.questions[0]).toMatchObject({ name: 'comfort', type: 'rating', n_answered: 1 });

    await fs.remove(root);
  });
});
