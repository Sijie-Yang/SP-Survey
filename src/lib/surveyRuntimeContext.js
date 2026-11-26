// Between-participant conditions (S1) and URL parameter capture (S2).
// Both are opt-in project settings; projects without them get no variables and no metadata.
// A question may reword itself per condition via conditionVariants: [{ condition, title, reverseCoded }].

import { Serializer } from 'survey-core';
import { conditionVariants, reverseCodedConditions } from './conditionVariants.js';

export const CONDITION_VARIABLE = 'sp_condition';
export const URL_VARIABLE_PREFIX = 'url_';
export const URL_PARAM_MAX_LENGTH = 64;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

if (!Serializer.findProperty('question', 'conditionVariants')) {
  Serializer.addProperty('question', { name: 'conditionVariants', default: null, category: 'general', visible: false });
}

export function normalizeConditions(config) {
  const list = Array.isArray(config?.conditions) ? config.conditions : [];
  const seen = new Set();
  return list
    .map((c) => (typeof c === 'string' ? { id: c } : c))
    .filter((c) => c && typeof c.id === 'string' && c.id.trim() && !seen.has(c.id.trim()) && seen.add(c.id.trim()))
    .map((c) => ({
      id: c.id.trim(),
      label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : c.id.trim(),
      weight: Number.isFinite(Number(c.weight)) && Number(c.weight) > 0 ? Number(c.weight) : 1,
    }));
}

export function hasConditions(config) {
  return normalizeConditions(config).length > 1;
}

/** Fewest completed responses relative to weight; ties broken at random. */
/**
 * Random assignment for each new session. With completed counts, a smaller group is
 * proportionally more likely (weight ÷ (1 + completed)), so groups stay close without
 * ever making the next assignment predictable.
 */
export function chooseCondition(conditions, counts = null, rand = Math.random) {
  if (!conditions.length) return null;
  const hasCounts = counts && typeof counts === 'object';
  const odds = conditions.map((c) => c.weight / (hasCounts ? 1 + (Number(counts[c.id]) || 0) : 1));
  const total = odds.reduce((s, o) => s + o, 0);
  let r = rand() * total;
  for (let i = 0; i < conditions.length; i += 1) {
    r -= odds[i];
    if (r < 0) return conditions[i].id;
  }
  return conditions[conditions.length - 1].id;
}

export function captureParamNames(config) {
  const list = Array.isArray(config?.captureUrlParams) ? config.captureUrlParams : [];
  return [...new Set(list.map((n) => String(n || '').trim()).filter((n) => NAME_RE.test(n)))];
}

/** Only allow-listed parameters, trimmed to 64 characters; others are ignored. */
export function captureUrlParams(config, search = '') {
  const names = captureParamNames(config);
  if (!names.length) return null;
  const params = new URLSearchParams(search || '');
  const out = {};
  names.forEach((name) => {
    const v = params.get(name);
    if (v != null && v.trim() !== '') out[name] = v.trim().slice(0, URL_PARAM_MAX_LENGTH);
  });
  return out;
}

const storageKey = (projectId) => `sp_condition_${projectId || 'default'}`;

export function storedCondition(projectId, conditions) {
  try {
    const v = localStorage.getItem(storageKey(projectId));
    return conditions.some((c) => c.id === v) ? v : null;
  } catch { return null; }
}

export function rememberCondition(projectId, condition) {
  try { if (condition) localStorage.setItem(storageKey(projectId), condition); } catch { /* private mode */ }
}

export function forgetCondition(projectId) {
  try { localStorage.removeItem(storageKey(projectId)); } catch { /* private mode */ }
}

/**
 * Resolve the runtime context for one participant session.
 * `override` (Researcher Practice / preview) wins; then a stored assignment; then balanced assignment.
 */
export async function resolveRuntimeContext(config, { projectId, search = '', override = null, fetchCounts = null, persist = false, rand = Math.random } = {}) {
  const conditions = normalizeConditions(config);
  let condition = null;
  if (conditions.length > 1) {
    if (override && conditions.some((c) => c.id === override)) condition = override;
    else {
      condition = persist ? storedCondition(projectId, conditions) : null;
      if (!condition) {
        let counts = null;
        if (fetchCounts) { try { counts = await fetchCounts(); } catch { counts = null; } }
        condition = chooseCondition(conditions, counts, rand);
        if (persist) rememberCondition(projectId, condition);
      }
    }
  }
  return { condition, urlParams: captureUrlParams(config, search) };
}

export { conditionVariants, reverseCodedConditions };

export function conditionVariant(question, conditionId) {
  if (!conditionId) return null;
  return conditionVariants(question).find((v) => v.condition === conditionId) || null;
}

/** Question JSON as participants in this condition see it. */
export function withConditionWording(questionJson, conditionId) {
  const title = conditionVariant(questionJson, conditionId)?.title;
  return typeof title === 'string' && title.trim() ? { ...questionJson, title } : questionJson;
}

/** Condition forced by the link (?sp_condition=id), for researcher testing or fixed per-condition links. */
export function conditionFromUrl(search) {
  const v = new URLSearchParams(search || '').get(CONDITION_VARIABLE);
  return v && v.trim() ? v.trim() : null;
}

const PAGE_PARAM_RULE = /^\s*\{url_([A-Za-z][A-Za-z0-9_]*)\}\s+(notempty|empty)\s*$/;

/** Page visibility as a simple choice: always, or only with / without a link parameter. Null for other rules. */
export function parsePageRule(visibleIf) {
  if (!visibleIf || !String(visibleIf).trim()) return { kind: 'always' };
  const m = String(visibleIf).match(PAGE_PARAM_RULE);
  if (!m) return null;
  return { kind: m[2] === 'notempty' ? 'with_param' : 'without_param', param: m[1] };
}

export function pageRuleToVisibleIf(rule) {
  if (!rule || rule.kind === 'always' || !rule.param) return undefined;
  return `{url_${rule.param}} ${rule.kind === 'with_param' ? 'notempty' : 'empty'}`;
}

const CHOICE_VISIBLE_RULE = /^\s*\{([A-Za-z_][A-Za-z0-9_]*)\}\s*=\s*(?:'([^']*)'|"([^"]*)")\s*$/;

/** Question visibility: always, or when one earlier choice equals a value. Null for other rules. */
export function parseChoiceVisibleIf(visibleIf) {
  if (!visibleIf || !String(visibleIf).trim()) return { kind: 'always' };
  const match = String(visibleIf).match(CHOICE_VISIBLE_RULE);
  if (!match) return null;
  return { kind: 'answer', question: match[1], value: match[2] ?? match[3] };
}

export function choiceRuleToVisibleIf(rule) {
  if (!rule || rule.kind === 'always' || !rule.question) return undefined;
  return `{${rule.question}} = '${String(rule.value ?? '').replace(/'/g, "\\'")}'`;
}

export function describeChoiceVisibleIf(visibleIf, questions = []) {
  const rule = parseChoiceVisibleIf(visibleIf);
  if (!rule) return { kind: 'custom', text: String(visibleIf || '') };
  if (rule.kind !== 'answer') return { kind: 'always' };
  const source = questions.find((item) => item.name === rule.question);
  const raw = (source?.choices || []).find((choice) => String(typeof choice === 'object' ? choice.value : choice) === String(rule.value));
  const answer = raw == null ? rule.value : (typeof raw === 'object' ? (raw.text || raw.value) : raw);
  return { kind: 'answer', question: source?.title || rule.question, answer: String(answer) };
}

export function applyConditionWording(model, conditionId) {
  if (!model || !conditionId) return;
  model.getAllQuestions(false, false, true).forEach((q) => {
    const title = conditionVariant(q, conditionId)?.title;
    if (typeof title === 'string' && title.trim()) q.title = title;
  });
}

export function applyRuntimeVariables(model, context) {
  if (!model || !context) return;
  applyConditionWording(model, context.condition);
  if (context.condition) model.setVariable(CONDITION_VARIABLE, context.condition);
  Object.entries(context.urlParams || {}).forEach(([k, v]) => model.setVariable(`${URL_VARIABLE_PREFIX}${k}`, v));
}

export function runtimeMetadata(context) {
  const out = {};
  if (context?.condition) out.condition = context.condition;
  if (context?.urlParams && Object.keys(context.urlParams).length) out.url_params = { ...context.urlParams };
  return out;
}
