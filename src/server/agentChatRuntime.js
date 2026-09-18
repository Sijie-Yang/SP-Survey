const crypto = require('crypto');
const { applyOperations, normalizeOperationsArg } = require('./surveyOperations.cjs');
const { resolveAiRequest, aiChat, formatAiError } = require('../../aiClient');

const sessions = new Map();

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'survey_capabilities',
      description: 'Read local agent capabilities and design rules before editing.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_get_draft',
      description: 'Read the current local survey draft for this project.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_apply_operations',
      description: 'Apply incremental design-protocol operations to the draft.',
      parameters: {
        type: 'object',
        properties: {
          operations: { type: 'array', items: { type: 'object' } },
        },
        required: ['operations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_submit_generated_draft',
      description: 'Replace the draft with a generated surveyConfig (Generate mode).',
      parameters: {
        type: 'object',
        properties: {
          surveyConfig: { type: 'object' },
        },
        required: ['surveyConfig'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_validate',
      description: 'Validate the current or provided survey draft.',
      parameters: {
        type: 'object',
        properties: { surveyConfig: { type: 'object' } },
      },
    },
  },
];

const SYSTEM = `You are the SP-Survey Assistant running locally with the researcher's own API key.
Use tools to inspect and edit the current project draft. Prefer survey_apply_operations over full replace.
In generate mode you may call survey_submit_generated_draft with a complete surveyConfig.
Never ask for or log credentials. Do not invent statistics. Respond in the user's language.`;

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function toolsForMode(mode) {
  if (mode === 'question') {
    return TOOLS.filter((tool) => tool.function.name !== 'survey_apply_operations'
      && tool.function.name !== 'survey_submit_generated_draft');
  }
  if (mode === 'generate') return TOOLS;
  if (mode === 'adjust') return TOOLS.filter((tool) => tool.function.name !== 'survey_submit_generated_draft');
  return TOOLS;
}

function pushEvent(session, type, payload, runId) {
  session.seq += 1;
  const event = {
    type,
    payload: payload || {},
    createdAt: new Date().toISOString(),
    seq: session.seq,
    run_id: runId,
    runId,
  };
  session.events.push(event);
  return event;
}

function eventsToMessages(events) {
  const messages = [];
  const toolsById = new Map();
  events.forEach((event) => {
    if (event.type === 'user.message') {
      messages.push({
        id: `user_${event.seq}`,
        role: 'user',
        content: event.payload?.content || '',
        createdAt: event.createdAt,
      });
    }
    if (event.type === 'assistant.message') {
      const tools = [...toolsById.values()];
      messages.push({
        id: `asst_${event.seq}`,
        role: 'assistant',
        content: event.payload?.content || '',
        createdAt: event.createdAt,
        tools,
        metadata: { tools, actionType: event.payload?.intent || 'agent' },
      });
      toolsById.clear();
    }
    if (event.type === 'tool.call') {
      toolsById.set(event.payload?.id || event.seq, {
        id: event.payload?.id,
        name: event.payload?.name,
        status: 'running',
      });
    }
    if (event.type === 'tool.result') {
      const current = toolsById.get(event.payload?.id) || {
        id: event.payload?.id,
        name: event.payload?.name,
      };
      current.status = event.payload?.ok === false ? 'error' : 'done';
      current.result = event.payload?.result;
      toolsById.set(current.id || event.seq, current);
    }
  });
  return messages;
}

function safeParseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function executeTool(name, args, ctx) {
  const { readProject, persistProject, validateSurveyConfig, sanitizeForAgent } = ctx;
  const project = await readProject(ctx.projectId);
  const draft = project.surveyConfig || { pages: [] };

  if (name === 'survey_capabilities') {
    return {
      name: 'SP-Survey local agent API',
      tools: TOOLS.map((tool) => tool.function.name),
      rules: [
        'Saves update the local draft. Release updates the participant snapshot.',
        'Models use the researcher\'s own API keys only.',
      ],
    };
  }
  if (name === 'survey_get_draft') {
    return { surveyConfig: sanitizeForAgent(draft), title: draft.title || project.name };
  }
  if (name === 'survey_validate') {
    return validateSurveyConfig(args.surveyConfig || draft);
  }
  if (name === 'survey_apply_operations') {
    const operations = normalizeOperationsArg(args.operations || args);
    const applied = applyOperations(draft, operations);
    const now = new Date().toISOString();
    const next = {
      ...project,
      surveyConfig: ctx.restoreStoredSecrets
        ? ctx.restoreStoredSecrets(applied.surveyConfig, draft)
        : applied.surveyConfig,
      savedAt: now,
      draftUpdatedAt: now,
    };
    await persistProject(ctx.projectId, next, now);
    ctx.surveyConfig = next.surveyConfig;
    ctx.draftMutated = true;
    ctx.draftUpdatedAt = now;
    return { ok: true, pageCount: (next.surveyConfig.pages || []).length, persisted: true };
  }
  if (name === 'survey_submit_generated_draft') {
    const surveyConfig = args.surveyConfig || args;
    if (!surveyConfig || typeof surveyConfig !== 'object') {
      return { ok: false, error: 'surveyConfig is required' };
    }
    const now = new Date().toISOString();
    const next = {
      ...project,
      surveyConfig: ctx.restoreStoredSecrets
        ? ctx.restoreStoredSecrets(surveyConfig, draft)
        : surveyConfig,
      savedAt: now,
      draftUpdatedAt: now,
    };
    await persistProject(ctx.projectId, next, now);
    ctx.surveyConfig = next.surveyConfig;
    ctx.draftMutated = true;
    ctx.draftUpdatedAt = now;
    return { ok: true, pageCount: (next.surveyConfig.pages || []).length, persisted: true };
  }
  return { ok: false, error: `Unknown tool ${name}` };
}

async function runDesignerChat(session, run, ctx) {
  const resolved = resolveAiRequest(ctx.apiKey);
  if (!resolved) {
    run.status = 'failed';
    run.error = 'API key is required';
    pushEvent(session, 'error', { message: run.error }, run.id);
    pushEvent(session, 'run.status', { status: 'failed' }, run.id);
    return;
  }
  pushEvent(session, 'run.status', { status: 'running' }, run.id);
  const history = [
    { role: 'system', content: SYSTEM },
    ...(ctx.researchContext?.topic ? [{
      role: 'system',
      content: `Research context: ${JSON.stringify(ctx.researchContext)}`,
    }] : []),
    ...((ctx.conversationHistory || []).slice(-12)),
    { role: 'user', content: ctx.message },
  ];
  pushEvent(session, 'user.message', { content: ctx.message }, run.id);

  let finalText = '';
  for (let step = 0; step < 8; step += 1) {
    if (run.cancel) {
      run.status = 'cancelled';
      pushEvent(session, 'run.status', { status: 'cancelled' }, run.id);
      return;
    }
    pushEvent(session, 'step.start', { step }, run.id);
    const completion = await aiChat(resolved, 'default', {
      model: ctx.model,
      messages: history,
      tools: toolsForMode(ctx.assistantMode),
      tool_choice: step === 0 && ctx.assistantMode !== 'question' ? 'auto' : 'auto',
    });
    const choice = completion.choices?.[0]?.message || {};
    if (choice.tool_calls?.length) {
      history.push({
        role: 'assistant',
        content: choice.content || '',
        tool_calls: choice.tool_calls,
      });
      for (const call of choice.tool_calls) {
        const name = call.function?.name;
        const args = safeParseArgs(call.function?.arguments);
        pushEvent(session, 'tool.call', { id: call.id, name }, run.id);
        let result;
        try {
          result = await executeTool(name, args, ctx);
          pushEvent(session, 'tool.result', { id: call.id, name, ok: result?.ok !== false, result }, run.id);
        } catch (error) {
          result = { ok: false, error: error.message };
          pushEvent(session, 'tool.result', { id: call.id, name, ok: false, result }, run.id);
        }
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
      continue;
    }
    finalText = choice.content || 'Done.';
    break;
  }
  if (!finalText) finalText = ctx.draftMutated ? 'Updated the survey draft.' : 'Ready.';
  pushEvent(session, 'assistant.message', { content: finalText, intent: ctx.assistantMode }, run.id);
  run.status = 'completed';
  run.result = {
    message: finalText,
    intent: ctx.assistantMode,
    surveyConfig: ctx.surveyConfig,
    draftMutated: Boolean(ctx.draftMutated),
    persisted: Boolean(ctx.draftMutated),
    draftUpdatedAt: ctx.draftUpdatedAt || null,
    messages: eventsToMessages(session.events),
  };
  pushEvent(session, 'run.status', { status: 'completed' }, run.id);
}

function getOrCreateSession(sessionId, projectId) {
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId);
  const session = {
    id: sessionId || createId('sess'),
    projectId,
    events: [],
    runs: [],
    seq: 0,
    createdAt: new Date().toISOString(),
  };
  sessions.set(session.id, session);
  return session;
}

function registerAgentChatApi(app, deps) {
  const { createProjectIo } = deps;

  app.post('/api/agent/chat', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || '').trim();
      const apiKey = String(req.body?.apiKey || '').trim();
      const message = String(req.body?.message || '').trim();
      if (!projectId || !message) {
        return res.status(400).json({ success: false, error: 'projectId and message are required' });
      }
      if (!apiKey) {
        return res.status(400).json({ success: false, error: 'API key is required. Add your OpenAI or OpenRouter key in Assistant settings.' });
      }
      const io = createProjectIo();
      const session = getOrCreateSession(req.body.sessionId, projectId);
      const run = {
        id: createId('run'),
        status: 'queued',
        result: null,
        error: null,
        cancel: false,
      };
      session.runs.push(run);
      const ctx = {
        ...io,
        projectId,
        apiKey,
        message,
        model: req.body.model || '',
        assistantMode: req.body.assistantMode || 'agent',
        conversationHistory: req.body.conversationHistory || [],
        researchContext: req.body.researchContext || {},
        surveyConfig: req.body.currentConfig || null,
        draftMutated: false,
      };
      res.json({
        success: true,
        queued: true,
        runtime: 'local',
        sessionId: session.id,
        runId: run.id,
      });
      runDesignerChat(session, run, ctx).catch((error) => {
        run.status = 'failed';
        run.error = formatAiError(error);
        pushEvent(session, 'error', { message: run.error }, run.id);
        pushEvent(session, 'run.status', { status: 'failed' }, run.id);
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/agent/sessions/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const after = Number(req.query.after || 0);
    const events = session.events.filter((event) => Number(event.seq) > after);
    const run = session.runs[session.runs.length - 1] || null;
    res.json({
      success: true,
      sessionId: session.id,
      events,
      nextCursor: events.at(-1)?.seq || after,
      run,
      runs: session.runs,
      messages: eventsToMessages(session.events),
    });
  });

  app.get('/api/agent/sessions', (req, res) => {
    const projectId = String(req.query.projectId || '');
    const list = [...sessions.values()]
      .filter((session) => !projectId || session.projectId === projectId)
      .map((session) => ({ id: session.id, projectId: session.projectId, createdAt: session.createdAt }));
    res.json({ success: true, sessions: list });
  });

  app.delete('/api/agent/sessions/:sessionId', (req, res) => {
    sessions.delete(req.params.sessionId);
    res.json({ success: true });
  });

  app.get('/api/agent/runs/:runId', (req, res) => {
    for (const session of sessions.values()) {
      const run = session.runs.find((item) => item.id === req.params.runId);
      if (run) return res.json({ success: true, run });
    }
    res.status(404).json({ success: false, error: 'Run not found' });
  });

  app.post('/api/agent/runs/:runId/cancel', (req, res) => {
    for (const session of sessions.values()) {
      const run = session.runs.find((item) => item.id === req.params.runId);
      if (run) {
        run.cancel = true;
        return res.json({ success: true });
      }
    }
    res.status(404).json({ success: false, error: 'Run not found' });
  });

  app.post('/api/agent/sessions/:sessionId/steer', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    pushEvent(session, 'steering.message', { content: req.body?.content || '' }, session.runs.at(-1)?.id);
    res.json({ success: true });
  });
}

module.exports = { registerAgentChatApi };
