const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { createProjectIo } = require('./agentProjectApi');
const { registerSiliconLocalApi } = require('./siliconLocalApi');

function mockApp() {
  const handlers = {};
  const app = {
    use() {},
    get(route, handler) { handlers[`GET ${route}`] = handler; },
    post(route, handler) { handlers[`POST ${route}`] = handler; },
    delete(route, handler) { handlers[`DELETE ${route}`] = handler; },
  };
  return { app, handlers };
}

function mockRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

describe('local Silicon API', () => {
  let tmp;
  let handlers;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'silicon-'));
    await fs.writeFile(path.join(tmp, 'proj_demo.json'), JSON.stringify({
      name: 'Demo',
      surveyConfig: {
        pages: [{ name: 'p1', elements: [{ type: 'rating', name: 'safety', title: 'Safety', rateMax: 5 }] }],
      },
    }), 'utf8');
    const { app, handlers: next } = mockApp();
    registerSiliconLocalApi(app, {
      fs,
      projectsPath: tmp,
      createProjectIo: () => createProjectIo({ fs, projectsPath: tmp }),
    });
    handlers = next;
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  test('stores personas locally and lists them', async () => {
    const created = mockRes();
    await handlers['POST /api/agent/silicon/personas']({
      body: { projectId: 'proj_demo', name: 'Walker', attributes: { city: 'Singapore' } },
    }, created);
    expect(created.statusCode).toBe(200);
    expect(created.payload.persona.name).toBe('Walker');

    const listed = mockRes();
    await handlers['GET /api/agent/silicon/personas']({ query: { projectId: 'proj_demo' } }, listed);
    expect(listed.payload.personas).toHaveLength(1);
    expect(listed.payload.personas[0].prompt).toContain('Singapore');
  });

  test('rejects a run without the researcher API key', async () => {
    const persona = mockRes();
    await handlers['POST /api/agent/silicon/personas']({
      body: { projectId: 'proj_demo', name: 'Walker' },
    }, persona);
    const created = mockRes();
    await handlers['POST /api/agent/silicon/runs']({
      body: {
        projectId: 'proj_demo',
        personaIds: [persona.payload.persona.id],
        questionNames: ['safety'],
      },
    }, created);
    expect(created.statusCode).toBe(400);
    expect(created.payload.error).toMatch(/API key/i);
  });
});
