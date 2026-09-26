const path = require('path');
const crypto = require('crypto');
const { resolveAiRequest, aiChat, formatAiError } = require('../../aiClient');
const {
  assignMediaForSurvey,
  diagnoseMissingMedia,
  preflightMediaForQuestions,
  questionNeedsShownMedia,
  questionWithShownMedia,
} = require('../lib/siliconMediaAssign');
const {
  siliconAnswerContract,
  validateInnerSiliconAnswer,
} = require('../lib/siliconAnswerValidate');

const DISPLAY_ONLY = new Set(['html', 'expression', 'image', 'mediadisplay']);
const SUPPORTED = new Set([
  'text', 'comment', 'consent',
  'number',
  'rating', 'imagerating', 'mediarating',
  'boolean', 'imageboolean', 'mediaboolean',
  'radiogroup', 'dropdown', 'imagepicker', 'mediapicker',
  'checkbox', 'imagecheckbox', 'mediacheckbox',
  'ranking', 'imageranking', 'mediaranking',
  'slidergroup', 'imageslidergroup', 'mediaslidergroup',
  'matrix', 'imagematrix', 'mediamatrix',
  'pointallocation', 'imagepointallocation', 'mediapointallocation',
]);
const MAX_PERSONAS_PER_RUN = 20;
const MAX_RESPONSES_PER_RUN = 100;
const MAX_UNITS_PER_RUN = 400;

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function listNamedQuestions(surveyConfig, names = null) {
  const wanted = Array.isArray(names) && names.length ? new Set(names) : null;
  const out = [];
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (wanted && !wanted.has(el.name)) continue;
      if (DISPLAY_ONLY.has(el.type)) continue;
      out.push(el);
    }
  }
  return out;
}

function collectQuestions(surveyConfig, names = null) {
  return listNamedQuestions(surveyConfig, names).filter((el) => SUPPORTED.has(el.type));
}

function unsupportedQuestionReport(surveyConfig, names = null) {
  return listNamedQuestions(surveyConfig, names)
    .filter((el) => !SUPPORTED.has(el.type))
    .map((el) => ({
      name: el.name,
      type: el.type,
      reason: `Type ${el.type || 'unknown'} is outside the Silicon pretest whitelist`,
    }));
}

function trialCountOf(question = {}) {
  const n = Number(question?.trialCount ?? question?.trials ?? 1);
  return Number.isFinite(n) && n > 1 ? Math.min(200, Math.floor(n)) : 1;
}

function mediaPool(project = {}) {
  const config = project.surveyConfig || {};
  const seen = new Set();
  const out = [];
  for (const img of [
    ...(Array.isArray(project.preloadedImages) ? project.preloadedImages : []),
    ...(Array.isArray(config.preloadedImages) ? config.preloadedImages : []),
  ]) {
    const url = typeof img === 'string' ? img : (img?.url || img?.src || img?.path);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(typeof img === 'string' ? { url } : img);
  }
  return out;
}

function mediaDataset(project = {}) {
  return project.imageDatasetConfig
    || project.surveyConfig?.imageDatasetConfig
    || {};
}

function runMediaPool(run, project) {
  const snap = run?.media_snapshot;
  if (Array.isArray(snap?.images) && snap.images.length) return snap.images;
  if (Array.isArray(snap) && snap.length) return snap;
  return mediaPool(project);
}

function runMediaDataset(run, project) {
  return run?.media_snapshot?.dataset || mediaDataset(project);
}

function urlsToParts(urls = []) {
  return (urls || [])
    .map(String)
    .filter((url) => /^https?:\/\//.test(url))
    .map((url) => ({ type: 'image_url', image_url: { url } }));
}

function preflightError(preflight) {
  const first = preflight.errors[0] || {};
  const code = first.code === 'folder_empty'
    ? 'SILICON_FOLDER_EMPTY'
    : first.code === 'image_unreadable'
      ? 'SILICON_IMAGE_UNREADABLE'
      : 'SILICON_NO_MEDIA_SOURCE';
  const error = new Error(first.error || 'No usable images for the selected questions');
  error.status = 400;
  error.code = code;
  error.details = preflight.errors;
  return error;
}

function personaPrompt(attributes = {}, name = 'Persona') {
  const city = attributes.city ? ` City: ${attributes.city}.` : '';
  const notes = attributes.notes ? ` Notes: ${attributes.notes}.` : '';
  return `You are ${name}, a survey respondent.${city}${notes} Answer as this person would.`;
}

function publicRun(run) {
  if (!run) return run;
  const { apiKey, ...rest } = run;
  return rest;
}

function summarizeRun(run) {
  return {
    ...publicRun(run),
    counts_ready: Number.isFinite(run.progress_valid),
  };
}

function countsFromUnits(units = []) {
  return {
    processed: units.filter((unit) => ['answer', 'skip', 'error'].includes(unit.status)).length,
    valid: units.filter((unit) => unit.status === 'answer').length,
    failed: units.filter((unit) => unit.status === 'error').length,
    skipped: units.filter((unit) => unit.status === 'skip').length,
  };
}

function responsesToCsv(responses = []) {
  const names = [...new Set(responses.flatMap((row) => Object.keys(row.responses || {})))];
  const header = ['id', 'persona_id', 'participant_id', 'status', ...names];
  const lines = [header.join(',')];
  responses.forEach((row) => {
    const cells = [
      row.id,
      row.persona_id,
      row.participant_id,
      row.status,
      ...names.map((name) => {
        const value = row.responses?.[name];
        const answer = value && typeof value === 'object' && 'answer' in value ? value.answer : value;
        return JSON.stringify(answer ?? '');
      }),
    ];
    lines.push(cells.join(','));
  });
  return lines.join('\n');
}

function parseModelJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return { answer: raw };
    }
  }
  return { answer: raw };
}

function questionPrompt(question) {
  const choices = (question.choices || []).map((item) => (
    typeof item === 'string' ? item : (item?.value ?? item?.text ?? item?.id ?? '')
  )).filter(Boolean);
  const rows = (question.rows || []).map((item) => (typeof item === 'string' ? item : item?.value || item?.text || '')).filter(Boolean);
  const columns = (question.columns || []).map((item) => (typeof item === 'string' ? item : item?.value || item?.text || '')).filter(Boolean);
  return [
    `Question name: ${question.name}`,
    `Type: ${question.type}`,
    `Title: ${question.title || question.name}`,
    question.description ? `Description: ${question.description}` : '',
    choices.length ? `Choices: ${choices.join(' | ')}` : '',
    rows.length ? `Rows: ${rows.join(' | ')}` : '',
    columns.length ? `Columns: ${columns.join(' | ')}` : '',
    'Return JSON only: {"answer": <value matching this question type>}.',
    'Use the choice values, not labels. For checkbox/ranking return an array. For matrix return an object of row->column. For allocation return an object of choice->number.',
    siliconAnswerContract(question),
  ].filter(Boolean).join('\n');
}

function assignUnitMedia(run, question, project, unit) {
  const seed = `${run.seed ?? run.id}:${unit.persona_id}:${unit.repeat_index || unit.repeat || 1}`;
  const assigned = assignMediaForSurvey({
    surveyConfig: run.survey_snapshot || project.surveyConfig || { pages: [{ elements: [question] }] },
    pool: runMediaPool(run, project),
    seed,
    dataset: runMediaDataset(run, project),
    questionNames: [question.name],
  });
  const raw = assigned[question.name];
  const trialSets = Array.isArray(raw?.[0]) ? raw : [raw || []];
  return trialSets[(Number(unit.trial_index) || 1) - 1] || trialSets[0] || [];
}

function stripRunSecrets(store) {
  if (!store?.runs) return store;
  store.runs = store.runs.map((run) => {
    if (!run || typeof run !== 'object') return run;
    const { apiKey, ...rest } = run;
    return rest;
  });
  return store;
}

function registerSiliconLocalApi(app, { fs, projectsPath, createProjectIo }) {
  const io = createProjectIo();
  const locks = new Map();
  const processing = new Set();
  const runApiKeys = new Map();

  const storePath = (projectId) => path.join(projectsPath, `${projectId}.silicon.json`);

  const emptyStore = () => ({ personas: [], runs: [], responses: {}, events: {}, units: {} });

  const readStore = async (projectId) => {
    const file = storePath(projectId);
    if (!await fs.pathExists(file)) return emptyStore();
    try {
      const parsed = { ...emptyStore(), ...JSON.parse(await fs.readFile(file, 'utf8')) };
      (parsed.runs || []).forEach((run) => {
        if (run?.id && run.apiKey && !runApiKeys.has(run.id)) {
          runApiKeys.set(run.id, run.apiKey);
        }
      });
      return stripRunSecrets(parsed);
    } catch {
      return emptyStore();
    }
  };

  const writeStore = async (projectId, store) => {
    await fs.ensureDir(projectsPath);
    await fs.writeFile(storePath(projectId), JSON.stringify(stripRunSecrets({
      ...store,
      runs: (store.runs || []).map((run) => ({ ...run })),
    }), null, 2), 'utf8');
  };

  const withStore = async (projectId, fn) => {
    const previous = locks.get(projectId) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    locks.set(projectId, previous.then(() => next));
    await previous;
    try {
      const store = await readStore(projectId);
      const result = await fn(store);
      await writeStore(projectId, store);
      return result;
    } finally {
      release();
      if (locks.get(projectId) === next) locks.delete(projectId);
    }
  };

  const listStores = async () => {
    const files = (await fs.readdir(projectsPath).catch(() => []))
      .filter((file) => file.endsWith('.silicon.json'));
    const stores = [];
    for (const file of files) {
      const projectId = file.replace(/\.silicon\.json$/, '');
      stores.push({ projectId, store: await readStore(projectId) });
    }
    return stores;
  };

  const findRun = async (runId) => {
    for (const { projectId, store } of await listStores()) {
      const run = store.runs.find((item) => item.id === runId);
      if (run) return { projectId, store, run };
    }
    return null;
  };

  const findPersona = async (personaId) => {
    for (const { projectId, store } of await listStores()) {
      const persona = store.personas.find((item) => item.id === personaId);
      if (persona) return { projectId, store, persona };
    }
    return null;
  };

  const pushEvent = async (projectId, runId, type, payload = {}) => {
    return withStore(projectId, (store) => {
      const events = store.events[runId] || [];
      const seq = (events.at(-1)?.seq || 0) + 1;
      const event = { seq, type, payload, createdAt: new Date().toISOString() };
      store.events[runId] = [...events, event];
      const run = store.runs.find((item) => item.id === runId);
      if (run) run.current_stage = type;
      return event;
    });
  };

  const answerUnit = async (run, persona, question, project, unit) => {
    const resolved = resolveAiRequest(runApiKeys.get(run.id) || run.apiKey);
    if (!resolved) throw new Error('API key is required. Add your OpenAI or OpenRouter key in Assistant settings.');
    const urls = assignUnitMedia(run, question, project, unit);
    if (questionNeedsShownMedia(question) && !urls.length) {
      const diagnosed = diagnoseMissingMedia(question, runMediaPool(run, project));
      const error = new Error(diagnosed.error);
      error.code = diagnosed.code;
      throw error;
    }
    const images = urlsToParts(urls);
    const prompted = questionWithShownMedia(question, urls);
    const userContent = [
      { type: 'text', text: `${persona.prompt || personaPrompt(persona.attributes, persona.name)}\n\n${questionPrompt(prompted)}` },
      ...images,
    ];
    const completion = await aiChat(resolved, 'fast', {
      model: run.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'You are a silicon pretest respondent. Answer only as JSON.' },
        { role: 'user', content: images.length ? userContent : userContent[0].text },
      ],
    });
    const parsed = parseModelJson(completion.choices?.[0]?.message?.content || '');
    const rawAnswer = parsed.answer ?? parsed;
    const checked = validateInnerSiliconAnswer(prompted, rawAnswer);
    if (!checked.ok && !checked.skipped) {
      const error = new Error(checked.reason || 'Answer failed validation for this question type.');
      error.code = 'SILICON_ANSWER_INVALID';
      throw error;
    }
    const usage = completion.usage?.total_tokens || 0;
    return { answer: checked.ok ? checked.answer : rawAnswer, tokens: usage, images, urls };
  };

  const processRun = async (projectId, runId) => {
    if (processing.has(runId)) return;
    processing.add(runId);
    try {
      const located = await findRun(runId);
      if (!located) return;
      const project = await io.readProject(projectId).catch(() => ({ surveyConfig: {} }));
      let run = located.run;
      if (run.cancel_requested) {
        await withStore(projectId, (store) => {
          const current = store.runs.find((item) => item.id === runId);
          if (current) {
            current.status = 'cancelled';
            current.finished_at = new Date().toISOString();
          }
        });
        return;
      }
      await withStore(projectId, (store) => {
        const current = store.runs.find((item) => item.id === runId);
        if (current) current.status = 'running';
      });
      await pushEvent(projectId, runId, 'run.start', { status: 'running' });

      const store = await readStore(projectId);
      run = store.runs.find((item) => item.id === runId);
      const personas = store.personas.filter((persona) => (run.persona_ids || []).includes(persona.id));
      const questions = collectQuestions(project.surveyConfig || run.survey_snapshot || {}, run.question_names);
      const units = store.units[runId] || [];
      const pending = units.filter((unit) => unit.status === 'queued' || (unit.status === 'error' && run.retry_failed));

      for (const unit of pending) {
        const latest = (await readStore(projectId)).runs.find((item) => item.id === runId);
        if (!latest || latest.cancel_requested) {
          await withStore(projectId, (current) => {
            const row = current.runs.find((item) => item.id === runId);
            if (row) {
              row.status = 'cancelled';
              row.finished_at = new Date().toISOString();
            }
          });
          await pushEvent(projectId, runId, 'run.status', { status: 'cancelled' });
          return;
        }
        if (Number(latest.tokens_used || 0) >= Number(latest.budget_tokens || 25000)) {
          await withStore(projectId, (current) => {
            const row = current.runs.find((item) => item.id === runId);
            if (row) {
              row.status = 'completed';
              row.error_summary = 'Token budget reached';
              row.finished_at = new Date().toISOString();
            }
          });
          await pushEvent(projectId, runId, 'run.status', { status: 'completed', reason: 'budget' });
          return;
        }
        const persona = personas.find((item) => item.id === unit.persona_id);
        const question = questions.find((item) => item.name === unit.question_name);
        await pushEvent(projectId, runId, 'unit.start', {
          unitId: unit.id,
          persona: persona?.name,
          question: unit.question_name,
        });
        try {
          if (!persona || !question) throw new Error('Missing persona or question');
          const result = await answerUnit(latest, persona, question, project, unit);
          await withStore(projectId, (current) => {
            const row = (current.units[runId] || []).find((item) => item.id === unit.id);
            const runRow = current.runs.find((item) => item.id === runId);
            const shownUrls = result.urls || [];
            if (row) {
              row.status = 'answer';
              row.answer = result.answer;
              row.images = shownUrls;
              row.error = null;
              row.finished_at = new Date().toISOString();
            }
            const participantId = `${runId}:${unit.persona_id}:${unit.repeat_index || unit.repeat}`;
            const responses = current.responses[runId] || [];
            let response = responses.find((item) => item.participant_id === participantId);
            if (!response) {
              response = {
                id: createId('resp'),
                run_id: runId,
                persona_id: unit.persona_id,
                participant_id: participantId,
                status: 'ok',
                responses: {},
                displayed_images: {},
                survey_metadata: {
                  persona_name: persona.name,
                  silicon_run_id: runId,
                  data_source: 'silicon',
                },
                created_at: new Date().toISOString(),
              };
              responses.push(response);
            }
            const trialsWanted = trialCountOf(question);
            if (trialsWanted > 1) {
              const shown = response.displayed_images[unit.question_name];
              const sets = Array.isArray(shown?.[0]) || (Array.isArray(shown) && shown.length === 0)
                ? [...(shown || [])]
                : (shown ? [shown] : []);
              while (sets.length < trialsWanted) sets.push([]);
              sets[(Number(unit.trial_index) || 1) - 1] = shownUrls;
              response.displayed_images[unit.question_name] = sets;
              const currentAnswer = response.responses[unit.question_name];
              const trials = Array.isArray(currentAnswer?.trials) ? [...currentAnswer.trials] : [];
              trials[(Number(unit.trial_index) || 1) - 1] = {
                answer: result.answer,
                value: result.answer,
                shown_images: shownUrls,
              };
              response.responses[unit.question_name] = { trials };
            } else {
              response.responses[unit.question_name] = { answer: result.answer };
              if (shownUrls.length) {
                response.displayed_images[unit.question_name] = shownUrls;
              }
            }
            current.responses[runId] = responses;
            if (runRow) {
              runRow.tokens_used = Number(runRow.tokens_used || 0) + Number(result.tokens || 0);
              const counts = countsFromUnits(current.units[runId]);
              runRow.progress_done = counts.processed;
              runRow.progress_processed = counts.processed;
              runRow.progress_valid = counts.valid;
              runRow.progress_failed = counts.failed;
              runRow.progress_skipped = counts.skipped;
              runRow.updated_at = new Date().toISOString();
            }
          });
          await pushEvent(projectId, runId, 'answer', { unitId: unit.id, question: unit.question_name });
        } catch (error) {
          await withStore(projectId, (current) => {
            const row = (current.units[runId] || []).find((item) => item.id === unit.id);
            const runRow = current.runs.find((item) => item.id === runId);
            if (row) {
              row.status = 'error';
              row.error = formatAiError(error);
              row.finished_at = new Date().toISOString();
            }
            if (runRow) {
              const counts = countsFromUnits(current.units[runId]);
              runRow.progress_done = counts.processed;
              runRow.progress_processed = counts.processed;
              runRow.progress_valid = counts.valid;
              runRow.progress_failed = counts.failed;
              runRow.progress_skipped = counts.skipped;
              runRow.error_summary = formatAiError(error);
              runRow.updated_at = new Date().toISOString();
            }
          });
          await pushEvent(projectId, runId, 'error', { unitId: unit.id, error: formatAiError(error) });
        }
      }

      await withStore(projectId, (current) => {
        const runRow = current.runs.find((item) => item.id === runId);
        if (!runRow || runRow.status === 'cancelled') return;
        const leftover = (current.units[runId] || []).some((unit) => unit.status === 'queued');
        runRow.status = leftover ? 'running' : 'completed';
        runRow.finished_at = leftover ? null : new Date().toISOString();
        runRow.retry_failed = false;
        const counts = countsFromUnits(current.units[runId]);
        runRow.progress_done = counts.processed;
        runRow.progress_processed = counts.processed;
        runRow.progress_valid = counts.valid;
        runRow.progress_failed = counts.failed;
        runRow.progress_skipped = counts.skipped;
      });
      await pushEvent(projectId, runId, 'run.status', { status: 'completed' });
    } catch (error) {
      await withStore(projectId, (current) => {
        const runRow = current.runs.find((item) => item.id === runId);
        if (runRow) {
          runRow.status = 'failed';
          runRow.error_summary = formatAiError(error);
          runRow.finished_at = new Date().toISOString();
        }
      });
      await pushEvent(projectId, runId, 'error', { message: formatAiError(error) });
    } finally {
      processing.delete(runId);
    }
  };

  const startRun = (projectId, runId) => {
    const later = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);
    later(() => {
      processRun(projectId, runId).catch((error) => {
        console.error('Silicon run failed:', error.message);
      });
    });
  };

  const sendError = (res, error) => {
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  };

  app.get('/api/agent/silicon/personas', async (req, res) => {
    try {
      const projectId = String(req.query.projectId || '');
      if (!projectId) return res.status(400).json({ success: false, error: 'projectId is required' });
      const store = await readStore(projectId);
      res.json({ success: true, personas: store.personas });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/silicon/personas', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || '');
      const name = String(req.body?.name || '').trim().slice(0, 80);
      if (!projectId || !name) {
        return res.status(400).json({ success: false, error: 'projectId and name are required' });
      }
      const attributes = req.body.attributes || {};
      const persona = await withStore(projectId, (store) => {
        const existing = req.body.id ? store.personas.find((item) => item.id === req.body.id) : null;
        if (existing) {
          existing.name = name;
          existing.attributes = attributes;
          existing.prompt = String(req.body.prompt || personaPrompt(attributes, name)).slice(0, 4000);
          existing.updated_at = new Date().toISOString();
          return existing;
        }
        const created = {
          id: createId('persona'),
          project_id: projectId,
          name,
          attributes,
          prompt: String(req.body.prompt || personaPrompt(attributes, name)).slice(0, 4000),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        store.personas.unshift(created);
        return created;
      });
      res.json({ success: true, persona, prompt: persona.prompt });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/agent/silicon/personas/:id', async (req, res) => {
    try {
      const found = await findPersona(req.params.id);
      if (!found) return res.status(404).json({ success: false, error: 'Persona not found' });
      await withStore(found.projectId, (store) => {
        store.personas = store.personas.filter((item) => item.id !== req.params.id);
      });
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/agent/silicon/runs', async (req, res) => {
    try {
      const projectId = String(req.query.projectId || '');
      if (!projectId) return res.status(400).json({ success: false, error: 'projectId is required' });
      const store = await readStore(projectId);
      res.json({ success: true, runs: store.runs.map(summarizeRun) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/silicon/runs', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || '');
      const personaIds = Array.isArray(req.body?.personaIds) ? req.body.personaIds : [];
      const apiKey = String(req.body?.apiKey || '').trim();
      if (!projectId || !personaIds.length) {
        return res.status(400).json({ success: false, error: 'projectId and personaIds are required' });
      }
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: 'API key is required. Add your OpenAI or OpenRouter key in Assistant settings.',
        });
      }
      const project = await io.readProject(projectId);
      const requestedNames = Array.isArray(req.body.questionNames)
        ? req.body.questionNames.filter(Boolean)
        : [];
      const supported = collectQuestions(project.surveyConfig || {});
      const names = requestedNames.length ? requestedNames : supported.map((question) => question.name);
      const unsupported = unsupportedQuestionReport(project.surveyConfig || {}, names);
      if (unsupported.length) {
        return res.status(400).json({
          success: false,
          error: `Silicon cannot run these questions: ${unsupported.map((item) => `${item.name} (${item.reason})`).join('; ')}`,
          code: 'SILICON_UNSUPPORTED_QUESTIONS',
          details: unsupported,
        });
      }
      const questions = collectQuestions(project.surveyConfig || {}, names);
      if (!questions.length) {
        return res.status(400).json({
          success: false,
          error: 'No Silicon-supported questions in this draft',
          code: 'SILICON_NO_SUPPORTED_QUESTIONS',
        });
      }
      const limitedPersonaIds = [...new Set(personaIds)].slice(0, MAX_PERSONAS_PER_RUN);
      const repeats = Math.max(1, Math.min(20, Number(req.body.repeats) || 1));
      const now = new Date().toISOString();
      const pool = mediaPool(project);
      const dataset = mediaDataset(project);
      const preflight = preflightMediaForQuestions({
        surveyConfig: project.surveyConfig || {},
        questionNames: questions.map((question) => question.name),
        pool,
        dataset,
      });
      if (!preflight.ok) {
        const error = preflightError(preflight);
        return res.status(400).json({
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      const run = await withStore(projectId, (store) => {
        const selected = store.personas.filter((persona) => limitedPersonaIds.includes(persona.id));
        if (!selected.length) {
          const error = new Error('Select at least one persona');
          error.status = 400;
          throw error;
        }
        const envelopes = selected.length * repeats;
        if (envelopes > MAX_RESPONSES_PER_RUN) {
          const error = new Error(`A Silicon run is limited to ${MAX_RESPONSES_PER_RUN} responses`);
          error.status = 400;
          error.code = 'RUN_TOO_LARGE';
          throw error;
        }
        const units = [];
        selected.forEach((persona) => {
          for (let repeat = 1; repeat <= repeats; repeat += 1) {
            questions.forEach((question) => {
              const trials = trialCountOf(question);
              for (let trial = 1; trial <= trials; trial += 1) {
                units.push({
                  id: createId('unit'),
                  run_id: null,
                  persona_id: persona.id,
                  question_name: question.name,
                  repeat,
                  repeat_index: repeat,
                  trial_index: trial,
                  status: 'queued',
                });
              }
            });
          }
        });
        if (units.length > MAX_UNITS_PER_RUN) {
          const error = new Error(`A Silicon run is limited to ${MAX_UNITS_PER_RUN} answer units`);
          error.status = 400;
          error.code = 'RUN_TOO_LARGE';
          throw error;
        }
        const created = {
          id: createId('srun'),
          project_id: projectId,
          project_name: project.name || project.project?.name || projectId,
          status: 'queued',
          persona_ids: selected.map((persona) => persona.id),
          persona_snapshot: selected,
          repeats,
          seed: Number.isFinite(Number(req.body.seed)) ? Number(req.body.seed) : 42,
          provider: req.body.provider || (apiKey.startsWith('sk-or-') ? 'openrouter' : 'openai'),
          model: req.body.model || '',
          reasoning_effort: req.body.reasoningEffort || req.body.reasoning_effort || null,
          budget_tokens: Number(req.body.budgetTokens || 25000),
          tokens_used: 0,
          progress_done: 0,
          progress_total: units.length,
          progress_processed: 0,
          progress_valid: 0,
          progress_failed: 0,
          progress_skipped: 0,
          question_names: questions.map((question) => question.name),
          survey_snapshot: project.surveyConfig || {},
          media_snapshot: {
            source: pool.length ? 'project' : 'none',
            images: pool,
            dataset,
            availableCount: pool.length,
          },
          draft_updated_at: project.draftUpdatedAt || project.savedAt || now,
          source_kind: 'local',
          cancel_requested: false,
          created_at: now,
          updated_at: now,
          finished_at: null,
        };
        units.forEach((unit) => { unit.run_id = created.id; });
        store.runs.unshift(created);
        store.units[created.id] = units;
        store.responses[created.id] = [];
        store.events[created.id] = [];
        runApiKeys.set(created.id, apiKey);
        return created;
      });
      startRun(projectId, run.id);
      res.json({ success: true, run: summarizeRun(run) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/agent/silicon/runs/:runId/process', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    startRun(found.projectId, found.run.id);
    res.json({ success: true, queued: true });
  });

  app.post('/api/agent/silicon/runs/:runId/cancel', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    await withStore(found.projectId, (store) => {
      const run = store.runs.find((item) => item.id === req.params.runId);
      if (run) {
        run.cancel_requested = true;
        run.updated_at = new Date().toISOString();
      }
    });
    res.json({ success: true });
  });

  app.post('/api/agent/silicon/runs/:runId/resume', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    await withStore(found.projectId, (store) => {
      const run = store.runs.find((item) => item.id === req.params.runId);
      if (run) {
        run.cancel_requested = false;
        run.status = 'queued';
        run.finished_at = null;
      }
    });
    startRun(found.projectId, found.run.id);
    res.json({ success: true });
  });

  app.post('/api/agent/silicon/runs/:runId/retry-failed', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    await withStore(found.projectId, (store) => {
      const run = store.runs.find((item) => item.id === req.params.runId);
      (store.units[req.params.runId] || []).forEach((unit) => {
        if (unit.status === 'error') unit.status = 'queued';
      });
      if (run) {
        run.retry_failed = true;
        run.cancel_requested = false;
        run.status = 'queued';
        run.finished_at = null;
      }
    });
    startRun(found.projectId, found.run.id);
    res.json({ success: true });
  });

  app.get('/api/agent/silicon/tasks', async (req, res) => {
    const stores = await listStores();
    const runs = stores.flatMap(({ store }) => store.runs.map(summarizeRun))
      .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    const active = runs.filter((run) => ['queued', 'draft', 'running'].includes(run.status) || run.cancel_requested);
    res.json({ success: true, active, recent: runs.filter((run) => !active.includes(run)).slice(0, 20) });
  });

  app.get('/api/agent/silicon/runs/:runId/progress', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    const after = Number(req.query.after || 0);
    const events = (found.store.events[req.params.runId] || []).filter((event) => event.seq > after);
    const units = found.store.units[req.params.runId] || [];
    res.json({
      success: true,
      run: summarizeRun(found.run),
      events,
      units,
      counts: countsFromUnits(units),
      current_stage: found.run.current_stage,
      nextCursor: events.at(-1)?.seq || after,
    });
  });

  app.get('/api/agent/silicon/runs/:runId', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    res.json({ success: true, run: summarizeRun(found.run) });
  });

  app.get('/api/agent/silicon/runs/:runId/responses', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    res.json({ success: true, responses: found.store.responses[req.params.runId] || [] });
  });

  app.get('/api/agent/silicon/runs/:runId/compare', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    const responses = found.store.responses[req.params.runId] || [];
    const byQuestion = {};
    responses.forEach((row) => {
      Object.entries(row.responses || {}).forEach(([name, value]) => {
        if (!byQuestion[name]) byQuestion[name] = [];
        byQuestion[name].push({
          personaId: row.persona_id,
          persona_name: row.survey_metadata?.persona_name || null,
          answer: value?.answer != null ? value.answer : value,
          valid: row.status === 'ok',
          status: row.status,
          images: row.displayed_images?.[name] || [],
          displayed_images: row.displayed_images?.[name] || [],
          responses: row.responses || {},
          participantId: row.participant_id,
        });
      });
    });
    const units = found.store.units[req.params.runId] || [];
    res.json({
      success: true,
      run: summarizeRun(found.run),
      responseCount: responses.length,
      byQuestion,
      eventCounts: countsFromUnits(units),
      responses,
      disclaimer: 'Silicon samples are for instrument pretest and hypothesis sketch. They do not replace human respondents.',
      response_source: 'silicon',
    });
  });

  app.get('/api/agent/silicon/runs/:runId/export', async (req, res) => {
    const found = await findRun(req.params.runId);
    if (!found) return res.status(404).json({ success: false, error: 'Run not found' });
    const responses = found.store.responses[req.params.runId] || [];
    const units = found.store.units[req.params.runId] || [];
    res.json({
      success: true,
      format: 'silicon-pretest-v1',
      response_source: 'silicon',
      run: summarizeRun(found.run),
      units,
      responses,
      events: found.store.events[req.params.runId] || [],
      csv: responsesToCsv(responses),
      disclaimer: 'Synthetic pretest export. Do not mix with survey_responses.',
    });
  });
}

module.exports = { registerSiliconLocalApi };
