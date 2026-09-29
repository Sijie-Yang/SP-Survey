const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { applyOperations, normalizeOperationsArg } = require('./surveyOperations.cjs');
const { resolveAiRequest, aiChat, formatAiError } = require('../../aiClient');
const { readStore, resolveProviderRequest } = require('./agentCredentialsApi');
const review = require('./agentReview');

const SESSION_PATH = process.env.SP_AGENT_SESSIONS_PATH
  || path.join(__dirname, '..', '..', 'data', 'agent-sessions.json');
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

const REVIEW_EVENTS = new Set([
  'review.start',
  'review.round',
  'review.role',
  'review.revision',
  'review.applied',
  'review.result',
]);

function isReviewSubRunEvent(event) {
  return Boolean(event?.payload?.review && typeof event.payload.review === 'object');
}

function eventsToMessages(events) {
  const messages = [];
  const toolsById = new Map();
  const reviewCards = new Map();
  events.forEach((event) => {
    const runId = event.runId || event.run_id || null;
    if (REVIEW_EVENTS.has(event.type)) {
      let card = reviewCards.get(runId);
      if (!card || event.type === 'review.start') {
        card = {
          id: `review_${event.seq}`,
          role: 'assistant',
          content: '',
          createdAt: event.createdAt,
          runId,
          tools: [],
          metadata: { tools: [], actionType: 'review' },
          reviewEvents: [],
        };
        card.metadata.tools = card.tools;
        reviewCards.set(runId, card);
        messages.push(card);
      }
      card.reviewEvents.push(event);
      card.metadata.review = review.reviewFromEvents(card.reviewEvents, runId);
      if (event.type === 'review.result' && event.payload?.summary) card.content = event.payload.summary;
      return;
    }
    if (event.type === 'run.status' && reviewCards.has(runId)) {
      const card = reviewCards.get(runId);
      card.reviewEvents.push(event);
      card.metadata.review = review.reviewFromEvents(card.reviewEvents, runId);
    }
    if (isReviewSubRunEvent(event)) {
      const card = reviewCards.get(runId);
      if (!card) return;
      if (event.type === 'tool.call') {
        card.tools.push({ id: event.payload?.id, name: event.payload?.name, status: 'running', review: event.payload.review });
      } else if (event.type === 'tool.result') {
        const tool = card.tools.find((item) => item.id === event.payload?.id);
        if (tool) {
          tool.status = event.payload?.ok === false ? 'error' : 'done';
          tool.result = event.payload?.result;
        }
      }
      return;
    }
    if (event.type === 'user.message') {
      messages.push({
        id: `user_${event.seq}`,
        role: 'user',
        content: event.payload?.content || '',
        createdAt: event.createdAt,
        runId,
      });
    }
    if (event.type === 'assistant.message') {
      const tools = [...toolsById.values()];
      messages.push({
        id: `asst_${event.seq}`,
        role: 'assistant',
        content: event.payload?.content || '',
        createdAt: event.createdAt,
        runId,
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
  messages.forEach((message) => { delete message.reviewEvents; });
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

function cancelledError() {
  return Object.assign(new Error('Cancelled'), { status: 499, code: 'CANCELLED' });
}

/**
 * Shared local model/tool loop. Designer chat and Review sub-runs both use it,
 * so cancel, steering, retries, and tool events behave the same.
 */
async function runLocalLoop({
  session,
  run,
  resolved,
  model,
  history,
  tools,
  execute,
  chat = aiChat,
  maxSteps = 16,
  terminalTools = [],
  steering = false,
  tag = null,
  throwOnCancel = false,
}) {
  const extra = tag ? { review: tag } : {};
  const terminal = new Set(terminalTools);
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  let finalText = '';
  let steps = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    if (run.cancel) {
      if (throwOnCancel) throw cancelledError();
      return { cancelled: true, content: finalText, usage, steps };
    }
    if (steering) {
      const steered = (session.steerQueue || []).splice(0);
      if (steered.length) {
        history.push({
          role: 'user',
          content: `Steering update:\n${steered.map((item) => item.content).join('\n')}`,
        });
        pushEvent(session, 'steering.applied', { count: steered.length }, run.id);
      }
    }
    pushEvent(session, 'step.start', { step, ...extra }, run.id);
    steps += 1;
    let completion;
    try {
      completion = await chat(resolved, 'default', {
        model,
        messages: history,
        tools,
        tool_choice: 'auto',
      });
    } catch (error) {
      if (step < 2) {
        pushEvent(session, 'step.retry', { step, error: formatAiError(error), ...extra }, run.id);
        continue;
      }
      throw Object.assign(error, { usage, steps });
    }
    usage.prompt_tokens += Number(completion?.usage?.prompt_tokens || 0);
    usage.completion_tokens += Number(completion?.usage?.completion_tokens || 0);
    const choice = completion.choices?.[0]?.message || {};
    if (choice.tool_calls?.length) {
      history.push({
        role: 'assistant',
        content: choice.content || '',
        tool_calls: choice.tool_calls,
      });
      let stop = false;
      for (const call of choice.tool_calls) {
        const name = call.function?.name;
        const args = safeParseArgs(call.function?.arguments);
        pushEvent(session, 'tool.call', { id: call.id, name, ...extra }, run.id);
        let result;
        try {
          result = await execute(name, args);
          const ok = result?.ok !== false;
          pushEvent(session, 'tool.result', { id: call.id, name, ok, result: tag ? redactForEvent(result) : result, ...extra }, run.id);
          if (ok && terminal.has(name)) stop = true;
        } catch (error) {
          result = { ok: false, error: error.message, code: error.code, ...(error.validation ? { validation: error.validation } : {}) };
          pushEvent(session, 'tool.result', { id: call.id, name, ok: false, result, ...extra }, run.id);
        }
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
      if (history.length > 40) {
        history.splice(3, history.length - 28);
      }
      if (stop) return { content: choice.content || '', usage, steps, terminal: true };
      continue;
    }
    finalText = choice.content || 'Done.';
    break;
  }
  return { content: finalText, usage, steps };
}

function redactForEvent(result) {
  if (!result || typeof result !== 'object') return result;
  const { surveyConfig, ...rest } = result;
  return surveyConfig ? { ...rest, surveyConfigPreview: { title: surveyConfig.title, pages: (surveyConfig.pages || []).length } } : rest;
}

const CHOICE_TYPES = new Set(['radiogroup', 'checkbox', 'dropdown', 'tagbox', 'ranking']);
const SLIDER_GROUP_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);

function reviewPreflight(surveyConfig = {}) {
  const pages = Array.isArray(surveyConfig?.pages) ? surveyConfig.pages : [];
  const questions = pages.flatMap((page) => (page?.elements || []).map((element) => ({ page: page?.name, element })));
  const trials = (element) => Math.max(1, Number.parseInt(element?.trialCount, 10) || 1);
  const screens = questions.reduce((count, { element }) => count + trials(element), 0);
  const issues = [];
  pages.forEach((page) => {
    if (!(page?.elements || []).length) issues.push({ page: page?.name, issue: 'Page has no questions.' });
  });
  questions.forEach(({ page, element }) => {
    if (!element?.title && !['html', 'expression', 'image'].includes(element?.type)) {
      issues.push({ page, question: element?.name, issue: 'Question has no title.' });
    }
  });
  return {
    summary: `${pages.length} page(s), ${questions.length} question(s), about ${screens} screen(s)`,
    pageCount: pages.length,
    questionCount: questions.length,
    requiredCount: questions.filter(({ element }) => element?.isRequired).length,
    estimatedScreens: screens,
    estimatedMinutes: Math.max(1, Math.round(screens * 0.25)),
    mediaQuestions: questions.filter(({ element }) => /^(image|media|video)/i.test(String(element?.type || ''))).map(({ element }) => element.name),
    trialQuestions: questions.filter(({ element }) => trials(element) > 1).map(({ page, element }) => ({ page, name: element.name, trials: trials(element) })),
    hasConsentText: questions.some(({ element }) => /consent|同意/i.test(`${element?.name || ''} ${element?.title || ''} ${element?.html || ''}`)),
    issues: issues.slice(0, 30),
  };
}

function reviewAnswerability(surveyConfig = {}, validateSurveyConfig) {
  const errors = [];
  (surveyConfig?.pages || []).forEach((page) => {
    (page?.elements || []).forEach((element) => {
      const where = { page: page?.name, question: element?.name, type: element?.type };
      if (CHOICE_TYPES.has(element?.type) && !(element.choices || []).length && !element.choicesByUrl) {
        errors.push({ ...where, reason: 'Choice question has no choices.' });
      }
      if (element?.type === 'matrix' && (!(element.rows || []).length || !(element.columns || []).length)) {
        errors.push({ ...where, reason: 'Matrix needs rows and columns.' });
      }
      if (SLIDER_GROUP_TYPES.has(element?.type) && !(element.dimensions || []).length) {
        errors.push({ ...where, reason: 'Slider group needs a non-empty dimensions array.' });
      }
    });
  });
  const validation = validateSurveyConfig ? validateSurveyConfig(surveyConfig) : null;
  return {
    summary: errors.length ? `${errors.length} answerability issue(s)` : 'Every question is answerable',
    ok: errors.length === 0 && validation?.valid !== false,
    errors: errors.slice(0, 20),
    validation,
  };
}

function reviewToolDefs(submitName, parameters, description) {
  const pick = new Set(['survey_capabilities', 'survey_get_draft', 'survey_validate']);
  return [
    ...TOOLS.filter((tool) => pick.has(tool.function.name)),
    {
      type: 'function',
      function: {
        name: 'survey_answerability',
        description: 'Check whether every question can be answered and recorded as configured (read-only).',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'survey_preflight',
        description: 'Participant-flow preflight: screens, trials, required questions, media questions, consent text (read-only).',
        parameters: { type: 'object', properties: {} },
      },
    },
    { type: 'function', function: { name: submitName, description, parameters } },
  ];
}

function isFreeOrSharedModel(model) {
  return /(?:^|[:/_-])free$/i.test(String(model || '').trim());
}

async function modelCost(provider, model) {
  try {
    const catalog = await import('./agentRuntime/catalog.mjs');
    const entry = catalog.listCatalogProviders().find((row) => row.id === provider);
    const record = (entry?.models || []).find((row) => row.id === model);
    return record?.cost || null;
  } catch {
    return null;
  }
}

function reviewDryRun(ctx, surveyConfig, operations) {
  return review.dryRunRevision(
    (config, ops) => applyOperations(config, normalizeOperationsArg(ops)),
    (config) => ctx.validateSurveyConfig(config),
    surveyConfig,
    operations,
  );
}

async function readSanitizedDraft(ctx) {
  const project = await ctx.readProject(ctx.projectId);
  return {
    surveyConfig: ctx.sanitizeForAgent(project.surveyConfig || { pages: [] }),
    draftUpdatedAt: project.draftUpdatedAt || project.savedAt || null,
  };
}

async function applyReviewOperations(session, run, ctx, { operations, expectedDraftUpdatedAt, tag, source }) {
  const id = `review_apply_${run.id}_${Date.now().toString(36)}`;
  pushEvent(session, 'tool.call', { id, name: 'survey_apply_operations', review: tag }, run.id);
  const applyCtx = { ...ctx, assistantMode: 'adjust' };
  let result;
  try {
    result = await executeTool('survey_apply_operations', { operations, expectedDraftUpdatedAt }, applyCtx);
  } catch (error) {
    const conflict = review.isDraftConflictError(error);
    pushEvent(session, 'tool.result', {
      id,
      name: 'survey_apply_operations',
      ok: false,
      result: { error: error.message, code: conflict ? 'DRAFT_WRITE_CONFLICT' : error.code },
      review: tag,
    }, run.id);
    throw Object.assign(error, conflict ? { status: 409, code: 'DRAFT_WRITE_CONFLICT' } : {});
  }
  if (result?.ok === false) {
    pushEvent(session, 'tool.result', { id, name: 'survey_apply_operations', ok: false, result, review: tag }, run.id);
    throw Object.assign(new Error(result.error || 'Applying the revision failed.'), { code: 'APPLY_FAILED', validation: result.validation });
  }
  pushEvent(session, 'tool.result', { id, name: 'survey_apply_operations', ok: true, result, review: tag }, run.id);
  ctx.surveyConfig = applyCtx.surveyConfig;
  ctx.draftMutated = true;
  ctx.draftUpdatedAt = applyCtx.draftUpdatedAt;
  if (source) {
    pushEvent(session, 'review.applied', {
      rounds: tag.rounds || [tag.round],
      source,
      draftUpdatedAt: applyCtx.draftUpdatedAt,
    }, run.id);
  }
  return { surveyConfig: applyCtx.surveyConfig, draftUpdatedAt: applyCtx.draftUpdatedAt };
}

async function runReviewChat(session, run, ctx, resolved) {
  const options = review.normalizeReviewOptions(ctx.review);
  const cost = await modelCost(ctx.provider || resolved.provider, ctx.model);
  const language = ctx.language === 'zh' ? 'Chinese (简体中文)' : '';
  let candidate = null;
  let persistTimer = null;
  const schedulePersist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistSessions().catch(() => {});
    }, 250);
  };

  const readTool = async (name, args) => {
    const config = candidate || (await readSanitizedDraft(ctx)).surveyConfig;
    if (name === 'survey_get_draft') {
      if (!candidate) return executeTool('survey_get_draft', args, { ...ctx, assistantMode: 'question' });
      return { summary: 'Proposed revision from the previous review round (not saved)', source: 'candidate', saved: false, surveyConfig: candidate };
    }
    if (name === 'survey_capabilities') return executeTool(name, args, { ...ctx, assistantMode: 'question' });
    if (name === 'survey_validate') return ctx.validateSurveyConfig(args?.surveyConfig || config);
    if (name === 'survey_answerability') return reviewAnswerability(config, ctx.validateSurveyConfig);
    if (name === 'survey_preflight') return reviewPreflight(config);
    return { ok: false, error: `Tool ${name} is not available in Review mode.` };
  };

  const subRun = async ({ system, user, submitName, parameters, description, tag, onSubmit, maxSteps }) => {
    let submitted = null;
    const loop = await runLocalLoop({
      session,
      run,
      resolved,
      model: ctx.model,
      history: [{ role: 'system', content: system }, { role: 'user', content: user }],
      tools: reviewToolDefs(submitName, parameters, description),
      execute: async (name, args) => {
        if (name === submitName) {
          submitted = onSubmit(args);
          return { ok: true, summary: 'Submitted' };
        }
        return readTool(name, args);
      },
      chat: ctx.chat,
      maxSteps,
      terminalTools: [submitName],
      tag,
      throwOnCancel: true,
    });
    return { submitted, loop };
  };

  const outcome = await review.runReviewOrchestration({
    options,
    readDraft: () => readSanitizedDraft(ctx),
    runRole: async ({ role, round, surveyConfig, surveySource, threshold, ...prompt }) => {
      candidate = surveySource === 'candidate' ? surveyConfig : null;
      const { submitted, loop } = await subRun({
        system: review.roleSystemPrompt(role, { method: prompt.method, threshold, language }),
        user: review.roleUserPrompt({ roleId: role, round, surveyConfig, surveySource, ...prompt }),
        submitName: review.REVIEW_SUBMIT_TOOL,
        parameters: review.REVIEW_SUBMIT_PARAMETERS,
        description: 'Submit your rating and comments for this review round. Call exactly once.',
        tag: { round, role },
        onSubmit: (args) => review.parseRoleReview(args, { threshold }),
        maxSteps: 6,
      });
      const parsed = submitted || (() => {
        const fallback = review.extractJsonObject(loop.content);
        return fallback ? review.parseRoleReview(fallback, { threshold }) : null;
      })();
      if (!parsed) {
        throw Object.assign(new Error(`${role} did not submit a review.`), { code: 'REVIEW_NOT_SUBMITTED', usage: loop.usage, steps: loop.steps });
      }
      return { review: parsed, usage: loop.usage, steps: loop.steps };
    },
    runRevision: async ({ round, surveyConfig, surveySource, ...prompt }) => {
      candidate = surveySource === 'candidate' ? surveyConfig : null;
      const { submitted, loop } = await subRun({
        system: review.revisionSystemPrompt({ language }),
        user: review.revisionUserPrompt({ round, surveyConfig, surveySource, ...prompt }),
        submitName: review.REVISION_SUBMIT_TOOL,
        parameters: review.REVISION_SUBMIT_PARAMETERS,
        description: 'Submit Summary, Planning, and the revision as design-protocol operations. The server dry-runs and validates them.',
        tag: { round, role: 'revision' },
        onSubmit: (args) => {
          const parsed = review.parseRevision(args);
          const checked = reviewDryRun(ctx, surveyConfig, parsed.operations);
          if (!checked.ok) {
            throw Object.assign(new Error(checked.error || 'Operations failed validation.'), {
              code: 'REVISION_INVALID',
              validation: checked.validation,
            });
          }
          return parsed;
        },
        maxSteps: 8,
      });
      if (!submitted) {
        throw Object.assign(new Error('The revision step did not submit operations.'), { code: 'REVISION_NOT_SUBMITTED', usage: loop.usage });
      }
      return { revision: submitted, usage: loop.usage, steps: loop.steps };
    },
    dryRun: (surveyConfig, operations) => reviewDryRun(ctx, surveyConfig, operations),
    applyRevision: ({ round, operations, expectedDraftUpdatedAt }) => applyReviewOperations(session, run, ctx, {
      operations,
      expectedDraftUpdatedAt,
      tag: { round, role: 'apply' },
    }),
    emit: async (type, payload) => {
      pushEvent(session, type, payload, run.id);
      schedulePersist();
    },
    checkCancelled: async () => Boolean(run.cancel),
    readInbox: async () => (session.steerQueue || []).splice(0),
    userRequest: ctx.message,
    researchContext: ctx.researchContext || null,
    tokenBudget: (baseline, normalized) => review.estimateReviewCost({
      options: normalized,
      surveyConfig: baseline?.surveyConfig,
      cost,
    }).tokenCap,
  });
  if (persistTimer) clearTimeout(persistTimer);
  if (outcome.result.status === 'failed') {
    throw Object.assign(new Error(outcome.result.error || 'Every reviewer failed.'), { code: 'REVIEW_FAILED' });
  }
  return outcome.result;
}

async function resolveChatModel(ctx) {
  const store = await readStore();
  const request = resolveProviderRequest(store, {
    provider: ctx.provider,
    apiKey: ctx.apiKey,
    baseUrl: ctx.baseUrl,
    model: ctx.model,
  });
  if (!request) return null;
  return resolveAiRequest(request.apiKey, {
    provider: request.provider,
    baseUrl: request.baseUrl,
    protocol: request.protocol,
  });
}

async function runDesignerChat(session, run, ctx) {
  const resolved = await resolveChatModel(ctx);
  if (!resolved) {
    run.status = 'failed';
    run.error = 'API key is required. Add a provider key in Assistant settings.';
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
  pushEvent(session, 'user.message', { content: ctx.message, assistantMode: ctx.assistantMode }, run.id);
  if (ctx.assistantMode === 'review') {
    let result;
    try {
      result = await runReviewChat(session, run, ctx, resolved);
    } catch (error) {
      if (error.code === 'CANCELLED') {
        run.status = 'cancelled';
        pushEvent(session, 'run.status', { status: 'cancelled' }, run.id);
        await persistSessions();
        return;
      }
      throw error;
    }
    run.status = 'completed';
    run.result = {
      message: result.summary,
      intent: 'review',
      review: result,
      surveyConfig: ctx.draftMutated ? ctx.surveyConfig : null,
      draftMutated: Boolean(ctx.draftMutated),
      persisted: Boolean(ctx.draftMutated),
      draftUpdatedAt: ctx.draftUpdatedAt || null,
      messages: eventsToMessages(session.events),
    };
    pushEvent(session, 'run.status', { status: 'completed' }, run.id);
    if (ctx.draftMutated) pushEvent(session, 'run.complete', { projectId: ctx.projectId }, run.id);
    await persistSessions();
    return;
  }

  const loop = await runLocalLoop({
    session,
    run,
    resolved,
    model: ctx.model,
    history,
    tools: toolsForMode(ctx.assistantMode),
    execute: (name, args) => executeTool(name, args, ctx),
    chat: ctx.chat,
    steering: true,
  });
  if (loop.cancelled) {
    run.status = 'cancelled';
    pushEvent(session, 'run.status', { status: 'cancelled' }, run.id);
    await persistSessions();
    return;
  }
  let finalText = loop.content;
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
  const { createProjectIo, fs: fileFs, projectsPath, skillsPath, clientOrigin, chat } = deps;
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
      const assistantMode = req.body.assistantMode || 'agent';
      let reviewOptions = null;
      if (assistantMode === 'review') {
        try {
          reviewOptions = review.normalizeReviewOptions(req.body.review);
        } catch (error) {
          return res.status(400).json({ success: false, error: error.message, code: error.code });
        }
        if (isFreeOrSharedModel(req.body.model)) {
          return res.status(400).json({
            success: false,
            code: 'REVIEW_MODEL_NOT_ALLOWED',
            error: 'Review mode runs only on models billed to your own API key. Choose a non-free model.',
          });
        }
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
        baseUrl: req.body.baseUrl || '',
        message,
        model: req.body.model || '',
        assistantMode,
        review: reviewOptions,
        language: req.body.language || null,
        chat: chat || undefined,
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

  app.post('/api/agent/review/estimate', async (req, res) => {
    try {
      const options = review.normalizeReviewOptions(req.body?.review);
      const projectId = String(req.body?.projectId || '').trim();
      let surveyConfig = null;
      if (projectId) {
        const io = createProjectIo();
        const project = await io.readProject(projectId).catch(() => null);
        surveyConfig = project ? io.sanitizeForAgent(project.surveyConfig || { pages: [] }) : null;
      }
      const cost = await modelCost(req.body?.provider, req.body?.model);
      res.json({
        success: true,
        ...review.estimateReviewCost({ options, surveyConfig, cost }),
        roles: review.REVIEW_ROLES.map(({ id, name, emoji }) => ({ id, name, emoji })),
        modelAllowed: !isFreeOrSharedModel(req.body?.model),
      });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.post('/api/agent/runs/:runId/review/apply', async (req, res) => {
    await hydrateSessions();
    let session = null;
    let run = null;
    for (const candidate of sessions.values()) {
      const found = candidate.runs.find((item) => item.id === req.params.runId);
      if (found) {
        session = candidate;
        run = found;
        break;
      }
    }
    if (!run) return res.status(404).json({ success: false, error: 'Run not found' });
    try {
      const plan = review.applicableReviewRounds(
        review.reviewFromEvents(session.events, run.id),
        Array.isArray(req.body?.rounds) ? req.body.rounds : [],
      );
      const ctx = { ...createProjectIo(), projectId: session.projectId, assistantMode: 'adjust' };
      const saved = await applyReviewOperations(session, run, ctx, {
        operations: plan.operations,
        expectedDraftUpdatedAt: plan.expectedDraftUpdatedAt,
        tag: { round: plan.rounds[plan.rounds.length - 1], role: 'apply', rounds: plan.rounds },
        source: 'user',
      });
      await persistSessions();
      res.json({
        success: true,
        rounds: plan.rounds,
        surveyConfig: saved.surveyConfig,
        draftUpdatedAt: saved.draftUpdatedAt,
        expectedDraftUpdatedAt: plan.expectedDraftUpdatedAt,
        messages: eventsToMessages(session.events),
      });
    } catch (error) {
      await persistSessions().catch(() => {});
      res.status(error.status || 500).json({
        success: false,
        error: error.message,
        code: error.code,
        messages: eventsToMessages(session.events),
      });
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

module.exports = {
  registerAgentChatApi,
  eventsToMessages,
  reviewPreflight,
  reviewAnswerability,
  isFreeOrSharedModel,
};
