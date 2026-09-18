const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { createProjectIo } = require('./agentProjectApi');
const { registerSiliconLocalApi } = require('./siliconLocalApi');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function json(server, method, url, body) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

describe('local Silicon API', () => {
  let tmp;
  let server;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'silicon-'));
    await fs.writeFile(path.join(tmp, 'proj_demo.json'), JSON.stringify({
      name: 'Demo',
      surveyConfig: {
        pages: [{ name: 'p1', elements: [{ type: 'rating', name: 'safety', title: 'Safety', rateMax: 5 }] }],
      },
    }), 'utf8');
    const app = express();
    app.use(express.json());
    registerSiliconLocalApi(app, {
      fs,
      projectsPath: tmp,
      createProjectIo: () => createProjectIo({ fs, projectsPath: tmp }),
    });
    server = await listen(app);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.remove(tmp);
  });

  test('stores personas locally and lists them', async () => {
    const created = await json(server, 'POST', '/api/agent/silicon/personas', {
      projectId: 'proj_demo',
      name: 'Walker',
      attributes: { city: 'Singapore' },
    });
    expect(created.status).toBe(200);
    expect(created.data.persona.name).toBe('Walker');
    const listed = await json(server, 'GET', '/api/agent/silicon/personas?projectId=proj_demo');
    expect(listed.data.personas).toHaveLength(1);
    expect(listed.data.personas[0].prompt).toContain('Singapore');
  });

  test('rejects a run without the researcher API key', async () => {
    const persona = await json(server, 'POST', '/api/agent/silicon/personas', {
      projectId: 'proj_demo',
      name: 'Walker',
    });
    const created = await json(server, 'POST', '/api/agent/silicon/runs', {
      projectId: 'proj_demo',
      personaIds: [persona.data.persona.id],
      questionNames: ['safety'],
    });
    expect(created.status).toBe(400);
    expect(created.data.error).toMatch(/API key/i);
  });
});
