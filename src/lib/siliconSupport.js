export const SILICON_DISPLAY_ONLY = Object.freeze(['html', 'expression', 'image', 'mediadisplay']);

export const SILICON_SUPPORTED_TYPES = Object.freeze([
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
  'imageannotation',
  'skillquestion',
]);

export const SILICON_UNVERIFIED_TYPES = Object.freeze(['imageannotation', 'skillquestion']);

const SLIDER_TYPES = new Set(['slidergroup', 'imageslidergroup', 'mediaslidergroup']);
const MATRIX_TYPES = new Set(['matrix', 'imagematrix', 'mediamatrix']);
const ALLOCATION_TYPES = new Set(['pointallocation', 'imagepointallocation', 'mediapointallocation']);

function asList(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (item == null) return '';
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(item.value ?? item.text ?? item.id ?? '');
  }).filter(Boolean);
}

export function collectQuestions(surveyConfig, names = null) {
  const wanted = Array.isArray(names) && names.length ? new Set(names) : null;
  const out = [];
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (wanted && !wanted.has(el.name)) continue;
      if (SILICON_DISPLAY_ONLY.includes(el.type)) continue;
      out.push(el);
    }
  }
  return out;
}

export function classifyQuestion(question = {}) {
  const type = question.type || '';
  if (SILICON_DISPLAY_ONLY.includes(type)) {
    return { supported: false, reason: `Type ${type} is display-only` };
  }
  if (!SILICON_SUPPORTED_TYPES.includes(type)) {
    return { supported: false, reason: `Type ${type || 'unknown'} is outside the Silicon pretest whitelist` };
  }
  if (SILICON_UNVERIFIED_TYPES.includes(type)) {
    return { supported: false, verified: false, reason: `Type ${type} is listed but not preview-accepted yet` };
  }
  if (SLIDER_TYPES.has(type) && !(question.dimensions || []).some((item) => item?.id)) {
    return { supported: false, reason: 'Slider questions need at least one dimension id before Silicon can answer them' };
  }
  if (MATRIX_TYPES.has(type) && (!asList(question.rows).length || !asList(question.columns).length)) {
    return { supported: false, reason: 'Matrix questions need rows and columns before Silicon can answer them' };
  }
  if (ALLOCATION_TYPES.has(type) && !asList(question.choices).length) {
    return { supported: false, reason: 'Allocation questions need at least one choice before Silicon can answer them' };
  }
  return { supported: true };
}

export function siliconQuestionReport(surveyConfig, names = null) {
  const rows = collectQuestions(surveyConfig, names).map((question) => ({
    name: question.name,
    type: question.type,
    title: question.title || question.name,
    ...classifyQuestion(question),
  }));
  return {
    supported: rows.filter((item) => item.supported),
    unverified: rows.filter((item) => item.verified === false),
    unsupported: rows.filter((item) => !item.supported && item.verified !== false),
  };
}

export function siliconCountsReady(run = {}, counts = {}) {
  if (counts.hydrated === true) return true;
  if (Number.isFinite(counts.answer) || Number.isFinite(counts.valid)) return true;
  if (run.counts_ready === true) return true;
  return Number.isFinite(run.progress_valid);
}

export function trialCountOf(question = {}) {
  const n = Number(question?.trialCount ?? question?.trials ?? 1);
  return Number.isFinite(n) && n > 1 ? Math.min(200, Math.floor(n)) : 1;
}

export function siliconPlanSummary({
  personaCount = 0,
  repeats = 1,
  questions = [],
  questionNames,
  surveyConfig,
} = {}) {
  const personas = Math.max(0, Number(personaCount) || 0);
  const repeatCount = Math.max(1, Number(repeats) || 1);
  const list = Array.isArray(questions) && questions.length
    ? questions
    : collectQuestions(surveyConfig, questionNames);
  const trialSum = list.reduce((sum, question) => sum + trialCountOf(question), 0);
  return {
    personas,
    repeats: repeatCount,
    envelopes: personas * repeatCount,
    questions: list.length,
    trials: personas * repeatCount * trialSum,
  };
}

export function siliconRunPlan(run = {}, surveyConfig = null) {
  const planned = Array.isArray(run.execution_plan?.questions)
    ? run.execution_plan.questions.filter((question) => question.supported !== false)
    : [];
  const survey = surveyConfig || run.survey_snapshot || {};
  const fromSurvey = collectQuestions(survey, run.question_names);
  const names = Array.isArray(run.question_names) ? run.question_names.filter(Boolean) : [];
  const questions = planned.length ? planned : fromSurvey;
  const summary = siliconPlanSummary({
    personaCount: Array.isArray(run.persona_ids) ? run.persona_ids.length : 0,
    repeats: run.repeats,
    questions: questions.length ? questions : names.map((name) => ({ name, trialCount: 1 })),
    questionNames: names,
    surveyConfig: survey,
  });
  if (!planned.length && !fromSurvey.length && Number(run.progress_total) > 0) {
    summary.questions = names.length || summary.questions;
    summary.trials = Number(run.progress_total);
  }
  return summary;
}

export function surveyQuestionOrdinals(surveyConfig) {
  const map = {};
  let index = 0;
  for (const page of surveyConfig?.pages || []) {
    for (const el of page.elements || []) {
      if (!el?.name || SILICON_DISPLAY_ONLY.includes(el.type)) continue;
      index += 1;
      if (map[el.name] == null) {
        map[el.name] = { n: index, title: el.title || el.name, type: el.type };
      }
    }
  }
  return map;
}

export function siliconMediaInfo(run = {}) {
  const planned = run.execution_plan?.media || {};
  const snapshot = run.media_snapshot && !Array.isArray(run.media_snapshot) ? run.media_snapshot : {};
  const images = Array.isArray(snapshot.images) ? snapshot.images : (Array.isArray(run.media_snapshot) ? run.media_snapshot : []);
  const source = planned.source || snapshot.source || (images.length ? 'project' : 'none');
  const availableCount = Number(
    planned.availableCount ?? snapshot.availableCount ?? images.length ?? 0,
  );
  return { source, availableCount, images };
}

export function siliconRunDurationMs(run = {}) {
  const start = Date.parse(run.created_at || '');
  if (!Number.isFinite(start)) return null;
  const rawEnd = run.finished_at || (
    ['queued', 'draft', 'running'].includes(run.status) ? Date.now() : run.updated_at
  );
  const end = typeof rawEnd === 'number' ? rawEnd : Date.parse(rawEnd || '');
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

export function siliconRunCounts(run = {}, counts = {}) {
  if (siliconCountsReady(run, counts)) {
    return {
      processed: Number(counts.processed ?? run.progress_processed ?? run.progress_done ?? 0),
      valid: Number(counts.valid ?? counts.answer ?? run.progress_valid ?? 0),
      failed: Number(counts.failed ?? counts.error ?? run.progress_failed ?? 0),
      skipped: Number(counts.skipped ?? counts.skip ?? run.progress_skipped ?? 0),
      total: Number(counts.total ?? run.progress_total ?? 0),
      ready: true,
    };
  }
  return { processed: null, valid: null, failed: null, skipped: null, total: Number(run.progress_total || 0) || null, ready: false };
}

export function siliconRunOutcome(run = {}, counts = {}) {
  const status = run.status || '';
  const summary = String(run.error_summary || '');
  const hydrated = siliconCountsReady(run, counts);
  const tallies = siliconRunCounts(run, { ...counts, hydrated: counts.hydrated, processed: counts.processed ?? 0 });
  const answered = Number(counts.answer ?? tallies.valid ?? 0);
  const errors = Number(counts.error ?? tallies.failed ?? 0);
  const skipped = Number(counts.skip ?? tallies.skipped ?? 0);
  if (run.cancel_requested && ['queued', 'draft', 'running'].includes(status)) return 'stopping';
  if (run.current_stage?.phase === 'waiting_interactive') return 'throttled';
  if (status === 'queued' || status === 'draft') return 'queued';
  if (status === 'running') return 'running';
  if (!hydrated && ['completed', 'partial', 'failed'].includes(status)) return 'loading';
  if (status === 'completed') {
    if (answered === 0 && (errors > 0 || skipped > 0)) return 'allFailed';
    if (errors > 0 || skipped > 0) return 'partialValid';
    if (answered === 0) return 'partialValid';
    return 'allComplete';
  }
  if (status === 'partial' || (/budget exhausted/i.test(summary) && status !== 'failed')) return 'budgetPartial';
  if (status === 'failed' && /budget/i.test(summary)) return 'budgetFailed';
  if (status === 'failed') {
    if (answered === 0) return 'allFailed';
    return 'failed';
  }
  if (status === 'cancelled') return 'cancelled';
  return status || 'unknown';
}

function envelopeKey(personaId, repeat) {
  return `${personaId || ''}:${Number(repeat) || 1}`;
}

export function groupSiliconProcess({ run = {}, units = [], events = [] } = {}) {
  const survey = run.survey_snapshot || {};
  const ordinals = surveyQuestionOrdinals(survey);
  const personas = new Map((run.persona_snapshot || []).map((row) => [row.id, row]));
  const plannedQuestions = Array.isArray(run.execution_plan?.questions)
    ? run.execution_plan.questions.filter((question) => question.supported !== false)
    : collectQuestions(survey, run.question_names);
  const questionOrder = plannedQuestions.map((question) => question.name);
  const envelopes = new Map();

  const ensureEnvelope = (personaId, repeat) => {
    const key = envelopeKey(personaId, repeat);
    if (!envelopes.has(key)) {
      envelopes.set(key, {
        key,
        personaId,
        personaName: personas.get(personaId)?.name || personaId,
        repeat: Number(repeat) || 1,
        questions: new Map(),
      });
    }
    return envelopes.get(key);
  };

  const ensureQuestion = (envelope, name) => {
    if (!envelope.questions.has(name)) {
      const planned = plannedQuestions.find((question) => question.name === name) || {};
      const ordinal = ordinals[name] || {};
      envelope.questions.set(name, {
        name,
        title: ordinal.title || planned.title || name,
        ordinal: ordinal.n || null,
        trialCount: Math.max(1, Number(planned.trials) || trialCountOf(planned)),
        trials: new Map(),
      });
    }
    return envelope.questions.get(name);
  };

  const personaIds = Array.isArray(run.persona_ids) && run.persona_ids.length
    ? run.persona_ids
    : [...new Set((units || []).map((unit) => unit.persona_id).filter(Boolean))];
  const repeats = Math.max(1, Number(run.repeats || 1));
  for (const personaId of personaIds) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const envelope = ensureEnvelope(personaId, repeat);
      for (const question of plannedQuestions) {
        const card = ensureQuestion(envelope, question.name);
        for (let trial = 1; trial <= card.trialCount; trial += 1) {
          if (!card.trials.has(trial)) {
            card.trials.set(trial, {
              key: `${envelope.key}:${question.name}:${trial}`,
              trialIndex: trial,
              status: 'pending',
              error: null,
              answer: null,
              rationale: '',
              images: [],
              events: [],
            });
          }
        }
      }
    }
  }

  for (const unit of units || []) {
    const envelope = ensureEnvelope(unit.persona_id, unit.repeat_index);
    const card = ensureQuestion(envelope, unit.question_name);
    const trialIndex = Number(unit.trial_index) || 1;
    card.trialCount = Math.max(card.trialCount, trialIndex);
    card.trials.set(trialIndex, {
      key: `${envelope.key}:${unit.question_name}:${trialIndex}`,
      trialIndex,
      status: unit.status || 'pending',
      error: unit.error || null,
      answer: unit.answer ?? null,
      rationale: unit.rationale || '',
      images: Array.isArray(unit.images) ? unit.images : [],
      events: [],
    });
  }

  for (const event of events || []) {
    const payload = event.payload || {};
    const personaId = payload.persona_id;
    const questionName = event.question_name || payload.question_name;
    if (!personaId || !questionName) continue;
    const envelope = envelopes.get(envelopeKey(personaId, payload.repeat_index || 1));
    if (!envelope) continue;
    const card = envelope.questions.get(questionName);
    if (!card) continue;
    const trialIndex = Number(payload.trial_index) || 1;
    const trial = card.trials.get(trialIndex) || {
      key: `${envelope.key}:${questionName}:${trialIndex}`,
      trialIndex,
      status: 'pending',
      error: null,
      answer: null,
      rationale: '',
      images: [],
      events: [],
    };
    trial.events.push(event);
    if ((!trial.images || !trial.images.length) && Array.isArray(payload.images) && payload.images.length) {
      trial.images = payload.images;
    }
    if (!trial.rationale && payload.rationale) trial.rationale = payload.rationale;
    if (trial.answer == null && payload.answer != null) trial.answer = payload.answer;
    if (!trial.error && payload.error) trial.error = payload.error;
    card.trials.set(trialIndex, trial);
  }

  const questionRank = (name) => {
    const ordinal = ordinals[name]?.n;
    if (Number.isFinite(ordinal)) return ordinal;
    const planned = questionOrder.indexOf(name);
    return planned >= 0 ? planned + 1000 : 10000;
  };

  return [...envelopes.values()].map((envelope) => ({
    key: envelope.key,
    personaId: envelope.personaId,
    personaName: envelope.personaName,
    repeat: envelope.repeat,
    questions: [...envelope.questions.values()]
      .sort((a, b) => questionRank(a.name) - questionRank(b.name))
      .map((question) => {
        const trials = [...question.trials.values()].sort((a, b) => a.trialIndex - b.trialIndex);
        const statuses = trials.map((trial) => trial.status);
        const open = statuses.some((status) => ['pending', 'leased', 'unknown'].includes(status));
        const saved = statuses.filter((status) => status === 'saved').length;
        const skipped = statuses.filter((status) => status === 'skipped').length;
        const failed = statuses.filter((status) => status === 'failed').length;
        let state = 'waiting';
        if (open && (saved || skipped || failed)) state = 'active';
        else if (open) state = statuses.some((status) => status === 'leased') ? 'active' : 'waiting';
        else if (failed || (skipped && saved === 0)) state = 'failed';
        else if (skipped || failed) state = 'partial';
        else if (saved === trials.length && trials.length) state = 'done';
        return {
          name: question.name,
          title: question.title,
          ordinal: question.ordinal,
          trialCount: Math.max(question.trialCount, trials.length, 1),
          state,
          processed: saved + skipped + failed,
          valid: saved,
          skipped,
          failed,
          currentTrial: trials.find((trial) => ['pending', 'leased', 'unknown'].includes(trial.status))?.trialIndex || null,
          trials,
        };
      }),
  }));
}
