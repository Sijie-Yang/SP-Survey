import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { protocolForPath, stubResponse } from './agentRuntime/__fixtures__/providerStubs.mjs';

const require = createRequire(import.meta.url);
const fs = require('fs-extra');
const express = require('express');

const KEY = 'sk-local-stub-key-9876';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-survey-chat-'));
process.env.SP_SURVEY_DATA_DIR = path.join(tmp, 'data');
const projectsPath = path.join(tmp, 'projects');
await fs.ensureDir(projectsPath);

const { registerAgentCredentialsApi, STORE_PATH } = require('./agentCredentialsApi');
const { registerAgentChatApi } = require('./agentChatRuntime');
const { createProjectIo } = require('./agentProjectApi');

const PROJECT_ID = 'proj_stub';
await fs.writeJson(path.join(projectsPath, `${PROJECT_ID}.json`), {
  project: { id: PROJECT_ID, name: 'Stub study' },
  surveyConfig: { title: 'Stub study', pages: [{ name: 'p1', elements: [{ type: 'rating', name: 'safety' }] }] },
  savedAt: '2026-09-01T00:00:00.000Z',
});

const received = [];
let providerServer;
let appServer;
let providerBase;
let appBase;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function api(route, init = {}) {
  const response = await fetch(`${appBase}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
  return response.json();
}

async function waitForRun(sessionId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session = await api(`/api/agent/sessions/${sessionId}`);
    if (['completed', 'failed', 'cancelled'].includes(session.run?.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Run did not finish');
}

before(async () => {
  providerServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://127.0.0.1');
    const protocol = protocolForPath(url.pathname);
    const hasToolResult = /Stub study/.test(body);
    received.push({ path: url.pathname, headers: req.headers, body, protocol });
    const reply = hasToolResult
      ? stubResponse(protocol, { text: 'The draft has one rating question.' })
      : stubResponse(protocol, { text: '', toolCall: { name: 'survey_get_draft', args: { view: 'catalog' } } });
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    res.end(await reply.text());
  });
  providerBase = `http://127.0.0.1:${await listen(providerServer)}`;

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerAgentCredentialsApi(app);
  registerAgentChatApi(app, {
    createProjectIo: () => createProjectIo({ fs, projectsPath }),
    fs,
    projectsPath,
    skillsPath: path.join(tmp, 'skills'),
    clientOrigin: 'http://localhost:3000',
  });
  appServer = http.createServer(app);
  appBase = `http://127.0.0.1:${await listen(appServer)}`;
});

after(async () => {
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => providerServer.close(resolve));
  await fs.remove(tmp);
});

async function runAssistant(provider, model) {
  const started = await api('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ projectId: PROJECT_ID, message: 'What is in my draft?', provider, model }),
  });
  assert.equal(started.success, true, JSON.stringify(started));
  return waitForRun(started.sessionId);
}

describe('local server chat path against a local provider stub', () => {
  for (const protocol of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    it(`runs the Assistant tool loop over ${protocol}`, async () => {
      const provider = `stub-${protocol.split('-')[0]}-${protocol.split('-')[1]}`;
      const saved = await api('/api/agent/credentials/providers', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          apiKey: KEY,
          baseUrl: protocol === 'anthropic-messages' ? providerBase : `${providerBase}/v1`,
          protocol,
          custom: true,
          displayName: `Stub ${protocol}`,
          models: [{ id: 'stub-model', name: 'Stub model', input: ['text'] }],
        }),
      });
      assert.equal(saved.success, true, JSON.stringify(saved));
      received.length = 0;
      const session = await runAssistant(provider, 'stub-model');
      assert.equal(session.run.status, 'completed', session.run.error);
      assert.equal(session.run.result.message, 'The draft has one rating question.');
      assert.equal(received.length, 2);
      assert.ok(received.every((request) => request.protocol === protocol));
      const auth = received[0].headers['x-api-key'] || received[0].headers.authorization;
      assert.match(auth, new RegExp(KEY));
      assert.match(received[0].body, /"stub-model"/);
      assert.match(received[1].body, /survey_get_draft/);
      assert.ok(session.events.some((event) => event.type === 'tool.result' && event.payload.name === 'survey_get_draft'));
    });
  }

  it('routes a catalog provider with a user endpoint (Cloudflare Workers AI) to that endpoint', async () => {
    await api('/api/agent/credentials/providers', {
      method: 'POST',
      body: JSON.stringify({ provider: 'cloudflare-workers-ai', apiKey: KEY, baseUrl: `${providerBase}/client/v4/accounts/acct/ai/v1` }),
    });
    received.length = 0;
    const status = await api('/api/agent/credentials/status');
    const cloudflare = status.directory.find((row) => row.id === 'cloudflare-workers-ai');
    assert.ok(cloudflare.models.length > 0);
    assert.ok(cloudflare.models.every((model) => model.runtimeSupported));
    const session = await runAssistant('cloudflare-workers-ai', cloudflare.defaultModels.assistant);
    assert.equal(session.run.status, 'completed', session.run.error);
    assert.equal(received[0].path, '/client/v4/accounts/acct/ai/v1/chat/completions');
    assert.equal(received[0].headers.authorization, `Bearer ${KEY}`);
  });

  it('fails clearly when the selected provider has no key', async () => {
    const session = await runAssistant('anthropic', 'claude-sonnet-5');
    assert.equal(session.run.status, 'failed');
    assert.match(session.run.error, /API key is required/);
  });
});

describe('local key storage', () => {
  it('never returns key material from settings reads', async () => {
    const status = await api('/api/agent/credentials/status');
    const text = JSON.stringify(status);
    assert.equal(text.includes(KEY), false);
    assert.ok(status.directory.find((row) => row.id === 'cloudflare-workers-ai').hint);
    const models = await api('/api/agent/credentials/models?provider=cloudflare-workers-ai');
    assert.equal(JSON.stringify(models).includes(KEY), false);
  });

  it('keeps keys outside public/ so participant deploy packages never copy them', async () => {
    const stored = await fs.readJson(STORE_PATH);
    assert.equal(Object.values(stored.providers).some((row) => row.apiKey === KEY), true);
    const repoPublic = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'public');
    assert.equal(path.resolve(STORE_PATH).startsWith(repoPublic), false);
    const defaultStore = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
    assert.equal(defaultStore.startsWith(repoPublic), false);
  });

  it('ignores key fields on profile updates', async () => {
    await api('/api/agent/credentials/profiles', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'cloudflare-workers-ai', apiKey: 'sk-injected', hint: 'fake', retryPolicy: { maxRetries: 2 } }),
    });
    const stored = await fs.readJson(STORE_PATH);
    assert.equal(stored.providers['cloudflare-workers-ai'].apiKey, KEY);
    assert.equal(stored.providers['cloudflare-workers-ai'].retryPolicy.maxRetries, 2);
  });

  it('refuses native-auth providers', async () => {
    const saved = await api('/api/agent/credentials/providers', {
      method: 'POST',
      body: JSON.stringify({ provider: 'amazon-bedrock', apiKey: KEY }),
    });
    assert.equal(saved.success, false);
    assert.equal(saved.code, 'AUTH_UNSUPPORTED');
  });
});
