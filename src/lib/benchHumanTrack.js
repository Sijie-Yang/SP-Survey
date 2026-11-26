/**
 * SP-Bench "Human agreement" track.
 *
 * A task is one image question of a real platform project, frozen as the
 * per-image human aggregate (TrueSkill μ for pairwise / ranking questions, the
 * mean for ratings and sliders). A model answers with one number per image;
 * the score is the rank agreement with people. Everything here is
 * deterministic and runs in the browser and in the Worker alike, so anyone can
 * check a score on their own machine.
 *
 * Contract names (schemas, metric names, column names) are stable.
 */
import { buildQuestionSummaryRows, exportFamilyForQuestion } from './questionSummaryExport.js';
import { kendallTauB, pearson, spearman } from './siliconAgreement.js';

export const TASK_SCHEMA = 'sp-bench-human-task/1';
export const SUBMISSION_SCHEMA = 'sp-bench-human-submission/1';
export const MIN_ITEMS = 5;
export const MIN_HUMAN_RESPONSES = 20;
export const MIN_MATCHED_FOR_SCORE = 3;
export const SUBMISSIONS_REPO_DIR = 'https://github.com/Sijie-Yang/SP-Survey-Platform/tree/main/public/bench/submissions';
export const SUBMISSIONS_NEW_FILE_URL = 'https://github.com/Sijie-Yang/SP-Survey-Platform/new/main/public/bench/submissions';

// Question families whose summary has one row per image.
const IMAGE_FAMILIES = new Set([
  'imagepicker', 'maxdiff', 'pairwise_slider', 'image_ranking', 'image_rating', 'image_slider', 'image_matrix', 'image_points',
]);

/** Cheap check: could this question become a task (before computing anything)? */
export function isBenchableQuestion(question) {
  return Boolean(question?.name) && IMAGE_FAMILIES.has(exportFamilyForQuestion(question));
}

export const COMPARISONS = Object.freeze({
  item_scores: { target: 'mu', spread: 'sigma', headline: 'kendall_tau_b', metrics: ['kendall_tau_b', 'spearman_rho'] },
  item_means: { target: 'mean', spread: 'sd', headline: 'spearman_rho', metrics: ['spearman_rho', 'pearson_r', 'mean_abs_diff'] },
});

// ------------------------------------------------------------------ helpers

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

export function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleText(question) {
  const t = question?.title;
  if (t && typeof t === 'object') return plainText(t.en || t.default || Object.values(t)[0]);
  return plainText(t || question?.name);
}

export function fileName(url) {
  const clean = String(url || '').split(/[?#]/)[0];
  return clean.slice(clean.lastIndexOf('/') + 1);
}

function safeSummary(question, rows) {
  try {
    return buildQuestionSummaryRows(question, rows) || [];
  } catch {
    return [];
  }
}

function round(v, digits = 6) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Per-unit values of one metric for one attribute. */
function unitMetric(rows, attributeKey, metric) {
  const out = new Map();
  for (const r of rows) {
    if ((r.attribute_key || '') !== (attributeKey || '') || r.metric !== metric || r.unit_key === 'overall') continue;
    const v = Number(r.value);
    if (Number.isFinite(v)) out.set(String(r.unit_key), { key: String(r.unit_key), label: String(r.unit_label ?? r.unit_key), value: v, n: Number(r.n) || 0 });
  }
  return out;
}

function comparisonFor(rows, attributeKey) {
  if (unitMetric(rows, attributeKey, 'mu').size) return 'item_scores';
  if (unitMetric(rows, attributeKey, 'mean').size) return 'item_means';
  return null;
}

function scaleFor(question, attributeKey) {
  if (attributeKey && Array.isArray(question.dimensions)) {
    const d = question.dimensions.find((x) => String(x.id ?? x.name) === String(attributeKey));
    if (d && Number.isFinite(Number(d.min)) && Number.isFinite(Number(d.max))) return { min: Number(d.min), max: Number(d.max) };
  }
  const min = question.rateMin ?? question.min;
  const max = question.rateMax ?? question.max;
  if (Number.isFinite(Number(min)) && Number.isFinite(Number(max))) return { min: Number(min), max: Number(max) };
  return null;
}

export function taskId(projectId, questionName, attributeKey = '') {
  const p = String(projectId || 'project').replace(/-/g, '').slice(0, 8);
  return [p, slug(questionName), attributeKey ? slug(attributeKey) : ''].filter(Boolean).join('-');
}

// ------------------------------------------------------------------ tasks

/**
 * The image questions (and slider dimensions) that can become a task.
 * Each candidate says whether it is big enough to publish.
 */
export function candidateTasks(projectId, questions, humanRows) {
  const out = [];
  for (const q of questions || []) {
    if (!q?.name || !IMAGE_FAMILIES.has(exportFamilyForQuestion(q))) continue;
    const rows = safeSummary(q, humanRows || []);
    if (!rows.length) continue;
    const nHuman = Number(rows[0].n_responses) || 0;
    const attrs = new Map();
    for (const r of rows) if (!attrs.has(r.attribute_key || '')) attrs.set(r.attribute_key || '', r.attribute_label || r.attribute_key || '');
    for (const [attributeKey, attributeLabel] of attrs) {
      const comparison = comparisonFor(rows, attributeKey);
      if (!comparison) continue;
      const nItems = unitMetric(rows, attributeKey, COMPARISONS[comparison].target).size;
      const reasons = [];
      if (nItems < MIN_ITEMS) reasons.push('items');
      if (nHuman < MIN_HUMAN_RESPONSES) reasons.push('responses');
      out.push({
        task_id: taskId(projectId, q.name, attributeKey),
        question_name: q.name,
        question_title: titleText(q),
        attribute_key: attributeKey,
        attribute_label: attributeLabel,
        comparison,
        n_items: nItems,
        n_human: nHuman,
        eligible: reasons.length === 0,
        reasons,
      });
    }
  }
  return out;
}

/** Stable, readable item keys: the file name when it is unique, the URL otherwise. */
function itemKeys(units) {
  const counts = new Map();
  for (const u of units) {
    const f = fileName(u.key) || u.label;
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  return units.map((u) => {
    const f = fileName(u.key) || u.label;
    return counts.get(f) === 1 && f ? f : u.key;
  });
}

/**
 * Freeze one task from the human answers. Only per-image aggregates and
 * counts leave the project; no individual answer is included.
 */
export function buildHumanTask({ project, question, attributeKey = '', humanRows, publishedAt, doi = '', license = '' }) {
  const rows = safeSummary(question, humanRows || []);
  const comparison = comparisonFor(rows, attributeKey);
  if (!comparison) throw new Error(`Question ${question?.name} has no per-image values to benchmark.`);
  const spec = COMPARISONS[comparison];
  const target = unitMetric(rows, attributeKey, spec.target);
  const spread = unitMetric(rows, attributeKey, spec.spread);
  const units = [...target.values()].sort((a, b) => a.key.localeCompare(b.key));
  const keys = itemKeys(units);
  const attr = rows.find((r) => (r.attribute_key || '') === attributeKey);
  const date = String(publishedAt || new Date().toISOString()).slice(0, 10);
  return {
    schema: TASK_SCHEMA,
    task_id: taskId(project?.id, question.name, attributeKey),
    version: date,
    project: { id: project?.id || '', name: project?.name || '' },
    question: {
      name: question.name,
      type: question.type || '',
      family: exportFamilyForQuestion(question),
      title: titleText(question),
      attribute_key: attributeKey,
      attribute_label: attr?.attribute_label || attributeKey || '',
      scale: comparison === 'item_means' ? scaleFor(question, attributeKey) : null,
    },
    comparison,
    target_metric: spec.target,
    headline_metric: spec.headline,
    n_human: rows.length ? Number(rows[0].n_responses) || 0 : 0,
    n_items: units.length,
    dataset_doi: String(doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
    license: license || 'CC-BY-4.0',
    items: units.map((u, i) => ({
      item_key: keys[i],
      image_url: /^(https?:)?\//.test(u.key) ? u.key : '',
      value: round(u.value),
      spread: round(spread.get(u.key)?.value ?? null),
      n: u.n,
    })),
  };
}

/** Rejects anything that is not a well-formed public task. Returns a list of problems. */
export function validateTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object') return ['not an object'];
  if (task.schema !== TASK_SCHEMA) errors.push('schema');
  if (!/^[a-z0-9-]{3,80}$/.test(String(task.task_id || ''))) errors.push('task_id');
  if (!COMPARISONS[task.comparison]) errors.push('comparison');
  if (!Array.isArray(task.items) || task.items.length < MIN_ITEMS) errors.push('items');
  else if (task.items.some((it) => !it?.item_key || !Number.isFinite(Number(it.value)))) errors.push('item values');
  else if (new Set(task.items.map((it) => it.item_key)).size !== task.items.length) errors.push('duplicate item_key');
  if (!(Number(task.n_human) >= MIN_HUMAN_RESPONSES)) errors.push('n_human');
  return errors;
}

/** Only the fields the public may see, in a fixed shape. */
export function publicTask(task) {
  return {
    schema: TASK_SCHEMA,
    task_id: task.task_id,
    version: String(task.version || ''),
    project: { id: String(task.project?.id || ''), name: String(task.project?.name || '') },
    question: {
      name: String(task.question?.name || ''),
      type: String(task.question?.type || ''),
      family: String(task.question?.family || ''),
      title: plainText(task.question?.title || ''),
      attribute_key: String(task.question?.attribute_key || ''),
      attribute_label: String(task.question?.attribute_label || ''),
      scale: task.question?.scale && Number.isFinite(Number(task.question.scale.min)) && Number.isFinite(Number(task.question.scale.max))
        ? { min: Number(task.question.scale.min), max: Number(task.question.scale.max) } : null,
    },
    comparison: task.comparison,
    target_metric: COMPARISONS[task.comparison]?.target || '',
    headline_metric: COMPARISONS[task.comparison]?.headline || '',
    n_human: Number(task.n_human) || 0,
    n_items: task.items.length,
    dataset_doi: String(task.dataset_doi || ''),
    license: String(task.license || 'CC-BY-4.0'),
    items: task.items.map((it) => ({
      item_key: String(it.item_key),
      image_url: /^https?:\/\//.test(String(it.image_url || '')) ? String(it.image_url) : '',
      value: Number(it.value),
      spread: it.spread == null || !Number.isFinite(Number(it.spread)) ? null : Number(it.spread),
      n: Number(it.n) || 0,
    })),
  };
}

/** Every valid task stored on one project's metadata (`spBenchTasks`, keyed by task id). */
export function tasksFromProjectMetadata(stored) {
  if (!stored || typeof stored !== 'object') return [];
  return Object.values(stored).filter((t) => validateTask(t).length === 0).map(publicTask);
}

/** A CSV template for one task: item_key, image_url, empty value column. */
export function taskTemplateCsv(task) {
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `${['task_id', 'item_key', 'image_url', 'value'].join(',')}\n${task.items.map((it) => [task.task_id, it.item_key, it.image_url, ''].map(cell).join(',')).join('\n')}\n`;
}

// ------------------------------------------------------------------ predictions

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a predictions CSV. Columns: `task_id,item_key,value` (or just
 * `item_key,value` with `defaultTaskId`). Returns { predictions, errors }.
 * `predictions` = { [task_id]: { [item_key]: number } }.
 */
export function parsePredictionsCsv(text, { defaultTaskId = '' } = {}) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const errors = [];
  const predictions = {};
  if (!lines.length) return { predictions, errors: ['The file is empty.'] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const iTask = header.indexOf('task_id');
  const iItem = header.indexOf('item_key');
  const iValue = header.indexOf('value');
  if (iItem < 0 || iValue < 0) return { predictions, errors: ['The header needs item_key and value columns.'] };
  if (iTask < 0 && !defaultTaskId) return { predictions, errors: ['Add a task_id column.'] };
  lines.slice(1).forEach((line, idx) => {
    const cols = splitCsvLine(line);
    const task = iTask >= 0 ? cols[iTask] : defaultTaskId;
    const item = cols[iItem];
    const raw = cols[iValue];
    if (!task || !item) return;
    if (raw === '' || raw == null) return;
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      if (errors.length < 5) errors.push(`Row ${idx + 2}: "${raw}" is not a number.`);
      return;
    }
    if (!predictions[task]) predictions[task] = {};
    predictions[task][item] = v;
  });
  return { predictions, errors };
}

/** Look up an item by its key, its URL or its file name. */
function itemLookup(task) {
  const map = new Map();
  for (const it of task.items) {
    map.set(it.item_key, it);
    if (it.image_url && !map.has(it.image_url)) map.set(it.image_url, it);
  }
  const byFile = new Map();
  const dup = new Set();
  for (const it of task.items) {
    const f = fileName(it.image_url || it.item_key);
    if (byFile.has(f)) dup.add(f);
    byFile.set(f, it);
  }
  for (const [f, it] of byFile) if (!dup.has(f) && !map.has(f)) map.set(f, it);
  return map;
}

// ------------------------------------------------------------------ scoring

/**
 * Score one task. `predicted` = { [item_key | image_url | file name]: number }.
 * Correlations need at least MIN_MATCHED_FOR_SCORE matched images.
 */
export function scoreTask(task, predicted) {
  const spec = COMPARISONS[task.comparison];
  const lookup = itemLookup(task);
  const matched = new Map();
  for (const [k, v] of Object.entries(predicted || {})) {
    const it = lookup.get(String(k));
    const n = Number(v);
    if (it && Number.isFinite(n) && !matched.has(it.item_key)) matched.set(it.item_key, { human: Number(it.value), model: n });
  }
  const pairs = [...matched.values()];
  const xs = pairs.map((p) => p.human);
  const ys = pairs.map((p) => p.model);
  const enough = pairs.length >= MIN_MATCHED_FOR_SCORE;
  const metrics = {};
  if (task.comparison === 'item_scores') {
    metrics.kendall_tau_b = enough ? kendallTauB(xs, ys) : null;
    metrics.spearman_rho = enough ? spearman(xs, ys) : null;
  } else {
    metrics.spearman_rho = enough ? spearman(xs, ys) : null;
    metrics.pearson_r = enough ? pearson(xs, ys) : null;
    metrics.mean_abs_diff = pairs.length ? pairs.reduce((a, p) => a + Math.abs(p.model - p.human), 0) / pairs.length : null;
  }
  for (const k of Object.keys(metrics)) metrics[k] = round(metrics[k], 4);
  return {
    task_id: task.task_id,
    comparison: task.comparison,
    headline_metric: spec.headline,
    headline: metrics[spec.headline],
    metrics,
    n_matched: pairs.length,
    n_items: task.items.length,
    coverage: task.items.length ? pairs.length / task.items.length : 0,
  };
}

/**
 * Score a whole submission against the current tasks. `overall` is the mean
 * headline over ALL tasks, a missing or unscorable task counting as 0, so
 * answering only the easy tasks does not pay.
 */
export function scoreSubmission(tasks, predictions) {
  const perTask = (tasks || []).map((t) => scoreTask(t, predictions?.[t.task_id] || {}));
  const scored = perTask.filter((s) => s.headline != null);
  const overall = perTask.length ? round(perTask.reduce((a, s) => a + (s.headline ?? 0), 0) / perTask.length, 4) : null;
  return { overall, tasks_scored: scored.length, tasks_total: perTask.length, per_task: perTask };
}

// ------------------------------------------------------------------ submissions

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildSubmission({ model, organisation = '', contact = '', url = '', date, kind = 'model', notes = '', predictions }) {
  const clean = {};
  for (const [task, items] of Object.entries(predictions || {})) {
    const entries = Object.entries(items || {}).filter(([, v]) => Number.isFinite(Number(v)));
    if (entries.length) clean[task] = Object.fromEntries(entries.map(([k, v]) => [k, round(Number(v))]));
  }
  return {
    schema: SUBMISSION_SCHEMA,
    model: String(model || '').trim(),
    organisation: String(organisation || '').trim(),
    contact: String(contact || '').trim(),
    url: String(url || '').trim(),
    kind: kind === 'silicon' ? 'silicon' : 'model',
    date: String(date || new Date().toISOString()).slice(0, 10),
    notes: String(notes || '').trim(),
    predictions: clean,
  };
}

/** Problems with a submission file, or [] when it is fine. */
export function validateSubmission(sub) {
  const errors = [];
  if (!sub || typeof sub !== 'object') return ['not an object'];
  if (sub.schema !== SUBMISSION_SCHEMA) errors.push(`schema must be "${SUBMISSION_SCHEMA}"`);
  if (!String(sub.model || '').trim()) errors.push('model is required');
  if (!DATE_RE.test(String(sub.date || ''))) errors.push('date must be YYYY-MM-DD');
  if (!['model', 'silicon'].includes(sub.kind)) errors.push('kind must be "model" or "silicon"');
  if (sub.url && !/^https?:\/\//.test(sub.url)) errors.push('url must start with http');
  const p = sub.predictions;
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Object.keys(p).length) errors.push('predictions are empty');
  else {
    for (const [task, items] of Object.entries(p)) {
      if (!items || typeof items !== 'object' || Array.isArray(items)) { errors.push(`predictions.${task} must be an object`); continue; }
      if (Object.values(items).some((v) => typeof v !== 'number' || !Number.isFinite(v))) errors.push(`predictions.${task} has a non-number`);
    }
  }
  return errors;
}

/** File name for a submission in public/bench/submissions/. */
export function submissionFileName(sub) {
  return `${sub.date}-${slug(sub.model) || 'model'}.json`;
}

/** Leaderboard rows, best first. Invalid submissions are dropped. */
export function leaderboard(tasks, submissions) {
  const rows = [];
  for (const sub of submissions || []) {
    if (validateSubmission(sub).length) continue;
    const s = scoreSubmission(tasks, sub.predictions);
    rows.push({
      file: sub.file || '',
      model: sub.model,
      organisation: sub.organisation || '',
      url: sub.url || '',
      kind: sub.kind,
      date: sub.date,
      overall: s.overall,
      tasks_scored: s.tasks_scored,
      tasks_total: s.tasks_total,
      per_task: Object.fromEntries(s.per_task.map((t) => [t.task_id, t])),
    });
  }
  rows.sort((a, b) => ((b.overall ?? -Infinity) - (a.overall ?? -Infinity)) || a.model.localeCompare(b.model));
  return rows;
}

/**
 * Predictions from a silicon-sample run on the same project: the run's own
 * per-image μ or mean for each task question, matched to the task's items.
 */
export function predictionsFromRows(tasks, questions, rows) {
  const byName = new Map((questions || []).map((q) => [q.name, q]));
  const out = {};
  for (const task of tasks || []) {
    const q = byName.get(task.question?.name);
    if (!q) continue;
    const summary = safeSummary(q, rows || []);
    const values = unitMetric(summary, task.question.attribute_key || '', COMPARISONS[task.comparison].target);
    const lookup = itemLookup(task);
    const preds = {};
    for (const u of values.values()) {
      const it = lookup.get(u.key) || lookup.get(fileName(u.key)) || lookup.get(u.label);
      if (it) preds[it.item_key] = round(u.value);
    }
    if (Object.keys(preds).length) out[task.task_id] = preds;
  }
  return out;
}
