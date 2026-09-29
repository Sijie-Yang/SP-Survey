const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { applyOperations, normalizeOperationsArg } = require('./surveyOperations.cjs');
const { resolveAiRequest, resolveRoute, aiChat, formatAiError } = require('../../aiClient');
const { readStore } = require('./agentCredentialsApi');

const SESSION_PATH = path.join(
  process.env.SP_SURVEY_DATA_DIR || path.join(__dirname, '..', '..', 'data'),
  'agent-sessions.json',
);
const sessions = new Map();
let sessionsHydrated = false;

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
  {
    type: 'function',
    function: {
      name: 'survey_list_projects',
      description: 'List local projects.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_preview_url',
      description: 'Return local Admin preview and Live Survey URLs for this project.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'media_list',
      description: 'List project media dataset entries.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_list',
      description: 'List saved custom skills.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_list_responses',
      description: 'Summarize saved local responses for this project.',
      parameters: { type: 'object', properties: { view: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_results_summary',
      description: 'Return a compact results overview for analysis.',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string' },
          questionName: { type: 'string' },
          analysisScope: { type: 'object' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'survey_publish',
      description: 'Release the current draft as the local participant snapshot. Requires confirm=true.',
      parameters: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean' },
          expectedDraftUpdatedAt: { type: 'string' },
        },
      },
    },
  },
];

const SYSTEM = `You are the SP-Survey Assistant running locally with the researcher's own API keys.
Always call survey_capabilities first when starting a new task, then survey_get_draft and retain draftUpdatedAt.
Prefer survey_apply_operations over full replace. Writes must send expectedDraftUpdatedAt.
Question mode is read-only: do not apply operations or replace the draft.
Generate mode may call survey_submit_generated_draft with a complete surveyConfig and expectedDraftUpdatedAt.
Use survey_results_summary for Results analysis. Never invent statistics or causal claims.
Never ask for, print, or store credentials. Respond in the user's language.`;

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function toolsForMode(mode) {
  const writeTools = new Set(['survey_apply_operations', 'survey_submit_generated_draft', 'survey_publish']);
  if (mode === 'question') return TOOLS.filter((tool) => !writeTools.has(tool.function.name));
  if (mode === 'generate') return TOOLS.filter((tool) => tool.function.name !== 'survey_apply_operations');
  if (mode === 'adjust') return TOOLS.filter((tool) => tool.function.name !== 'survey_submit_generated_draft');
  return TOOLS;
}

async function persistSessions() {
  await fs.ensureDir(path.dirname(SESSION_PATH));
  const payload = [...sessions.values()].map((session) => ({
    id: session.id,
    projectId: session.projectId,
    events: session.events,
    runs: session.runs.map((run) => ({
      id: run.id,
      status: run.status,
      error: run.error,
      result: run.result,
    })),
    seq: session.seq,
    createdAt: session.createdAt,
    inbox: session.inbox || [],
    steerQueue: session.steerQueue || [],
  }));
  payload.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  await fs.writeFile(SESSION_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

async function hydrateSessions() {
  if (sessionsHydrated) return;
  sessionsHydrated = true;
  if (!await fs.pathExists(SESSION_PATH)) return;
  try {
    const rows = JSON.parse(await fs.readFile(SESSION_PATH, 'utf8'));
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      sessions.set(row.id, {
        ...row,
        events: row.events || [],
        runs: (row.runs || []).map((run) => ({ ...run, cancel: false })),
        inbox: row.inbox || [],
        steerQueue: row.steerQueue || [],
      });
    });
  } catch {
    // keep empty in-memory map
  }
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

function assertExpectedStamp(project, args) {
  const expected = args.expectedDraftUpdatedAt || args.expectedSavedAt;
  const current = project.draftUpdatedAt || project.savedAt;
  if (expected && current && expected !== current) {
    const error = new Error('Draft changed after it was read. Call survey_get_draft again.');
    error.code = 'STALE_DRAFT';
    throw error;
  }
}

function draftView(config, view) {
  if (view === 'outline') {
    return {
      title: config.title || '',
      locale: config.locale || 'en',
      pages: (config.pages || []).map((page) => ({
        name: page.name,
        title: page.title,
        questions: (page.elements || []).map((el) => ({ name: el.name, type: el.type, title: el.title })),
      })),
    };
  }
  if (view === 'settings') {
    const { pages, ...settings } = config;
    return settings;
  }
  return config;
}

async function executeTool(name, args, ctx) {
  const { readProject, persistProject, validateSurveyConfig, sanitizeForAgent } = ctx;
  const project = await readProject(ctx.projectId);
  const draft = project.surveyConfig || { pages: [] };
  const writeBlocked = ctx.assistantMode === 'question'
    && ['survey_apply_operations', 'survey_submit_generated_draft', 'survey_publish'].includes(name);
  if (writeBlocked) return { ok: false, error: 'Question mode is read-only.' };

  if (name === 'survey_capabilities') {
    return {
      name: 'SP-Survey local agent API',
      tools: toolsForMode(ctx.assistantMode).map((tool) => tool.function.name),
      draftUpdatedAt: project.draftUpdatedAt || project.savedAt || null,
      rules: [
        'Always read the draft and retain draftUpdatedAt before writing.',
        'Saves update the local draft. survey_publish updates the participant snapshot.',
        'Models use the researcher\'s own API keys only.',
      ],
    };
  }
  if (name === 'survey_get_draft') {
    return {
      surveyConfig: sanitizeForAgent(draftView(draft, args.view)),
      title: draft.title || project.project?.name || project.name,
      draftUpdatedAt: project.draftUpdatedAt || project.savedAt || null,
      savedAt: project.savedAt || null,
      view: args.view || 'full',
    };
  }
  if (name === 'survey_validate') {
    return validateSurveyConfig(args.surveyConfig || draft);
  }
  if (name === 'survey_list_projects') {
    const listed = await ctx.listProjects?.();
    return { ok: true, projects: listed || [] };
  }
  if (name === 'survey_preview_url') {
    return {
      ok: true,
      admin: `${ctx.clientOrigin || 'http://localhost:3000'}/admin`,
      live: `${ctx.clientOrigin || 'http://localhost:3000'}/survey?project=${encodeURIComponent(ctx.projectId)}`,
    };
  }
  if (name === 'media_list') {
    return {
      ok: true,
      media: sanitizeForAgent(project.project?.preloadedImages || project.preloadedImages || []),
    };
  }
  if (name === 'skill_list') {
    return { ok: true, skills: await ctx.listSkills?.() || [] };
  }
  if (name === 'survey_list_responses' || name === 'survey_results_summary') {
    const summary = await ctx.summarizeResults?.(ctx.projectId, args);
    return summary || { ok: true, count: 0, view: args.view || 'overview' };
  }
  if (name === 'survey_publish') {
    if (!args.confirm) return { ok: false, error: 'Pass confirm=true to release the participant snapshot.' };
    assertExpectedStamp(project, args);
    const released = await ctx.releaseProject?.(ctx.projectId, args);
    return released || { ok: true };
  }
  if (name === 'survey_apply_operations') {
    assertExpectedStamp(project, args);
    const operations = normalizeOperationsArg(args.operations || args);
    const applied = applyOperations(draft, operations);
    const validation = validateSurveyConfig(applied.surveyConfig);
    if (!validation.valid) return { ok: false, error: 'Survey validation failed.', validation };
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
    const verified = await readProject(ctx.projectId);
    ctx.surveyConfig = verified.surveyConfig;
    ctx.draftMutated = true;
    ctx.draftUpdatedAt = verified.draftUpdatedAt || now;
    return {
      ok: true,
      pageCount: (verified.surveyConfig.pages || []).length,
      persisted: true,
      draftUpdatedAt: ctx.draftUpdatedAt,
      validation: validateSurveyConfig(verified.surveyConfig),
    };
  }
  if (name === 'survey_submit_generated_draft') {
    const surveyConfig = args.surveyConfig || args;
    if (!surveyConfig || typeof surveyConfig !== 'object') {
      return { ok: false, error: 'surveyConfig is required' };
    }
    assertExpectedStamp(project, args);
    const validation = validateSurveyConfig(surveyConfig);
    if (!validation.valid) return { ok: false, error: 'Survey validation failed.', validation };
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
    const verified = await readProject(ctx.projectId);
    ctx.surveyConfig = verified.surveyConfig;
    ctx.draftMutated = true;
    ctx.draftUpdatedAt = verified.draftUpdatedAt || now;
    return {
      ok: true,
      pageCount: (verified.surveyConfig.pages || []).length,
      persisted: true,
      draftUpdatedAt: ctx.draftUpdatedAt,
      validation: validateSurveyConfig(verified.surveyConfig),
    };
  }
  return { ok: false, error: `Unknown tool ${name}` };
}

async function resolveChatModel(ctx) {
  const store = await readStore();
  const resolved = resolveAiRequest(ctx.apiKey, {
    provider: ctx.provider,
    model: ctx.model,
    store,
  });
  if (!resolved) return { error: 'API key is required. Add a provider key in Assistant settings.' };
  try {
    const route = await resolveRoute(resolved);
    return { resolved: { ...resolved, provider: route.provider, model: route.model }, route };
  } catch (error) {
    return { error: formatAiError(error), code: error.code };
  }
}

async function runDesignerChat(session, run, ctx) {
  const { resolved, error: routeError } = await resolveChatModel(ctx);
  if (!resolved) {
    run.status = 'failed';
    run.error = routeError;
    pushEvent(session, 'error', { message: run.error }, run.id);
    pushEvent(session, 'run.status', { status: 'failed' }, run.id);
    await persistSessions();
    return;
  }
  pushEvent(session, 'run.status', { status: 'running' }, run.id);
  const editor = ctx.editorContext ? `\nEditor context: ${JSON.stringify(ctx.editorContext).slice(0, 4000)}` : '';
  const history = [
    { role: 'system', content: SYSTEM + editor },
    ...(ctx.researchContext?.topic ? [{
      role: 'system',
      content: `Research context: ${JSON.stringify(ctx.researchContext)}`,
    }] : []),
    ...((ctx.conversationHistory || []).slice(-16)),
    { role: 'user', content: ctx.message },
  ];
  pushEvent(session, 'user.message', { content: ctx.message }, run.id);

  let finalText = '';
  for (let step = 0; step < 16; step += 1) {
    if (run.cancel) {
      run.status = 'cancelled';
      pushEvent(session, 'run.status', { status: 'cancelled' }, run.id);
      await persistSessions();
      return;
    }
    const steered = (session.steerQueue || []).splice(0);
    if (steered.length) {
      history.push({
        role: 'user',
        content: `Steering update:\n${steered.map((item) => item.content).join('\n')}`,
      });
      pushEvent(session, 'steering.applied', { count: steered.length }, run.id);
    }
    pushEvent(session, 'step.start', { step }, run.id);
    let completion;
    try {
      completion = await aiChat(resolved, 'default', {
        model: resolved.model,
        messages: history,
        tools: toolsForMode(ctx.assistantMode),
        reasoningEffort: ctx.reasoningEffort,
      });
    } catch (error) {
      if (step < 2) {
        pushEvent(session, 'step.retry', { step, error: formatAiError(error) }, run.id);
        continue;
      }
      throw error;
    }
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
          result = { ok: false, error: error.message, code: error.code };
          pushEvent(session, 'tool.result', { id: call.id, name, ok: false, result }, run.id);
        }
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
      if (history.length > 40) {
        history.splice(3, history.length - 28);
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
  if (ctx.draftMutated) {
    pushEvent(session, 'run.complete', { projectId: ctx.projectId }, run.id);
  }
  await persistSessions();
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
    inbox: [],
    steerQueue: [],
  };
  sessions.set(session.id, session);
  return session;
}

function registerAgentChatApi(app, deps) {
  const { createProjectIo, fs: fileFs, projectsPath, skillsPath, clientOrigin } = deps;
  hydrateSessions().catch(() => {});

  app.post('/api/agent/chat', async (req, res) => {
    try {
      await hydrateSessions();
      const projectId = String(req.body?.projectId || '').trim();
      const apiKey = String(req.body?.apiKey || '').trim();
      const message = String(req.body?.message || '').trim();
      if (!projectId || !message) {
        return res.status(400).json({ success: false, error: 'projectId and message are required' });
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
        provider: req.body.provider || '',
        message,
        model: req.body.model || '',
        reasoningEffort: req.body.reasoningEffort || '',
        assistantMode: req.body.assistantMode || 'agent',
        conversationHistory: req.body.conversationHistory || [],
        researchContext: req.body.researchContext || {},
        editorContext: req.body.editorContext || null,
        surveyConfig: req.body.currentConfig || null,
        draftMutated: false,
        clientOrigin,
        listProjects: async () => {
          const files = (await fileFs.readdir(projectsPath)).filter((file) => file.endsWith('.json') && !file.endsWith('.silicon.json'));
          const rows = [];
          for (const file of files) {
            try {
              const stored = JSON.parse(await fileFs.readFile(path.join(projectsPath, file), 'utf8'));
              rows.push({
                id: stored.project?.id || file.replace(/\.json$/, ''),
                name: stored.project?.name || stored.surveyConfig?.title || file,
                draftUpdatedAt: stored.draftUpdatedAt || stored.savedAt || null,
              });
            } catch {
              // skip
            }
          }
          return rows;
        },
        listSkills: async () => {
          if (!skillsPath || !await fileFs.pathExists(skillsPath)) return [];
          const files = (await fileFs.readdir(skillsPath)).filter((file) => file.endsWith('.json'));
          const skills = [];
          for (const file of files) {
            try {
              skills.push(JSON.parse(await fileFs.readFile(path.join(skillsPath, file), 'utf8')));
            } catch {
              // skip
            }
          }
          return skills;
        },
        summarizeResults: async (id) => {
          const responsesPath = path.join(__dirname, '..', '..', 'public', 'responses');
          if (!await fileFs.pathExists(responsesPath)) return { ok: true, count: 0, view: 'overview' };
          const files = (await fileFs.readdir(responsesPath)).filter((file) => file.endsWith('.json'));
          let count = 0;
          for (const file of files) {
            try {
              const row = JSON.parse(await fileFs.readFile(path.join(responsesPath, file), 'utf8'));
              if (String(row.project_id || '') === String(id)) count += 1;
            } catch {
              // skip
            }
          }
          return { ok: true, count, view: 'overview', projectId: id };
        },
        releaseProject: async (id, args) => {
          const filePath = path.join(projectsPath, `${id}.json`);
          const stored = JSON.parse(await fileFs.readFile(filePath, 'utf8'));
          const now = new Date().toISOString();
          stored.publishedSurveyConfig = stored.surveyConfig;
          stored.publishedVersion = Number(stored.publishedVersion || 0) + 1;
          stored.releaseManaged = true;
          stored.publishedAt = now;
          await fileFs.writeFile(filePath, JSON.stringify(stored, null, 2), 'utf8');
          return { ok: true, publishedVersion: stored.publishedVersion, expected: args?.expectedDraftUpdatedAt || null };
        },
      };
      res.json({
        success: true,
        queued: true,
        runtime: 'local',
        sessionId: session.id,
        runId: run.id,
      });
      persistSessions().catch(() => {});
      runDesignerChat(session, run, ctx).catch((error) => {
        run.status = 'failed';
        run.error = formatAiError(error);
        pushEvent(session, 'error', { message: run.error }, run.id);
        pushEvent(session, 'run.status', { status: 'failed' }, run.id);
        persistSessions().catch(() => {});
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

  app.get('/api/agent/sessions', async (req, res) => {
    await hydrateSessions();
    const projectId = String(req.query.projectId || '');
    const list = [...sessions.values()]
      .filter((session) => !projectId || session.projectId === projectId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
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

  app.post('/api/agent/sessions/:sessionId/steer', async (req, res) => {
    await hydrateSessions();
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const item = { content: req.body?.content || '', target: req.body?.target || 'next-step', createdAt: new Date().toISOString() };
    session.steerQueue = [...(session.steerQueue || []), item];
    session.inbox = [...(session.inbox || []), { id: createId('inbox'), ...item }];
    pushEvent(session, 'steering.message', { content: item.content, target: item.target }, session.runs.at(-1)?.id);
    await persistSessions();
    res.json({ success: true });
  });

  app.get('/api/agent/sessions/:sessionId/inbox', async (req, res) => {
    await hydrateSessions();
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    res.json({ success: true, inbox: session.inbox || [] });
  });

  app.post('/api/agent/sessions/:sessionId/inbox', async (req, res) => {
    await hydrateSessions();
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    if (req.body?.action === 'discard' && req.body?.itemId) {
      session.inbox = (session.inbox || []).filter((item) => item.id !== req.body.itemId);
    }
    await persistSessions();
    res.json({ success: true, inbox: session.inbox || [] });
  });
}

module.exports = { registerAgentChatApi };
