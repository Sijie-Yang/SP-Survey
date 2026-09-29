/**
 * Review mode: multi-agent survey review as harness sub-runs.
 *
 * Pure orchestration shared in shape with SP-Survey-Platform
 * (worker-lib/agent/runtime/review.mjs); keep the two in sync. The caller
 * injects the model sub-loop, draft reader, dry-run, and validated apply path.
 */

const REVIEW_ROLES = Object.freeze([
  {
    id: 'scientist',
    name: 'Scientist',
    emoji: '🔬',
    expertise: 'Urban science research design, validity, sampling and spatial analysis',
    focus: [
      'Research question clarity and feasibility',
      'Sampling strategy and data collection methods',
      'Scientific rigor, construct validity and confounds',
      'Fit with the stated research context',
    ],
  },
  {
    id: 'participant',
    name: 'Participant',
    emoji: '👤',
    expertise: 'Participant experience, survey usability and accessibility',
    focus: [
      'Survey length, fatigue and engagement',
      'Question clarity from a participant perspective',
      'Interface flow, instructions and accessibility',
      'Motivation and completion likelihood',
    ],
  },
  {
    id: 'planner',
    name: 'Planner',
    emoji: '🏙️',
    expertise: 'Urban planning and design, streetscape quality and placemaking',
    focus: [
      'Coverage of the streetscape or place qualities under study',
      'Visual quality criteria and media/trial design',
      'Relevance of findings to design and policy decisions',
      'Public-space considerations',
    ],
  },
  {
    id: 'psychologist',
    name: 'Psychologist',
    emoji: '🧠',
    expertise: 'Perception psychology, measurement and question wording',
    focus: [
      'Question wording and cognitive load',
      'Response bias, anchoring and order effects',
      'Scale appropriateness and rating methods',
      'Ethics and informed consent',
    ],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    emoji: '📊',
    expertise: 'Statistical analysis, data quality and export readiness',
    focus: [
      'Data quality and completeness',
      'Statistical analysis readiness and power',
      'Variable operationalization and stable question names',
      'Export and analysis workflow',
    ],
  },
]);

const REVIEW_ROLE_IDS = Object.freeze(REVIEW_ROLES.map((role) => role.id));
const REVIEW_METHODS = Object.freeze(['linear', 'group']);
const REVIEW_APPLY_MODES = Object.freeze(['review', 'apply']);
const REVIEW_LIMITS = Object.freeze({
  maxRoles: REVIEW_ROLES.length,
  minRounds: 1,
  maxRounds: 5,
  minThreshold: 1,
  maxThreshold: 10,
});
const REVIEW_DEFAULTS = Object.freeze({
  roles: REVIEW_ROLE_IDS,
  method: 'linear',
  maxRounds: 2,
  threshold: 8,
  applyMode: 'review',
});

const REVIEW_SUBMIT_TOOL = 'review_submit';
const REVISION_SUBMIT_TOOL = 'review_submit_revision';
const REVIEW_READ_TOOLS = Object.freeze([
  'survey_capabilities',
  'survey_get_draft',
  'survey_validate',
  'survey_answerability',
  'survey_preflight',
]);

const SEVERITIES = ['high', 'medium', 'low'];
const EMBED_DRAFT_CHARS = 40000;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function reviewOptionsError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_REVIEW_OPTIONS' });
}

function roleById(id) {
  return REVIEW_ROLES.find((role) => role.id === id) || null;
}

function normalizeReviewOptions(raw = {}, { maxRoles = REVIEW_LIMITS.maxRoles } = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const requested = Array.isArray(input.roles) ? input.roles : REVIEW_DEFAULTS.roles;
  const roles = REVIEW_ROLE_IDS.filter((id) => requested.includes(id));
  const unknown = requested.filter((id) => !REVIEW_ROLE_IDS.includes(id));
  if (unknown.length) throw reviewOptionsError(`Unknown reviewer role: ${unknown.join(', ')}`);
  if (!roles.length) throw reviewOptionsError('Select at least one reviewer role.');
  const cap = clampInt(input.maxRoles ?? maxRoles, 1, REVIEW_LIMITS.maxRoles, REVIEW_LIMITS.maxRoles);
  if (roles.length > cap) {
    throw reviewOptionsError(`At most ${cap} reviewer role(s) may run in one review.`);
  }
  const method = REVIEW_METHODS.includes(input.method) ? input.method : REVIEW_DEFAULTS.method;
  const applyMode = REVIEW_APPLY_MODES.includes(input.applyMode) ? input.applyMode : REVIEW_DEFAULTS.applyMode;
  return {
    roles,
    method,
    maxRounds: clampInt(input.maxRounds, REVIEW_LIMITS.minRounds, REVIEW_LIMITS.maxRounds, REVIEW_DEFAULTS.maxRounds),
    threshold: clampInt(input.threshold, REVIEW_LIMITS.minThreshold, REVIEW_LIMITS.maxThreshold, REVIEW_DEFAULTS.threshold),
    applyMode,
    maxRoles: cap,
  };
}

// ── Cost estimate ─────────────────────────────────────────────────────────────

const SYSTEM_TOKENS = 1100;
const ROLE_OUTPUT_TOKENS = 700;
const REVISION_OUTPUT_TOKENS = 2400;
const PRIOR_TURN_TOKENS = 320;
const CAPABILITY_TOKENS = 2600;
const STEPS_PER_ROLE = 2;
const STEPS_PER_REVISION = 3;

function estimateDraftTokens(surveyConfig) {
  const chars = JSON.stringify(surveyConfig || {}).length;
  return Math.ceil(Math.min(chars, EMBED_DRAFT_CHARS) / 4);
}

function roundTokens(options, draftTokens) {
  const count = options.roles.length;
  let input = 0;
  for (let index = 0; index < count; index += 1) {
    const prior = options.method === 'group' ? index * PRIOR_TURN_TOKENS : 0;
    input += STEPS_PER_ROLE * (SYSTEM_TOKENS + draftTokens + prior) + Math.ceil(draftTokens / 2);
  }
  const output = count * ROLE_OUTPUT_TOKENS;
  const revisionInput = STEPS_PER_REVISION * (SYSTEM_TOKENS + draftTokens + count * PRIOR_TURN_TOKENS)
    + CAPABILITY_TOKENS;
  return { input, output, revisionInput, revisionOutput: REVISION_OUTPUT_TOKENS };
}

/**
 * Upper and lower bounds before running. `cost` follows the catalog shape
 * (USD per million input/output tokens); unknown pricing yields costUsd=null.
 */
function estimateReviewCost({ options: rawOptions, surveyConfig, draftTokens, cost = null } = {}) {
  const options = normalizeReviewOptions(rawOptions);
  const tokens = Number.isFinite(draftTokens) ? draftTokens : estimateDraftTokens(surveyConfig);
  const perRound = roundTokens(options, tokens);
  const min = { input: perRound.input, output: perRound.output };
  const max = {
    input: options.maxRounds * (perRound.input + perRound.revisionInput),
    output: options.maxRounds * (perRound.output + perRound.revisionOutput),
  };
  const price = cost && Number.isFinite(Number(cost.input)) && Number.isFinite(Number(cost.output))
    ? { input: Number(cost.input), output: Number(cost.output) }
    : null;
  const usd = (bucket) => (price
    ? Math.round(((bucket.input * price.input + bucket.output * price.output) / 1e6) * 10000) / 10000
    : null);
  return {
    options,
    draftTokens: tokens,
    modelCalls: {
      min: options.roles.length * STEPS_PER_ROLE,
      max: options.maxRounds * (options.roles.length * STEPS_PER_ROLE + STEPS_PER_REVISION),
    },
    tokens: {
      min: min.input + min.output,
      max: max.input + max.output,
      minInput: min.input,
      minOutput: min.output,
      maxInput: max.input,
      maxOutput: max.output,
    },
    costUsd: price ? { min: usd(min), max: usd(max) } : null,
    tokenCap: Math.ceil((max.input + max.output) * 1.5),
  };
}

// ── Prompts ──────────────────────────────────────────────────────────────────

function compactSurveyForPrompt(surveyConfig) {
  const text = JSON.stringify(surveyConfig || {});
  if (text.length <= EMBED_DRAFT_CHARS) return text;
  const outline = {
    title: surveyConfig?.title || '',
    truncated: true,
    pages: (surveyConfig?.pages || []).map((page) => ({
      name: page?.name,
      title: page?.title,
      elements: (page?.elements || []).map((element) => ({
        name: element?.name,
        type: element?.type,
        title: element?.title,
        isRequired: element?.isRequired,
      })),
    })),
  };
  return `${JSON.stringify(outline)}\n(Outline only; call survey_get_draft view=question for details.)`;
}

function contextBlock({ userRequest, researchContext, steering = [] }) {
  const lines = [];
  if (userRequest) lines.push(`User request for this review: "${String(userRequest).slice(0, 2000)}"`);
  if (steering.length) {
    lines.push('User steering during this review (follow it):');
    steering.forEach((item) => lines.push(`- ${String(item).slice(0, 1000)}`));
  }
  const research = researchContext || {};
  if (research.topic || research.requirements || research.scenario) {
    lines.push('Research context:');
    if (research.topic) lines.push(`- topic: ${research.topic}`);
    if (research.requirements) lines.push(`- requirements: ${research.requirements}`);
    if (research.scenario) lines.push(`- scenario: ${research.scenario}`);
  }
  return lines.length ? `\n${lines.join('\n')}\n` : '';
}

function roleSystemPrompt(roleId, { method = 'linear', threshold = REVIEW_DEFAULTS.threshold, language = '' } = {}) {
  const role = roleById(roleId);
  if (!role) throw reviewOptionsError(`Unknown reviewer role: ${roleId}`);
  const discussion = method === 'group'
    ? 'You take part in a round-robin group discussion. Read the earlier turns, build on or challenge them, and add what is missing from your expertise. Do not repeat points already made.'
    : 'Review the survey independently. Do not assume other reviewers will cover your area.';
  return `You are the ${role.name} on an SP-Survey review panel (${role.expertise}).
You review street-scene / urban visual-perception surveys designed on SP-Survey.

Your focus:
${role.focus.map((item, index) => `${index + 1}. ${item}`).join('\n')}

${discussion}

Rules:
- You are read-only. You may call ${REVIEW_READ_TOOLS.join(', ')} for detail. You cannot change the draft.
- Refer to questions by their stable "name", never by display position.
- Rate the survey 1-10 for your area. ${threshold} or higher means you would accept it as is.
- Be specific and actionable. Give each concern a severity (high|medium|low) and the affected question names.
- Finish by calling ${REVIEW_SUBMIT_TOOL} exactly once. Do not answer in prose instead.
- Never request, repeat, or invent credentials, API keys, or media URLs.${language ? `\n- Write comments in ${language}.` : ''}`;
}

function formatPriorTurn(turn) {
  const role = roleById(turn.role);
  const concerns = (turn.concerns || []).slice(0, 5).map((item) => `  - [${item.severity}] ${item.issue}`).join('\n');
  return `${role?.emoji || ''} ${role?.name || turn.role} (round ${turn.round}, rating ${turn.rating}/10, ${turn.verdict}): ${turn.comments || ''}${concerns ? `\n${concerns}` : ''}`;
}

function roleUserPrompt({
  roleId,
  round,
  method,
  surveyConfig,
  surveySource = 'saved',
  priorTurns = [],
  previousRevision = null,
  userRequest = '',
  researchContext = null,
  steering = [],
}) {
  const role = roleById(roleId);
  const source = surveySource === 'candidate'
    ? 'This is the PROPOSED revision from the previous round. It is not saved; survey_get_draft returns it with source=candidate.'
    : 'This is the saved draft.';
  const revision = previousRevision?.summary
    ? `\nPrevious round revision summary: ${previousRevision.summary}\n`
    : '';
  const discussion = method === 'group' && priorTurns.length
    ? `\nDiscussion so far:\n${priorTurns.map(formatPriorTurn).join('\n\n')}\n`
    : '';
  return `Review round ${round} — ${role.name}.
${contextBlock({ userRequest, researchContext, steering })}${revision}${discussion}
${source}
Survey JSON:
${compactSurveyForPrompt(surveyConfig)}

Submit your review with ${REVIEW_SUBMIT_TOOL}.`;
}

function revisionSystemPrompt({ language = '' } = {}) {
  return `You are the SP-Survey revision lead for a multi-agent review.
Work in three parts:
1. Summary: analyze the reviewers' ratings and comments; name the consensus and the conflicts.
2. Planning: a short prioritized revision plan. Each step lists the reviewer roles it addresses and the affected question names.
3. Revise: express the revision as SP-Survey design-protocol operations (the same operations accepted by survey_apply_operations).

Rules:
- Load survey_capabilities domain=operations before writing operations if you are unsure of a contract.
- Prefer small incremental operations (updateQuestion, addQuestion, removeQuestion, reorderQuestions, updatePage, addPage, updateSurvey, setTheme). Question operations need pageName and questionName. Use replaceConfig only for a complete redesign.
- Preserve every unrelated field, question name, media selection and skillId.
- Never put skillHtml, credentials, or invented media URLs in operations.
- Finish by calling ${REVISION_SUBMIT_TOOL} exactly once. The server dry-runs and validates the operations; if it rejects them, repair and resubmit.
- You do not save the draft. The user or the review runtime applies accepted operations through the normal validated path.${language ? `\n- Write the summary and plan in ${language}.` : ''}`;
}

function revisionUserPrompt({
  round,
  surveyConfig,
  surveySource = 'saved',
  reviews = [],
  threshold,
  averageRating,
  userRequest = '',
  researchContext = null,
  steering = [],
}) {
  const detail = reviews.map((review) => {
    const role = roleById(review.role);
    const concerns = (review.concerns || [])
      .map((item) => `- [${item.severity}] ${item.issue}${item.questions?.length ? ` (questions: ${item.questions.join(', ')})` : ''}`)
      .join('\n');
    const suggestions = (review.suggestions || []).map((item) => `- ${item}`).join('\n');
    return `${role?.emoji || ''} ${role?.name || review.role}: rating ${review.rating}/10, verdict ${review.verdict}
${review.comments || ''}
Concerns:
${concerns || '- none'}
Suggestions:
${suggestions || '- none'}`;
  }).join('\n\n---\n\n');
  return `Revision for review round ${round}.
${contextBlock({ userRequest, researchContext, steering })}
Average rating ${averageRating}/10; accept threshold ${threshold}/10.

Reviews:
${detail}

Current ${surveySource === 'candidate' ? 'proposed (unsaved)' : 'saved'} survey JSON:
${compactSurveyForPrompt(surveyConfig)}

Produce Summary, Planning and Revise, then call ${REVISION_SUBMIT_TOOL}.`;
}

// ── Tool contracts and parsing ───────────────────────────────────────────────

const REVIEW_SUBMIT_PARAMETERS = Object.freeze({
  type: 'object',
  required: ['rating', 'verdict', 'comments'],
  properties: {
    rating: { type: 'number', minimum: 1, maximum: 10 },
    verdict: { type: 'string', enum: ['accept', 'revise', 'major-revision'] },
    comments: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    concerns: {
      type: 'array',
      items: {
        type: 'object',
        required: ['issue', 'severity'],
        properties: {
          issue: { type: 'string' },
          severity: { type: 'string', enum: SEVERITIES },
          questions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
});

const REVISION_SUBMIT_PARAMETERS = Object.freeze({
  type: 'object',
  required: ['summary', 'plan', 'operations'],
  properties: {
    summary: { type: 'string' },
    plan: {
      type: 'array',
      items: {
        type: 'object',
        required: ['step'],
        properties: {
          step: { type: 'string' },
          severity: { type: 'string', enum: SEVERITIES },
          roles: { type: 'array', items: { type: 'string', enum: REVIEW_ROLE_IDS } },
          questions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    operations: { type: 'array', items: { type: 'object' } },
  },
});

function textList(value, limit = 12) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(typeof item === 'string' ? item : item?.text || item?.issue || '').trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, 600));
}

function nameList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseRoleReview(raw, { threshold = REVIEW_DEFAULTS.threshold } = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const rating = Number(input.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    throw Object.assign(new Error('rating must be a number from 1 to 10.'), {
      status: 400,
      code: 'REVIEW_SUBMIT_INVALID',
      path: 'rating',
      retryAction: 'repair_args',
    });
  }
  const comments = String(input.comments || input.summary || '').trim();
  if (!comments) {
    throw Object.assign(new Error('comments are required.'), {
      status: 400,
      code: 'REVIEW_SUBMIT_INVALID',
      path: 'comments',
      retryAction: 'repair_args',
    });
  }
  const verdicts = ['accept', 'revise', 'major-revision'];
  const verdict = verdicts.includes(input.verdict)
    ? input.verdict
    : (input.verdict === 'approve' ? 'accept' : (rating >= threshold ? 'accept' : 'revise'));
  const concerns = (Array.isArray(input.concerns) ? input.concerns : [])
    .map((item) => (typeof item === 'string' ? { issue: item } : item || {}))
    .map((item) => ({
      issue: String(item.issue || item.text || '').trim().slice(0, 600),
      severity: SEVERITIES.includes(item.severity) ? item.severity : 'medium',
      questions: nameList(item.questions),
    }))
    .filter((item) => item.issue)
    .slice(0, 12);
  return {
    rating: Math.round(rating * 10) / 10,
    verdict,
    comments: comments.slice(0, 2400),
    strengths: textList(input.strengths),
    concerns,
    suggestions: textList(input.suggestions),
  };
}

function parseRevision(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const summary = String(input.summary || '').trim();
  if (!summary) {
    throw Object.assign(new Error('summary is required.'), {
      status: 400,
      code: 'REVISION_SUBMIT_INVALID',
      path: 'summary',
      retryAction: 'repair_args',
    });
  }
  if (!Array.isArray(input.operations)) {
    throw Object.assign(new Error('operations must be an array of design-protocol operations.'), {
      status: 400,
      code: 'REVISION_SUBMIT_INVALID',
      path: 'operations',
      retryAction: 'repair_args',
    });
  }
  const plan = (Array.isArray(input.plan) ? input.plan : [])
    .map((item) => (typeof item === 'string' ? { step: item } : item || {}))
    .map((item) => ({
      step: String(item.step || item.text || '').trim().slice(0, 600),
      severity: SEVERITIES.includes(item.severity) ? item.severity : 'medium',
      roles: nameList(item.roles).filter((id) => REVIEW_ROLE_IDS.includes(id)),
      questions: nameList(item.questions),
    }))
    .filter((item) => item.step)
    .slice(0, 16);
  return { summary: summary.slice(0, 3000), plan, operations: input.operations };
}

/** Fallback when a model answers with a JSON block instead of the submit tool. */
function extractJsonObject(text) {
  const source = String(text || '');
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function averageRating(reviews = []) {
  const ratings = reviews
    .filter((review) => review.status === 'completed' && Number.isFinite(review.rating))
    .map((review) => review.rating);
  if (!ratings.length) return null;
  return Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10;
}

// ── Orchestration ────────────────────────────────────────────────────────────

function isCancellation(error) {
  return error?.code === 'CANCELLED' || error?.name === 'AbortError' || error?.status === 499;
}

function cancelledError() {
  return Object.assign(new Error('Cancelled'), { status: 499, code: 'CANCELLED' });
}

function safeError(error) {
  return String(error?.message || 'failed').slice(0, 400);
}

function createReviewState(options, baseline) {
  return {
    version: 1,
    options,
    baselineDraftUpdatedAt: baseline?.draftUpdatedAt || null,
    current: {
      draftUpdatedAt: baseline?.draftUpdatedAt || null,
      source: 'saved',
      surveyConfig: options.applyMode === 'review' ? (baseline?.surveyConfig || null) : null,
    },
    round: 1,
    phase: 'review',
    roleIndex: 0,
    rounds: [],
    loop: null,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    status: 'running',
  };
}

function roundEntry(state, round) {
  let entry = state.rounds.find((item) => item.round === round);
  if (!entry) {
    entry = { round, reviews: [], averageRating: null, decision: null, revision: null };
    state.rounds.push(entry);
  }
  return entry;
}

function addUsage(state, usage = {}) {
  state.usage.prompt_tokens += Number(usage.prompt_tokens || 0);
  state.usage.completion_tokens += Number(usage.completion_tokens || 0);
}

function usedTokens(state) {
  return state.usage.prompt_tokens + state.usage.completion_tokens;
}

function priorTurnsFor(state, round) {
  const current = roundEntry(state, round).reviews.filter((item) => item.status === 'completed');
  const previous = round > 1
    ? roundEntry(state, round - 1).reviews.filter((item) => item.status === 'completed')
    : [];
  return [...previous, ...current];
}

/**
 * Runs or resumes a review. Returns { status: 'continuation', state } when the
 * step budget for this delivery is exhausted, otherwise { status: 'completed',
 * state, result }. Cancellation is rethrown; one reviewer failing is recorded
 * and the remaining reviewers still run.
 */
async function runReviewOrchestration({
  options: rawOptions,
  state: resumed = null,
  readDraft,
  runRole,
  runRevision,
  dryRun,
  applyRevision,
  emit,
  checkCancelled,
  readInbox,
  userRequest = '',
  researchContext = null,
  stepBudget = Number.POSITIVE_INFINITY,
  tokenBudget = Number.POSITIVE_INFINITY,
}) {
  const options = resumed?.options || normalizeReviewOptions(rawOptions);
  const send = async (type, payload) => emit?.(type, payload);
  const assertActive = async () => {
    if (typeof checkCancelled === 'function' && await checkCancelled()) throw cancelledError();
  };
  const collectSteering = async () => {
    if (typeof readInbox !== 'function') return;
    const items = await readInbox();
    for (const item of items || []) {
      const content = String(item?.content || '').trim();
      if (!content) continue;
      state.steering = [...(state.steering || []), content].slice(-8);
      await send('steering.message', {
        id: item.id,
        kind: item.kind || 'steer',
        target: item.target || 'next-step',
        content,
        review: { round: state.round },
      });
    }
  };
  let state = resumed;
  let budget = stepBudget;

  if (!state) {
    const baseline = await readDraft();
    state = createReviewState(options, baseline);
    const cap = typeof tokenBudget === 'function' ? tokenBudget(baseline, options) : tokenBudget;
    state.tokenCap = Number.isFinite(cap) ? cap : null;
    await send('review.start', {
      options,
      baselineDraftUpdatedAt: state.baselineDraftUpdatedAt,
      roles: options.roles,
      tokenCap: state.tokenCap,
    });
  }
  const tokenCap = Number.isFinite(state.tokenCap) ? state.tokenCap : Number.POSITIVE_INFINITY;

  const surveyForRound = async () => {
    if (options.applyMode === 'review' && state.current.surveyConfig) {
      return { surveyConfig: state.current.surveyConfig, source: state.current.source };
    }
    const draft = await readDraft();
    state.current.draftUpdatedAt = draft?.draftUpdatedAt || state.current.draftUpdatedAt;
    return { surveyConfig: draft?.surveyConfig || null, source: 'saved' };
  };

  const finish = async (status, extra = {}) => {
    state.phase = 'done';
    state.status = status;
    const last = state.rounds[state.rounds.length - 1] || null;
    const pendingRounds = options.applyMode === 'review'
      ? state.rounds.filter((item) => item.revision?.status === 'proposed').map((item) => item.round)
      : [];
    const result = {
      status,
      rounds: state.rounds.length,
      finalRating: last?.averageRating ?? null,
      threshold: options.threshold,
      applyMode: options.applyMode,
      pendingRounds,
      appliedRounds: state.rounds.filter((item) => item.revision?.applied).map((item) => item.round),
      draftUpdatedAt: state.current.draftUpdatedAt,
      baselineDraftUpdatedAt: state.baselineDraftUpdatedAt,
      usage: state.usage,
      summary: reviewSummaryText(state, status),
      ...extra,
    };
    await send('review.result', result);
    return { status: 'completed', state, result };
  };

  const takeBudget = (steps) => {
    budget -= Math.max(1, Number(steps || 1));
  };

  while (state.phase !== 'done') {
    await assertActive();
    if (usedTokens(state) > tokenCap) return finish('budget_exhausted');
    if (budget <= 0) return { status: 'continuation', state };
    const entry = roundEntry(state, state.round);

    if (state.phase === 'review') {
      if (state.roleIndex === 0 && !state.loop && !entry.started) {
        entry.started = true;
        await send('review.round', { round: state.round, status: 'start', method: options.method });
      }
      if (state.roleIndex >= options.roles.length) {
        entry.averageRating = averageRating(entry.reviews);
        if (entry.averageRating == null) {
          entry.decision = 'failed';
          await send('review.round', { round: state.round, status: 'end', decision: 'failed', averageRating: null });
          return finish('failed', { error: 'Every reviewer failed in this round.' });
        }
        entry.decision = entry.averageRating >= options.threshold ? 'accept' : 'revise';
        await send('review.round', {
          round: state.round,
          status: 'end',
          decision: entry.decision,
          averageRating: entry.averageRating,
          threshold: options.threshold,
        });
        if (entry.decision === 'accept') return finish('accepted');
        state.phase = 'revision';
        continue;
      }
      const roleId = options.roles[state.roleIndex];
      const survey = await surveyForRound();
      if (!state.loop) {
        await collectSteering();
        await send('review.role', { round: state.round, role: roleId, status: 'start' });
      }
      let outcome;
      try {
        outcome = await runRole({
          role: roleId,
          round: state.round,
          method: options.method,
          threshold: options.threshold,
          surveyConfig: survey.surveyConfig,
          surveySource: survey.source,
          priorTurns: options.method === 'group' ? priorTurnsFor(state, state.round) : [],
          previousRevision: state.round > 1 ? roundEntry(state, state.round - 1).revision : null,
          userRequest,
          researchContext,
          steering: state.steering || [],
          checkpoint: state.loop,
          stepBudget: budget,
        });
      } catch (error) {
        if (isCancellation(error)) {
          await send('review.role', { round: state.round, role: roleId, status: 'cancelled' });
          throw error;
        }
        addUsage(state, error?.usage);
        const failed = { round: state.round, role: roleId, status: 'failed', error: safeError(error), code: error?.code || null };
        entry.reviews.push(failed);
        state.loop = null;
        state.roleIndex += 1;
        takeBudget(error?.steps);
        await send('review.role', failed);
        continue;
      }
      addUsage(state, outcome?.usage);
      takeBudget(outcome?.steps);
      if (outcome?.continuation) {
        state.loop = outcome.checkpoint;
        return { status: 'continuation', state };
      }
      state.loop = null;
      const review = { round: state.round, role: roleId, status: 'completed', ...outcome.review };
      entry.reviews.push(review);
      state.roleIndex += 1;
      await send('review.role', review);
      continue;
    }

    if (state.phase === 'revision') {
      const survey = await surveyForRound();
      if (!state.loop) {
        await collectSteering();
        await send('review.revision', { round: state.round, status: 'start' });
      }
      let outcome;
      try {
        outcome = await runRevision({
          round: state.round,
          surveyConfig: survey.surveyConfig,
          surveySource: survey.source,
          reviews: entry.reviews.filter((item) => item.status === 'completed'),
          threshold: options.threshold,
          averageRating: entry.averageRating,
          userRequest,
          researchContext,
          steering: state.steering || [],
          checkpoint: state.loop,
          stepBudget: budget,
        });
      } catch (error) {
        if (isCancellation(error)) {
          await send('review.revision', { round: state.round, status: 'cancelled' });
          throw error;
        }
        addUsage(state, error?.usage);
        state.loop = null;
        entry.revision = { status: 'failed', error: safeError(error), code: error?.code || null };
        await send('review.revision', { round: state.round, ...entry.revision });
        return finish('revision_failed');
      }
      addUsage(state, outcome?.usage);
      takeBudget(outcome?.steps);
      if (outcome?.continuation) {
        state.loop = outcome.checkpoint;
        return { status: 'continuation', state };
      }
      state.loop = null;
      const revision = outcome.revision;
      const checked = dryRun(survey.surveyConfig, revision.operations);
      if (!checked.ok) {
        entry.revision = { status: 'invalid', ...revision, validation: checked.validation || null, error: checked.error };
        await send('review.revision', { round: state.round, ...entry.revision });
        return finish('revision_invalid');
      }
      entry.revision = {
        status: 'proposed',
        ...revision,
        validation: checked.validation || null,
        baseDraftUpdatedAt: state.current.draftUpdatedAt,
        applied: false,
      };
      if (options.applyMode === 'review') {
        state.current.surveyConfig = checked.surveyConfig;
        state.current.source = 'candidate';
        await send('review.revision', { round: state.round, ...entry.revision });
        state.phase = 'next';
        continue;
      }
      await send('review.revision', { round: state.round, ...entry.revision });
      state.phase = 'apply';
      continue;
    }

    if (state.phase === 'apply') {
      await assertActive();
      try {
        const saved = await applyRevision({
          round: state.round,
          operations: entry.revision.operations,
          expectedDraftUpdatedAt: entry.revision.baseDraftUpdatedAt,
        });
        state.current.draftUpdatedAt = saved?.draftUpdatedAt || state.current.draftUpdatedAt;
        entry.revision = { ...entry.revision, status: 'applied', applied: true, draftUpdatedAt: state.current.draftUpdatedAt };
        takeBudget(1);
        await send('review.applied', {
          rounds: [state.round],
          source: 'run',
          draftUpdatedAt: state.current.draftUpdatedAt,
        });
      } catch (error) {
        if (isCancellation(error)) throw error;
        const conflict = isDraftConflictError(error);
        entry.revision = {
          ...entry.revision,
          status: conflict ? 'conflict' : 'apply_failed',
          applied: false,
          error: safeError(error),
          code: conflict ? 'DRAFT_WRITE_CONFLICT' : (error?.code || null),
        };
        await send('review.revision', { round: state.round, ...entry.revision });
        return finish(conflict ? 'conflict' : 'apply_failed');
      }
      state.phase = 'next';
      continue;
    }

    if (state.phase === 'next') {
      if (state.round >= options.maxRounds) return finish('max_rounds');
      state.round += 1;
      state.roleIndex = 0;
      state.phase = 'review';
      continue;
    }

    throw new Error(`Unknown review phase: ${state.phase}`);
  }
  return finish(state.status || 'completed');
}

function isDraftConflictError(error) {
  const code = String(error?.code || '');
  return code === 'CONFLICT'
    || code === 'DRAFT_WRITE_CONFLICT'
    || code === 'STALE_DRAFT'
    || code === '40001'
    || error?.status === 409
    || /draft changed|stale draft|40001/i.test(String(error?.message || ''));
}

function dryRunRevision(applyOperations, validateSurveyConfig, surveyConfig, operations) {
  try {
    const next = applyOperations(surveyConfig || { pages: [] }, operations);
    const validation = validateSurveyConfig(next.surveyConfig);
    if (validation && validation.valid === false) {
      const detail = (validation.errors || []).slice(0, 4).map((item) => item.message || item.path || String(item)).join('; ');
      return { ok: false, validation, error: `Survey validation failed after operations: ${detail}` };
    }
    return { ok: true, surveyConfig: next.surveyConfig, validation };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

// ── Projection ───────────────────────────────────────────────────────────────

function reviewSummaryText(state, status) {
  const lines = [];
  const labels = {
    accepted: 'Accepted',
    max_rounds: 'Maximum rounds reached',
    failed: 'Review failed',
    revision_failed: 'Revision failed',
    revision_invalid: 'Revision rejected by validation',
    conflict: 'Draft changed during the review',
    apply_failed: 'Applying the revision failed',
    budget_exhausted: 'Token cap reached',
  };
  lines.push(`Review (${state.options.method === 'group' ? 'group discussion' : 'linear individual review'}): ${labels[status] || status}.`);
  state.rounds.forEach((entry) => {
    const ratings = entry.reviews
      .map((review) => `${roleById(review.role)?.name || review.role} ${review.status === 'completed' ? `${review.rating}/10` : review.status}`)
      .join(', ');
    lines.push(`Round ${entry.round}: average ${entry.averageRating ?? '—'}/10 (${ratings})${entry.decision ? ` → ${entry.decision}` : ''}.`);
    if (entry.revision?.summary) lines.push(`Revision: ${entry.revision.summary.slice(0, 400)}`);
  });
  return lines.join('\n');
}

/**
 * Rebuild review state from append-only events (UI, reload, apply endpoint).
 */
function reviewFromEvents(events = [], runId = null) {
  let review = null;
  for (const event of events || []) {
    const type = event?.type || '';
    if (!type.startsWith('review.')) continue;
    const eventRunId = event.runId || event.run_id || null;
    if (runId && eventRunId !== runId) continue;
    const payload = event.payload || {};
    if (type === 'review.start') {
      review = {
        runId: eventRunId,
        options: payload.options || {},
        baselineDraftUpdatedAt: payload.baselineDraftUpdatedAt || null,
        rounds: [],
        active: null,
        status: 'running',
        result: null,
        applied: [],
      };
      continue;
    }
    if (!review || (eventRunId && review.runId && eventRunId !== review.runId)) continue;
    const entryFor = (round) => {
      let entry = review.rounds.find((item) => item.round === round);
      if (!entry) {
        entry = { round, status: 'running', reviews: [], averageRating: null, decision: null, revision: null };
        review.rounds.push(entry);
      }
      return entry;
    };
    if (type === 'review.round') {
      const entry = entryFor(payload.round);
      if (payload.status === 'end') {
        entry.status = 'done';
        entry.averageRating = payload.averageRating ?? null;
        entry.decision = payload.decision || null;
      }
    } else if (type === 'review.role') {
      const entry = entryFor(payload.round);
      const existing = entry.reviews.find((item) => item.role === payload.role);
      const next = { ...(existing || {}), ...payload };
      if (existing) Object.assign(existing, next);
      else entry.reviews.push(next);
      review.active = payload.status === 'start' ? { round: payload.round, role: payload.role } : null;
    } else if (type === 'review.revision') {
      const entry = entryFor(payload.round);
      entry.revision = { ...(entry.revision || {}), ...payload };
      review.active = payload.status === 'start' ? { round: payload.round, role: 'revision' } : null;
    } else if (type === 'review.applied') {
      for (const round of payload.rounds || []) {
        const entry = entryFor(round);
        entry.revision = { ...(entry.revision || {}), applied: true, status: 'applied', draftUpdatedAt: payload.draftUpdatedAt || null };
        if (!review.applied.includes(round)) review.applied.push(round);
      }
      review.lastAppliedDraftUpdatedAt = payload.draftUpdatedAt || review.lastAppliedDraftUpdatedAt || null;
      if (payload.source === 'user' && review.result) {
        review.result = {
          ...review.result,
          pendingRounds: (review.result.pendingRounds || []).filter((round) => !(payload.rounds || []).includes(round)),
        };
      }
    } else if (type === 'review.result') {
      review.status = payload.status || 'completed';
      review.result = payload;
      review.active = null;
    }
  }
  return review;
}

/**
 * The next rounds a user may apply from a "review only" run. Proposals chain:
 * round k was written against round k-1's candidate, so application must be
 * in order starting from the first unapplied round.
 */
function applicableReviewRounds(review, requested = []) {
  if (!review) {
    throw Object.assign(new Error('No review result found for this run.'), { status: 404, code: 'REVIEW_NOT_FOUND' });
  }
  if (review.options?.applyMode !== 'review') {
    throw Object.assign(new Error('Revisions from this run were applied during the run.'), {
      status: 409,
      code: 'REVIEW_ALREADY_APPLIED',
    });
  }
  const proposed = review.rounds
    .filter((entry) => entry.revision && ['proposed', 'applied'].includes(entry.revision.status))
    .sort((a, b) => a.round - b.round);
  const pending = proposed.filter((entry) => !entry.revision.applied);
  if (!pending.length) {
    throw Object.assign(new Error('There are no unapplied revisions in this review.'), {
      status: 409,
      code: 'REVIEW_NOTHING_TO_APPLY',
    });
  }
  const wanted = (Array.isArray(requested) && requested.length ? requested : pending.map((entry) => entry.round))
    .map(Number)
    .sort((a, b) => a - b);
  const expected = pending.slice(0, wanted.length).map((entry) => entry.round);
  if (wanted.some((round, index) => round !== expected[index])) {
    throw Object.assign(new Error(`Apply revisions in order. Next applicable round: ${pending[0].round}.`), {
      status: 409,
      code: 'REVIEW_APPLY_ORDER',
      nextRound: pending[0].round,
    });
  }
  const first = pending[0];
  const operations = pending
    .slice(0, wanted.length)
    .flatMap((entry) => (Array.isArray(entry.revision.operations) ? entry.revision.operations : []));
  const expectedDraftUpdatedAt = review.lastAppliedDraftUpdatedAt
    || first.revision.baseDraftUpdatedAt
    || review.baselineDraftUpdatedAt;
  return { rounds: wanted, operations, expectedDraftUpdatedAt };
}

module.exports = {
  REVIEW_ROLES,
  REVIEW_ROLE_IDS,
  REVIEW_METHODS,
  REVIEW_APPLY_MODES,
  REVIEW_LIMITS,
  REVIEW_DEFAULTS,
  REVIEW_SUBMIT_TOOL,
  REVISION_SUBMIT_TOOL,
  REVIEW_READ_TOOLS,
  roleById,
  normalizeReviewOptions,
  estimateDraftTokens,
  estimateReviewCost,
  compactSurveyForPrompt,
  roleSystemPrompt,
  roleUserPrompt,
  revisionSystemPrompt,
  revisionUserPrompt,
  REVIEW_SUBMIT_PARAMETERS,
  REVISION_SUBMIT_PARAMETERS,
  parseRoleReview,
  parseRevision,
  extractJsonObject,
  averageRating,
  createReviewState,
  runReviewOrchestration,
  isDraftConflictError,
  dryRunRevision,
  reviewSummaryText,
  reviewFromEvents,
  applicableReviewRounds,
};
