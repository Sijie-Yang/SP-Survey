const fs = require('fs-extra');
const os = require('os');
const path = require('path');

process.env.SP_SURVEY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'silicon-keys-'));

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

  test('does not write Silicon API keys to disk', async () => {
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
        apiKey: 'sk-test-should-not-persist',
      },
    }, created);
    if (created.statusCode !== 200) {
      throw new Error(`create run failed: ${JSON.stringify(created.payload)}`);
    }
    expect(created.statusCode).toBe(200);
    expect(created.payload.run.apiKey).toBeUndefined();
    const stored = JSON.parse(await fs.readFile(path.join(tmp, 'proj_demo.silicon.json'), 'utf8'));
    expect(JSON.stringify(stored)).not.toContain('sk-test-should-not-persist');
    expect(stored.runs.every((run) => !run.apiKey)).toBe(true);
  });

  test('rejects image questions with no usable media before starting a run', async () => {
    await fs.writeFile(path.join(tmp, 'proj_media.json'), JSON.stringify({
      name: 'Media',
      surveyConfig: {
        pages: [{
          name: 'p1',
          elements: [{ type: 'imagerating', name: 'comfort', title: 'Comfort', imageCount: 1 }],
        }],
      },
    }), 'utf8');
    const persona = mockRes();
    await handlers['POST /api/agent/silicon/personas']({
      body: { projectId: 'proj_media', name: 'Walker' },
    }, persona);
    const created = mockRes();
    await handlers['POST /api/agent/silicon/runs']({
      body: {
        projectId: 'proj_media',
        personaIds: [persona.payload.persona.id],
        questionNames: ['comfort'],
        apiKey: 'sk-test',
      },
    }, created);
    expect(created.statusCode).toBe(400);
    expect(created.payload.code).toBe('SILICON_NO_MEDIA_SOURCE');
  });

  test('rejects unsupported question types and oversized runs', async () => {
    await fs.writeFile(path.join(tmp, 'proj_big.json'), JSON.stringify({
      name: 'Big',
      surveyConfig: {
        pages: [{
          name: 'p1',
          elements: [
            { type: 'rating', name: 'safety', title: 'Safety', rateMax: 5 },
            { type: 'file', name: 'upload', title: 'Upload' },
          ],
        }],
      },
    }), 'utf8');
    const persona = mockRes();
    await handlers['POST /api/agent/silicon/personas']({
      body: { projectId: 'proj_big', name: 'Walker' },
    }, persona);
    const unsupported = mockRes();
    await handlers['POST /api/agent/silicon/runs']({
      body: {
        projectId: 'proj_big',
        personaIds: [persona.payload.persona.id],
        questionNames: ['upload'],
        apiKey: 'sk-test',
      },
    }, unsupported);
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.payload.code).toBe('SILICON_UNSUPPORTED_QUESTIONS');

    const extras = [];
    for (let i = 0; i < 6; i += 1) {
      const extra = mockRes();
      await handlers['POST /api/agent/silicon/personas']({
        body: { projectId: 'proj_big', name: `P${i}` },
      }, extra);
      extras.push(extra.payload.persona.id);
    }
    const oversized = mockRes();
    await handlers['POST /api/agent/silicon/runs']({
      body: {
        projectId: 'proj_big',
        personaIds: [persona.payload.persona.id, ...extras],
        questionNames: ['safety'],
        repeats: 20,
        apiKey: 'sk-test',
      },
    }, oversized);
    expect(oversized.statusCode).toBe(400);
    expect(oversized.payload.code).toBe('RUN_TOO_LARGE');
  });

  test('freezes a seeded media snapshot instead of taking the first four images', async () => {
    const images = Array.from({ length: 8 }, (_, i) => ({
      url: `https://cdn.example/${i + 1}.jpg`,
      folder: i < 4 ? 'park' : 'street',
    }));
    await fs.writeFile(path.join(tmp, 'proj_assign.json'), JSON.stringify({
      name: 'Assign',
      imageDatasetConfig: { mediaFolderTags: { park: { category: 'green' }, street: { category: 'paved' } } },
      surveyConfig: {
        preloadedImages: images,
        pages: [{
          name: 'p1',
          elements: [{
            type: 'imagerating',
            name: 'comfort',
            title: 'Comfort',
            imageCount: 2,
            mediaFolders: ['park'],
          }],
        }],
      },
    }), 'utf8');
    const persona = mockRes();
    await handlers['POST /api/agent/silicon/personas']({
      body: { projectId: 'proj_assign', name: 'Walker' },
    }, persona);
    const created = mockRes();
    await handlers['POST /api/agent/silicon/runs']({
      body: {
        projectId: 'proj_assign',
        personaIds: [persona.payload.persona.id],
        questionNames: ['comfort'],
        apiKey: 'sk-test',
        seed: 7,
      },
    }, created);
    expect(created.statusCode).toBe(200);
    expect(created.payload.run.seed).toBe(7);
    expect(created.payload.run.media_snapshot.images).toHaveLength(8);
    const stored = JSON.parse(await fs.readFile(path.join(tmp, 'proj_assign.silicon.json'), 'utf8'));
    expect(stored.units[created.payload.run.id]).toHaveLength(1);
    expect(stored.units[created.payload.run.id][0].trial_index).toBe(1);
  });
});
