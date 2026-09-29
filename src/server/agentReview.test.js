/**
 * @jest-environment node
 */
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-review-'));
process.env.SP_AGENT_SESSIONS_PATH = path.join(tmp, 'agent-sessions.json');
if (!globalThis.fetch) {
  globalThis.fetch = async () => { throw new Error('Network is disabled in tests; the chat function is injected.'); };
}

const http = require('http');
const express = require('express');
const review = require('./agentReview');
const { applyOperations } = require('./surveyOperations.cjs');
const { createProjectIo } = require('./agentProjectApi');
const { registerAgentChatApi, eventsToMessages } = require('./agentChatRuntime');

const SURVEY = {
  title: 'Street safety',
  pages: [{
    name: 'p1',
    elements: [
      { type: 'text', name: 'q1', title: 'How safe is this street?' },
      { type: 'comment', name: 'q2', title: 'Why?' },
    ],
  }],
};
const REWORD = [{ op: 'updateQuestion', pageName: 'p1', questionName: 'q1', patch: { title: 'How safe do you feel on this street?' } }];

const clone = (value) => JSON.parse(JSON.stringify(value));
const validate = (config) => ({ valid: Array.isArray(config?.pages) });
const dryRun = (config, ops) => review.dryRunRevision(applyOperations, validate, config, ops);

function harness({ ratings = {}, fail = [], cancelAfter = Infinity, applyError = null } = {}) {
  const events = [];
  const calls = [];
  let saved = { surveyConfig: clone(SURVEY), draftUpdatedAt: 't0' };
  let roleCalls = 0;
  return {
    events,
    calls,
    get saved() { return saved; },
    options: {
      readDraft: async () => clone(saved),
      runRole: async (args) => {
        roleCalls += 1;
        calls.push({ kind: 'role', role: args.role, round: args.round, prior: args.priorTurns.map((turn) => turn.role), source: args.surveySource });
        if (fail.includes(args.role)) throw new Error(`${args.role} provider 500`);
        const rating = ratings[`${args.role}:${args.round}`] ?? ratings[args.role] ?? 9;
        return { review: review.parseRoleReview({ rating, verdict: 'revise', comments: `${args.role} ok` }), steps: 2, usage: { prompt_tokens: 10, completion_tokens: 5 } };
      },
      runRevision: async (args) => {
        calls.push({ kind: 'revision', round: args.round });
        return { revision: { summary: `Round ${args.round}`, plan: [{ step: 'Reword q1' }], operations: REWORD }, steps: 1 };
      },
      dryRun,
      applyRevision: async ({ operations, expectedDraftUpdatedAt }) => {
        calls.push({ kind: 'apply', expectedDraftUpdatedAt });
        if (applyError) throw applyError;
        saved = { surveyConfig: applyOperations(saved.surveyConfig, operations).surveyConfig, draftUpdatedAt: `${saved.draftUpdatedAt}+` };
        return clone(saved);
      },
      emit: async (type, payload) => { events.push({ type, payload, runId: 'run-1', seq: events.length + 1 }); },
      checkCancelled: async () => roleCalls >= cancelAfter,
    },
  };
}

describe('review orchestration (local)', () => {
  test('fans out all five roles by default and accepts at the threshold', async () => {
    const h = harness();
    const outcome = await review.runReviewOrchestration({ ...h.options, options: {} });
    expect(outcome.result.status).toBe('accepted');
    expect(h.calls.map((call) => call.role)).toEqual(['scientist', 'participant', 'planner', 'psychologist', 'analyst']);
  });

  test('group discussion passes earlier turns; linear does not', async () => {
    const group = harness();
    await review.runReviewOrchestration({ ...group.options, options: { roles: ['scientist', 'participant'], method: 'group' } });
    expect(group.calls.map((call) => call.prior)).toEqual([[], ['scientist']]);
    const linear = harness();
    await review.runReviewOrchestration({ ...linear.options, options: { roles: ['scientist', 'participant'] } });
    expect(linear.calls.map((call) => call.prior)).toEqual([[], []]);
  });

  test('one failing reviewer does not stop the others', async () => {
    const h = harness({ fail: ['participant'] });
    const outcome = await review.runReviewOrchestration({ ...h.options, options: { roles: ['scientist', 'participant', 'analyst'] } });
    expect(outcome.result.status).toBe('accepted');
    const ends = h.events.filter((event) => event.type === 'review.role' && event.payload.status !== 'start');
    expect(ends.map((event) => event.payload.status)).toEqual(['completed', 'failed', 'completed']);
  });

  test('cancel partway stops before later roles', async () => {
    const h = harness({ cancelAfter: 1 });
    await expect(review.runReviewOrchestration({ ...h.options, options: {} })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(h.calls.map((call) => call.role)).toEqual(['scientist']);
  });

  test('review-only re-reviews the candidate; apply-each-round saves with the baseline stamp', async () => {
    const proposed = harness({ ratings: { 'scientist:1': 4, 'scientist:2': 9 } });
    const first = await review.runReviewOrchestration({ ...proposed.options, options: { roles: ['scientist'], maxRounds: 3 } });
    expect(first.result).toMatchObject({ status: 'accepted', pendingRounds: [1] });
    expect(proposed.calls.find((call) => call.round === 2).source).toBe('candidate');
    expect(proposed.saved.draftUpdatedAt).toBe('t0');

    const applied = harness({ ratings: { scientist: 4 } });
    const second = await review.runReviewOrchestration({ ...applied.options, options: { roles: ['scientist'], maxRounds: 2, applyMode: 'apply' } });
    expect(second.result.status).toBe('max_rounds');
    expect(applied.calls.filter((call) => call.kind === 'apply').map((call) => call.expectedDraftUpdatedAt)).toEqual(['t0', 't0+']);
  });

  test('a stale draft stops apply-each-round with a conflict', async () => {
    const stale = Object.assign(new Error('Draft changed after it was read.'), { code: 'STALE_DRAFT' });
    const h = harness({ ratings: { scientist: 4 }, applyError: stale });
    const outcome = await review.runReviewOrchestration({ ...h.options, options: { roles: ['scientist'], applyMode: 'apply' } });
    expect(outcome.result.status).toBe('conflict');
  });

  test('apply with inverse operations restores the original survey', () => {
    const next = applyOperations(SURVEY, REWORD);
    expect(applyOperations(next.surveyConfig, next.inverse).surveyConfig).toEqual(SURVEY);
  });
});

function reply(name, args) {
  return {
    choices: [{ message: { content: '', tool_calls: [{ id: `call_${Math.random().toString(36).slice(2)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

describe('review mode on the local runtime', () => {
  let server;
  let base;
  const projectsPath = path.join(tmp, 'projects');
  const prompts = [];
  let chatBehavior = null;

  beforeAll(async () => {
    await fs.ensureDir(projectsPath);
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    registerAgentChatApi(app, {
      createProjectIo: () => createProjectIo({ fs, projectsPath }),
      fs,
      projectsPath,
      skillsPath: path.join(tmp, 'skills'),
      clientOrigin: 'http://localhost:3000',
      chat: async (_resolved, _tier, request) => {
        prompts.push(JSON.stringify(request.messages));
        return chatBehavior(request);
      },
    });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.remove(tmp);
  });

  async function seedProject(id) {
    await fs.writeJson(path.join(projectsPath, `${id}.json`), {
      project: { id, name: 'Street' },
      surveyConfig: { ...clone(SURVEY), integration: { supabaseAnonKey: 'secret-anon-key-123' } },
      draftUpdatedAt: '2026-01-01T00:00:00.000Z',
      savedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  const request = (method, route, body) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(`${base}${route}`, {
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text || '{}') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
  const post = (route, body) => request('POST', route, body || {});
  const get = (route) => request('GET', route).then((res) => res.body);

  async function waitFor(sessionId, predicate) {
    for (let index = 0; index < 100; index += 1) {
      const detail = await get(`/api/agent/sessions/${sessionId}`);
      if (predicate(detail)) return detail;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const last = await get(`/api/agent/sessions/${sessionId}`);
    throw new Error(`timed out: ${JSON.stringify(last.run)} ${JSON.stringify(last.events.filter((e) => e.type === 'error'))}`);
  }

  function defaultChat({ failRole = null, ratings = { 1: 5, 2: 9 } } = {}) {
    return (request) => {
      const system = request.messages[0].content;
      const tools = request.tools.map((tool) => tool.function.name);
      if (tools.includes('review_submit_revision')) {
        return reply('review_submit_revision', { summary: 'Clarify q1', plan: [{ step: 'Reword q1', roles: ['psychologist'], questions: ['q1'] }], operations: REWORD });
      }
      if (failRole && system.includes(`${failRole} on an SP-Survey review panel`)) throw new Error('upstream 500');
      const round = Number(/Review round (\d+)/.exec(request.messages[1].content)?.[1] || 1);
      return reply('review_submit', { rating: ratings[round] ?? 9, verdict: 'revise', comments: `round ${round}` });
    };
  }

  test('runs a review-only session, persists the card, and applies with the concurrency stamp', async () => {
    await seedProject('p_review');
    chatBehavior = defaultChat({ failRole: 'Participant' });
    const started = await post('/api/agent/chat', {
      projectId: 'p_review',
      message: 'Review this survey',
      assistantMode: 'review',
      apiKey: 'sk-test-local-key-123456',
      provider: 'openai',
      model: 'gpt-test',
      review: { roles: ['scientist', 'participant'], maxRounds: 2, applyMode: 'review' },
    });
    expect(started.status).toBe(200);
    const detail = await waitFor(started.body.sessionId, (d) => d.run?.status === 'completed');
    const card = detail.messages.find((message) => message.metadata?.review);
    expect(card.metadata.review.status).toBe('accepted');
    expect(card.metadata.review.rounds[0].reviews.map((item) => item.status)).toEqual(['completed', 'failed']);
    expect(card.tools.every((tool) => tool.review)).toBe(true);
    expect(prompts.join('\n')).not.toContain('secret-anon-key-123');
    expect(prompts.join('\n')).not.toContain('sk-test-local-key');

    const stored = await fs.readJson(path.join(projectsPath, 'p_review.json'));
    expect(stored.surveyConfig.pages[0].elements[0].title).toBe('How safe is this street?');

    const persisted = await fs.readJson(process.env.SP_AGENT_SESSIONS_PATH);
    const events = persisted.find((row) => row.id === started.body.sessionId).events;
    expect(eventsToMessages(events).find((message) => message.metadata?.review)).toBeTruthy();

    const applied = await post(`/api/agent/runs/${started.body.runId}/review/apply`, { rounds: [1] });
    expect(applied.status).toBe(200);
    expect(applied.body.expectedDraftUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
    const after = await fs.readJson(path.join(projectsPath, 'p_review.json'));
    expect(after.surveyConfig.pages[0].elements[0].title).toBe('How safe do you feel on this street?');
    expect(after.surveyConfig.integration.supabaseAnonKey).toBe('secret-anon-key-123');
    const backups = await fs.readdir(path.join(projectsPath, '.backups'));
    const original = await fs.readJson(path.join(projectsPath, '.backups', backups.find((file) => file.startsWith('p_review-'))));
    expect(original.surveyConfig.pages[0].elements[0].title).toBe('How safe is this street?');
    const again = await post(`/api/agent/runs/${started.body.runId}/review/apply`, { rounds: [1] });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('REVIEW_NOTHING_TO_APPLY');
  });

  test('refuses to apply when the draft changed after the review', async () => {
    await seedProject('p_conflict');
    chatBehavior = defaultChat({ ratings: { 1: 4, 2: 4 } });
    const started = await post('/api/agent/chat', {
      projectId: 'p_conflict',
      message: 'Review',
      assistantMode: 'review',
      apiKey: 'sk-test-local-key-123456',
      model: 'gpt-test',
      review: { roles: ['scientist'], maxRounds: 1 },
    });
    await waitFor(started.body.sessionId, (d) => d.run?.status === 'completed');
    const file = path.join(projectsPath, 'p_conflict.json');
    const stored = await fs.readJson(file);
    await fs.writeJson(file, { ...stored, draftUpdatedAt: '2026-02-02T00:00:00.000Z' });
    const applied = await post(`/api/agent/runs/${started.body.runId}/review/apply`, {});
    expect(applied.status).toBe(409);
    expect(applied.body.code).toBe('DRAFT_WRITE_CONFLICT');
    expect((await fs.readJson(file)).surveyConfig.pages[0].elements[0].title).toBe('How safe is this street?');
  });

  test('cancels partway through and never finishes the review', async () => {
    await seedProject('p_cancel');
    let calls = 0;
    let runId = null;
    chatBehavior = async (request) => {
      calls += 1;
      if (calls === 1) await post(`/api/agent/runs/${runId}/cancel`, {});
      return defaultChat()(request);
    };
    const started = await post('/api/agent/chat', {
      projectId: 'p_cancel',
      message: 'Review',
      assistantMode: 'review',
      apiKey: 'sk-test-local-key-123456',
      model: 'gpt-test',
      review: {},
    });
    runId = started.body.runId;
    const detail = await waitFor(started.body.sessionId, (d) => ['cancelled', 'completed', 'failed'].includes(d.run?.status));
    expect(detail.run.status).toBe('cancelled');
    expect(detail.events.some((event) => event.type === 'review.result')).toBe(false);
    expect(detail.messages.find((message) => message.metadata?.review).metadata.review.status).toBe('cancelled');
    expect(calls).toBeLessThan(5);
  });

  test('rejects free models and invalid options; estimates cost before running', async () => {
    await seedProject('p_estimate');
    const free = await post('/api/agent/chat', {
      projectId: 'p_estimate', message: 'Review', assistantMode: 'review', apiKey: 'sk-x', model: 'deepseek/deepseek-r1:free',
    });
    expect(free.status).toBe(400);
    expect(free.body.code).toBe('REVIEW_MODEL_NOT_ALLOWED');
    const invalid = await post('/api/agent/chat', {
      projectId: 'p_estimate', message: 'Review', assistantMode: 'review', apiKey: 'sk-x', model: 'gpt-test', review: { roles: [] },
    });
    expect(invalid.status).toBe(400);
    const estimate = await post('/api/agent/review/estimate', { projectId: 'p_estimate', review: { maxRounds: 3 } });
    expect(estimate.body.success).toBe(true);
    expect(estimate.body.tokens.max).toBeGreaterThan(estimate.body.tokens.min);
    expect(estimate.body.options.roles).toHaveLength(5);
  });
});
