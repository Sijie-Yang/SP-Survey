/**
 * One-click analysis for a question the platform does not analyse by itself
 * (a page converted online, a custom question, an advanced custom task).
 *
 * The Assistant model reads the question and a few real records and writes a
 * small `analyze(records, helpers)` function. That code runs in a sandbox with
 * no network and no access to the app; it only reshapes the records into
 * blocks. The statistics themselves (TrueSkill, Borda and Kendall's W, Wilson
 * intervals, descriptive stats, word frequency) are the platform's own, run
 * here on the blocks, so the charts and export files match native analysis.
 */
import { computeTrueSkillFromMatches, matchesFromOrderedRanking, trueSkillBoards } from './trueskill.js';
import { descriptiveStats, wilsonCI } from './stats.js';
import { computeBordaScores, kendallW, interpretKendallW } from './rankingStats.js';
import { wordFrequency, textLengthStats } from './textStats.js';
import { krippendorffAlpha, interpretAlpha } from './reliability.js';
import { answerRows, checkPlan, fieldInventory, inventoryText, planBlock, planSummaryForCode, runPlan, PLAN_VERSION } from './analysisPlan.js';

export const AI_ANALYSIS_VERSION = PLAN_VERSION;
const SP_SITE_REQUESTS_KEY = '__sp_requests';
const SP_SITE_STATE_KEY = '__sp_page_state';

export const AI_ANALYSIS_BLOCK_TYPES = ['per_item', 'pairwise', 'ranking', 'choice', 'rating', 'text', 'table', 'bar', 'note'];
/** At most this many data blocks per question: one question, one focused analysis. */
export const AI_ANALYSIS_MAX_DATA_BLOCKS = 3;

/**
 * The records the analysis code receives: one per submission.
 * `answer` is what the platform stored for this question (if anything);
 * `page_state` and `requests` are what an uploaded page saved and sent.
 */
export function buildAnalysisRecords(rows, question, { site = false } = {}) {
  const name = question?.name;
  const out = [];
  (rows || []).forEach((row, index) => {
    const responses = row?.responses && typeof row.responses === 'object' ? row.responses : {};
    const record = {
      participant_id: row?.participant_id || row?.id || `row_${index + 1}`,
      submitted_at: row?.created_at || row?.submitted_at || null,
    };
    if (name && !question?.pageOnly && responses[name] !== undefined && responses[name] !== null) {
      // Exactly as stored, so the code sees the same thing as the export.
      record.answer = responses[name];
      const shown = row?.displayed_images?.[name] || row?.displayed_images?.[`${name}__trials`];
      if (Array.isArray(shown) && shown.length) record.shown = shown;
      // Short answers to the other questions of the same submission (grade, gender, group): used to split results.
      const context = {};
      Object.entries(responses).forEach(([key, stored]) => {
        // Submitted rows keep each answer as { type, answer, shown_images, ... }.
        const value = stored && typeof stored === 'object' && !Array.isArray(stored) && 'answer' in stored && 'type' in stored ? stored.answer : stored;
        if (key === name || key.startsWith('__') || Object.keys(context).length >= 20) return;
        if ((typeof value === 'string' && value.trim() && value.length <= 60) || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') context[key] = value;
      });
      if (Object.keys(context).length) record.context = context;
    }
    if (site || question?.pageOnly) {
      if (responses[SP_SITE_STATE_KEY] !== undefined) record.page_state = responses[SP_SITE_STATE_KEY];
      if (Array.isArray(responses[SP_SITE_REQUESTS_KEY])) record.requests = responses[SP_SITE_REQUESTS_KEY];
    }
    const hasData = record.answer !== undefined || record.page_state !== undefined || (record.requests && record.requests.length);
    if (hasData) out.push(record);
  });
  return out;
}

/** A string that holds a JSON object or array (pages often save state this way). */
function jsonInString(value) {
  if (typeof value !== 'string' || value.length < 2 || !/^\s*[[{]/.test(value)) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** An object used as a lookup table keyed by ids (image names, trial ids). */
function isIdMap(value) {
  const keys = Object.keys(value);
  if (keys.length < 8) return false;
  return keys.filter((k) => /\d/.test(k)).length / keys.length >= 0.8;
}

export const JSON_STRING_MARK = '(JSON string — helpers.parse it)';

function clipValue(value, depth = 0) {
  const inner = jsonInString(value);
  if (inner !== undefined) return { [JSON_STRING_MARK]: clipValue(inner, depth + 1) };
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…(${value.length} chars)` : value;
  if (!value || typeof value !== 'object') return value;
  if (depth > 6) return Array.isArray(value) ? `[array of ${value.length}]` : '{…}';
  if (Array.isArray(value)) {
    const head = value.slice(0, 4).map((item) => clipValue(item, depth + 1));
    if (value.length > 4) head.push(`…${value.length - 4} more items`);
    return head;
  }
  const out = {};
  Object.keys(value).slice(0, 40).forEach((key) => { out[key] = clipValue(value[key], depth + 1); });
  if (Object.keys(value).length > 40) out['…'] = `${Object.keys(value).length - 40} more keys`;
  return out;
}

/** A few real records, shortened, for the model to read. */
export function sampleRecords(records, { count = 3, maxChars = 14000 } = {}) {
  const picked = (records || []).slice(0, count).map((record) => clipValue(record));
  let text = JSON.stringify(picked, null, 1);
  while (text.length > maxChars && picked.length > 1) {
    picked.pop();
    text = JSON.stringify(picked, null, 1);
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Every field path seen across all records with its types and how many
 * records have it, e.g. `page_state.r10_state.trials[].choice  string  (24/24)`.
 * Small models write far better code from this than from samples alone.
 */
export function describeRecordShape(records, { maxPaths = 160 } = {}) {
  const paths = new Map();
  const visit = (raw, path, depth, seenInRecord) => {
    let value = raw;
    if (depth > 7) return;
    const key = path || '(record)';
    if (!seenInRecord.has(key)) {
      seenInRecord.add(key);
      const entry = paths.get(key) || { types: new Set(), records: 0, example: undefined };
      entry.records += 1;
      paths.set(key, entry);
    }
    const entry = paths.get(key);
    const inner = jsonInString(value);
    entry.types.add(inner !== undefined ? 'json-string' : typeName(value));
    if (inner !== undefined) value = inner;
    else if (entry.example === undefined && value !== null && typeof value !== 'object') entry.example = value;
    if (Array.isArray(value)) value.slice(0, 50).forEach((item) => visit(item, `${path}[]`, depth + 1, seenInRecord));
    else if (value && typeof value === 'object' && isIdMap(value)) {
      // { IMG0395: 2, IMG0396: 0, ... }: one path for all keys, not one per image.
      const keys = Object.keys(value);
      entry.mapKeys = entry.mapKeys || new Set();
      keys.slice(0, 3).forEach((k) => entry.mapKeys.size < 3 && entry.mapKeys.add(k));
      entry.mapSize = Math.max(entry.mapSize || 0, keys.length);
      keys.slice(0, 50).forEach((k) => visit(value[k], `${path}.{key}`, depth + 1, seenInRecord));
    } else if (value && typeof value === 'object') Object.keys(value).slice(0, 80).forEach((k) => visit(value[k], path ? `${path}.${k}` : k, depth + 1, seenInRecord));
  };
  (records || []).forEach((record) => visit(record, '', 0, new Set()));
  const total = (records || []).length;
  const lines = [];
  for (const [path, entry] of paths) {
    if (path === '(record)') continue;
    const example = entry.mapKeys
      ? `  map keyed by id, up to ${entry.mapSize} keys, e.g. ${[...entry.mapKeys].map((k) => JSON.stringify(k)).join(', ')} (read with Object.keys)`
      : entry.example === undefined ? '' : `  e.g. ${JSON.stringify(entry.example).slice(0, 60)}`;
    lines.push(`${path}  ${[...entry.types].join('|')}  (${Math.min(entry.records, total)}/${total})${example}`);
    if (lines.length >= maxPaths) {
      lines.push(`… ${paths.size - maxPaths} more paths`);
      break;
    }
  }
  return lines.join('\n');
}

/**
 * Runs inside the sandbox (and in tests). Kept as source text so the browser
 * can load it into a Worker in an isolated frame. `runAnalysis` returns
 * { ok, result } or { ok: false, error }.
 */
export const ANALYSIS_RUNTIME_SOURCE = `
var helpers = {
  parse: function (v) { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } },
  list: function (v) { v = helpers.parse(v); if (Array.isArray(v)) return v; if (v && typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; }); return v == null ? [] : [v]; },
  num: function (v) { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; var n = Number(v); return isFinite(n) ? n : null; },
  get: function (obj, path) { var parts = String(path || '').split('.'); var cur = obj; for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = helpers.parse(cur)[parts[i]]; } return typeof cur === 'string' && /^\\s*[\\[{]/.test(cur) ? helpers.parse(cur) : cur; },
  file: function (v) { var s = String(v == null ? '' : v).split('?')[0].split('#')[0]; var i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1) : s; },
  flat: function (arr) { var out = []; (arr || []).forEach(function (x) { if (Array.isArray(x)) out.push.apply(out, x); else out.push(x); }); return out; },
  media: function (record, name) {
    var state = helpers.parse(record && record.page_state) || {};
    var key = name ? 'sp-media:' + String(name).replace(/^sp-media:/, '') : Object.keys(state).filter(function (k) { return k.indexOf('sp-media:') === 0; })[0];
    var list = key ? helpers.parse(state[key]) : null;
    return Array.isArray(list) ? list : [];
  }
};
function runAnalysis(code, records) {
  var analyze;
  try {
    var src = String(code || '');
    var factory = /function\\s+analyze\\s*\\(/.test(src)
      ? new Function('helpers', '"use strict";\\n' + src + '\\n;return typeof analyze === "function" ? analyze : null;')
      : new Function('helpers', '"use strict";\\nreturn function analyze(records, helpers) {\\n' + src + '\\n};');
    analyze = factory(helpers);
  } catch (e) {
    return { ok: false, error: 'SyntaxError: ' + (e && e.message || e) };
  }
  if (typeof analyze !== 'function') return { ok: false, error: 'The code does not define function analyze(records, helpers).' };
  try {
    var result = analyze(JSON.parse(JSON.stringify(records)), helpers);
    var text = JSON.stringify(result === undefined ? null : result);
    if (text && text.length > 4000000) return { ok: false, error: 'The result is too large (over 4 MB). Return summaries, not raw records.' };
    return { ok: true, result: text ? JSON.parse(text) : null };
  } catch (e) {
    var where = e && e.stack ? String(e.stack).split('\\n').slice(0, 3).join(' | ') : '';
    return { ok: false, error: (e && e.name ? e.name + ': ' : '') + (e && e.message || String(e)) + (where ? ' [' + where + ']' : '') };
  }
}
`;

/** Run analysis code directly (Node tests, never the browser UI). */
export function runAnalysisUnsandboxed(code, records) {
  // eslint-disable-next-line no-new-func
  const run = new Function(`${ANALYSIS_RUNTIME_SOURCE}\nreturn runAnalysis;`)();
  return run(code, records);
}

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const keyOf = (value) => (value && typeof value === 'object' ? JSON.stringify(value) : clean(value, 500));

/**
 * Check the code's result. Returns { blocks, problems }; `problems` are
 * written for the model, so a failed run can be sent back to it once.
 */
export function normalizeAnalysisResult(result) {
  const problems = [];
  const raw = Array.isArray(result) ? result : Array.isArray(result?.blocks) ? result.blocks : null;
  if (!raw) return { blocks: [], problems: ['analyze() must return { blocks: [...] }.'] };
  const blocks = [];
  raw.slice(0, 20).forEach((block, i) => {
    const at = `blocks[${i}]`;
    if (!block || typeof block !== 'object') { problems.push(`${at} is not an object.`); return; }
    const type = String(block.type || '').toLowerCase();
    const title = clean(block.title, 160);
    const note = clean(block.note, 400);
    if (!AI_ANALYSIS_BLOCK_TYPES.includes(type)) { problems.push(`${at}.type "${block.type}" is not one of ${AI_ANALYSIS_BLOCK_TYPES.join(', ')}.`); return; }
    if (type === 'per_item') {
      const labels = block.labels && typeof block.labels === 'object' && !Array.isArray(block.labels) ? block.labels : {};
      const values = (Array.isArray(block.values) ? block.values : [])
        .filter((v) => v && v.item != null && v.item !== '' && v.value !== null && v.value !== undefined && v.value !== '')
        .map((v) => ({ item: keyOf(v.item), value: typeof v.value === 'number' ? v.value : keyOf(v.value), ...(v.rater != null && v.rater !== '' ? { rater: clean(v.rater, 120) } : {}) }));
      if (!values.length) { problems.push(`${at} (per_item) has no values: use values: [{ item, value, rater }].`); return; }
      const allNumeric = values.every((v) => typeof v.value === 'number' || (v.value !== '' && Number.isFinite(Number(v.value))));
      const measure = block.measure === 'category' || !allNumeric || Object.keys(labels).length ? 'category' : 'number';
      const labelText = {};
      Object.keys(labels).slice(0, 50).forEach((k) => { labelText[String(k)] = clean(labels[k], 200); });
      blocks.push({ type, title, note, values: measure === 'number' ? values.map((v) => ({ ...v, value: Number(v.value) })) : values.map((v) => ({ ...v, value: String(v.value) })), measure, labels: labelText });
    } else if (type === 'pairwise') {
      const matches = (Array.isArray(block.matches) ? block.matches : [])
        .filter((m) => m && m.winner != null && m.loser != null && keyOf(m.winner) && keyOf(m.loser) && keyOf(m.winner) !== keyOf(m.loser))
        .map((m) => ({ winner: keyOf(m.winner), loser: keyOf(m.loser), ...(m.category != null && m.category !== '' ? { category: clean(m.category, 120) } : {}) }));
      if (!matches.length) { problems.push(`${at} (pairwise) has no matches with a winner and a different loser.`); return; }
      blocks.push({ type, title, note, matches });
    } else if (type === 'ranking') {
      const orders = (Array.isArray(block.orders) ? block.orders : [])
        .map((order) => (Array.isArray(order) ? order.map(keyOf).filter(Boolean) : []))
        .filter((order) => order.length >= 2);
      if (!orders.length) { problems.push(`${at} (ranking) has no orders with at least two items.`); return; }
      blocks.push({ type, title, note, orders });
    } else if (type === 'choice') {
      const values = (Array.isArray(block.values) ? block.values : []).flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v) => v !== null && v !== undefined && v !== '').map((v) => keyOf(v));
      if (!values.length) { problems.push(`${at} (choice) has no values.`); return; }
      blocks.push({ type, title, note, values, multi: Boolean(block.multi), total: Number.isFinite(Number(block.total)) && Number(block.total) > 0 ? Number(block.total) : null });
    } else if (type === 'rating') {
      const toNums = (list) => (Array.isArray(list) ? list : []).map((v) => (v === null || v === '' || typeof v === 'boolean' ? NaN : Number(v))).filter(Number.isFinite);
      const items = Array.isArray(block.items)
        ? block.items.map((item) => ({ label: keyOf(item?.label ?? item?.key), values: toNums(item?.values) })).filter((item) => item.label && item.values.length)
        : [];
      const values = toNums(block.values);
      if (!items.length && !values.length) { problems.push(`${at} (rating) has no numeric values (use values: [numbers] or items: [{label, values}]).`); return; }
      const min = Number.isFinite(Number(block.min)) ? Number(block.min) : null;
      const max = Number.isFinite(Number(block.max)) ? Number(block.max) : null;
      blocks.push({ type, title, note, items, values, min, max });
    } else if (type === 'text') {
      const values = (Array.isArray(block.values) ? block.values : []).map((v) => String(v ?? '').trim()).filter(Boolean).map((v) => v.slice(0, 5000));
      if (!values.length) { problems.push(`${at} (text) has no non-empty strings.`); return; }
      blocks.push({ type, title, note, values });
    } else if (type === 'table') {
      const columns = (Array.isArray(block.columns) ? block.columns : []).map((c) => clean(c, 80)).slice(0, 30);
      const rows = (Array.isArray(block.rows) ? block.rows : []).slice(0, 2000)
        .map((row) => (Array.isArray(row) ? row : columns.map((c) => row?.[c])).slice(0, columns.length).map((cell) => (cell && typeof cell === 'object' ? JSON.stringify(cell) : cell ?? '')));
      if (!columns.length || !rows.length) { problems.push(`${at} (table) needs columns and rows.`); return; }
      blocks.push({ type, title, note, columns, rows });
    } else if (type === 'bar') {
      const items = (Array.isArray(block.items) ? block.items : []).map((item) => ({ label: keyOf(item?.label), value: Number(item?.value) }))
        .filter((item) => item.label && Number.isFinite(item.value)).slice(0, 200);
      if (!items.length) { problems.push(`${at} (bar) needs items: [{label, value}] with numeric values.`); return; }
      blocks.push({ type, title, note, items, unit: clean(block.unit, 40) });
    } else if (type === 'note') {
      const text = clean(block.text || block.note, 2000);
      if (text) blocks.push({ type, title, text });
    }
  });
  const dataBlocks = blocks.filter((b) => b.type !== 'note');
  if (dataBlocks.length > AI_ANALYSIS_MAX_DATA_BLOCKS) {
    problems.push(`Only ${AI_ANALYSIS_MAX_DATA_BLOCKS} data blocks were kept: analyse this one question only.`);
    const keep = new Set(dataBlocks.slice(0, AI_ANALYSIS_MAX_DATA_BLOCKS));
    for (let i = blocks.length - 1; i >= 0; i -= 1) if (blocks[i].type !== 'note' && !keep.has(blocks[i])) blocks.splice(i, 1);
  }
  if (!blocks.some((b) => b.type !== 'note') && !problems.length) problems.push('No block carries data: every block was empty or a note. Check the field paths against FIELDS.');
  return { blocks, problems };
}

const round = (n, d = 3) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * One answer per (item, rater): the usual shape of a study where each
 * participant sees a random subset or order of images. Summarised per item,
 * never per position, with agreement across raters (Krippendorff's alpha).
 */
function computePerItemBlock(block) {
  const byItem = new Map();
  block.values.forEach((v) => {
    if (!byItem.has(v.item)) byItem.set(v.item, []);
    byItem.get(v.item).push(v);
  });
  const raters = new Set(block.values.map((v) => v.rater).filter(Boolean));
  const categories = block.measure === 'category'
    ? [...new Set([...Object.keys(block.labels || {}), ...block.values.map((v) => v.value)])].sort((a, b) => (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : String(a).localeCompare(String(b))))
    : [];
  // Agreement: one coder per rater, one unit per item (platform reliability code).
  let alpha = null;
  if (raters.size >= 2) {
    const code = new Map(categories.map((c, i) => [c, i]));
    const rows = [...raters].map((rater) => ({
      participant_id: rater,
      responses: { __ai: { trials: block.values.filter((v) => v.rater === rater).map((v) => ({ answer: block.measure === 'category' ? code.get(v.value) : v.value, shown_images: [v.item] })) } },
    }));
    alpha = krippendorffAlpha(rows, '__ai', { level: block.measure === 'category' ? 'nominal' : 'interval' });
  }
  const label = (c) => (block.labels?.[c] ? `${c} · ${block.labels[c]}` : c);
  let columns;
  let rows;
  let items;
  if (block.measure === 'number') {
    items = [...byItem.entries()].map(([item, list]) => {
      const s = descriptiveStats(list.map((v) => v.value));
      return { item, n: s.n, mean: s.mean, sd: s.sd, median: s.median, min: s.min, max: s.max };
    }).sort((a, b) => b.mean - a.mean);
    columns = ['item', 'n', 'mean', 'sd', 'median', 'min', 'max'];
    rows = items.map((r) => [r.item, r.n, round(r.mean), round(r.sd), round(r.median), round(r.min), round(r.max)]);
  } else {
    items = [...byItem.entries()].map(([item, list]) => {
      const counts = {};
      list.forEach((v) => { counts[v.value] = (counts[v.value] || 0) + 1; });
      const mode = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      return { item, n: list.length, counts, mode, agreement: counts[mode] / list.length };
    // Least agreement first: the images raters disagree on are the ones to look at.
    }).sort((a, b) => (a.agreement - b.agreement) || (b.n - a.n) || String(a.item).localeCompare(String(b.item)));
    columns = ['item', 'n', 'majority', 'majority_share', ...categories.map((c) => `n_${c}`)];
    rows = items.map((r) => [r.item, r.n, r.mode, round(r.agreement), ...categories.map((c) => r.counts[c] || 0)]);
  }
  const overall = block.measure === 'category'
    ? categories.map((c) => {
      const count = block.values.filter((v) => v.value === c).length;
      const ci = wilsonCI(count, block.values.length);
      return { category: c, label: label(c), count, pct: count / block.values.length * 100, low: ci.low * 100, high: ci.high * 100 };
    })
    : null;
  return {
    ...block,
    items,
    categories,
    overall,
    raterCount: raters.size,
    itemCount: byItem.size,
    alpha: alpha == null ? null : round(alpha),
    alphaText: interpretAlpha(alpha),
    table: { columns, rows },
  };
}

/**
 * Run the platform's own algorithms on normalized blocks. Each computed
 * block carries `table` ({ columns, rows }) used for display and export.
 */
export function computeAnalysisBlocks(blocks) {
  return (blocks || []).map((block) => {
    if (block.type === 'per_item') return computePerItemBlock(block);
    if (block.type === 'pairwise' || block.type === 'ranking') {
      const matches = block.type === 'pairwise' ? block.matches : block.orders.flatMap((order) => matchesFromOrderedRanking(order));
      const split = block.type === 'pairwise' && block.matches.some((m) => m.category);
      const trueskill = computeTrueSkillFromMatches(matches, { splitByCategory: split });
      const boards = trueSkillBoards(trueskill);
      let borda = null;
      let kendall = null;
      if (block.type === 'ranking') {
        const byItem = {};
        let maxLen = 0;
        block.orders.forEach((order) => {
          maxLen = Math.max(maxLen, order.length);
          order.forEach((item, idx) => { (byItem[item] = byItem[item] || []).push(idx + 1); });
        });
        borda = computeBordaScores(byItem, maxLen);
        const items = Object.keys(byItem);
        const w = kendallW(block.orders, items);
        kendall = { w: round(w), interpretation: interpretKendallW(w), judges: block.orders.length };
      }
      const columns = ['category', 'rank', 'item', 'mu', 'sigma', 'mu_std5', 'wins', 'losses', 'games'];
      if (borda) columns.push('borda', 'avg_rank');
      const rows = boards.flatMap((board) => board.rankings.map((r) => {
        const row = [board.label || '', r.rank, r.imageKey, round(r.mu), round(r.sigma), round(r.muStd5), r.wins, r.losses, r.games];
        if (borda) row.push(round(borda[r.imageKey]?.borda), round(borda[r.imageKey]?.avgRank));
        return row;
      }));
      return { ...block, boards, kendall, matchCount: matches.length, table: { columns, rows } };
    }
    if (block.type === 'choice') {
      const counts = new Map();
      block.values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
      const n = block.total || block.values.length;
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => {
        const ci = wilsonCI(count, n);
        return [label, count, round(count / n * 100, 1), round(ci.low * 100, 1), round(ci.high * 100, 1)];
      });
      return { ...block, n, table: { columns: ['option', 'count', 'percent', 'ci95_low', 'ci95_high'], rows } };
    }
    if (block.type === 'rating') {
      const series = block.items.length ? block.items : [{ label: block.title || 'value', values: block.values }];
      const rows = series.map((item) => {
        const s = descriptiveStats(item.values);
        const se = s.n > 1 ? s.sd * Math.sqrt(s.n / (s.n - 1)) / Math.sqrt(s.n) : null;
        return [item.label, s.n, round(s.mean), round(s.sd), round(s.median), round(s.min), round(s.max), se == null ? null : round(s.mean - 1.96 * se), se == null ? null : round(s.mean + 1.96 * se)];
      });
      if (block.items.length) rows.sort((a, b) => (b[2] ?? -Infinity) - (a[2] ?? -Infinity));
      return { ...block, series, table: { columns: ['item', 'n', 'mean', 'sd', 'median', 'min', 'max', 'ci95_low', 'ci95_high'], rows } };
    }
    if (block.type === 'text') {
      const words = wordFrequency(block.values, 30);
      const lengths = textLengthStats(block.values);
      return { ...block, words, lengths, table: { columns: ['word', 'responses'], rows: words.map((w) => [w.word, w.count]) } };
    }
    if (block.type === 'bar') {
      return { ...block, table: { columns: ['label', block.unit || 'value'], rows: block.items.map((item) => [item.label, round(item.value, 4)]) } };
    }
    if (block.type === 'table' || block.type === 'coverage') return { ...block, table: { columns: block.columns, rows: block.rows } };
    return { ...block, table: null };
  });
}

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pages often name their own items ("S03") and take the pictures from the
 * media library list the platform gave them, by position (SCENES[i].img =
 * PHOTO_URLS[i], id 'S'+(i+1)). Answers then hold the page's ids. This finds
 * that mapping in the page code and returns id -> library image name, so
 * results show the real images whatever code the model wrote.
 */
// Same rule as spSite.findImageSlots: a word of the name says it holds pictures.
function isImageListName(name) {
  return String(name || '').replace(/([a-z\d])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/).some((w) => /^(photo|image|img|stimul|media)|^(pic|pics|picture|pictures)$/.test(w.toLowerCase()));
}

export function pageIdMediaMap(records, pageHtml) {
  if (!pageHtml) return null;
  const html = String(pageHtml);
  // How the page builds its ids: 'S'+String(i+1).padStart(2,'0'), 'S'+(i+1), `S${i+1}`.
  const idRe = /(['"`])([A-Za-z][A-Za-z_-]{0,11})\1\s*\+\s*(?:String\s*\(\s*)?\(?\s*(\w+)\s*(?:\+\s*(\d+))?\s*\)?|`([A-Za-z][A-Za-z_-]{0,11})\$\{\s*(?:String\s*\(\s*)?(\w+)\s*(?:\+\s*(\d+))?/g;
  const formats = [];
  let m;
  while ((m = idRe.exec(html))) {
    const prefix = m[2] || m[5];
    const offset = Number(m[4] || m[7] || 0);
    if (!formats.some((f) => f.prefix === prefix)) formats.push({ prefix, offset });
  }
  // The list every submission got (the platform sorts it, so it is the same for all).
  const lists = new Map();
  (records || []).forEach((record) => {
    const state = record?.page_state && typeof record.page_state === 'object' ? record.page_state : {};
    Object.keys(state).filter((k) => k.startsWith('sp-media:')).forEach((k) => {
      const list = jsonInString(state[k]) ?? state[k];
      if (!Array.isArray(list) || !list.length) return;
      const names = list.map((x) => (x && typeof x === 'object' ? (x.name || String(x.url || '').split('/').pop()) : String(x || '').split('/').pop()));
      const sig = `${k}\n${names.join('\n')}`;
      const entry = lists.get(sig) || { name: k.slice(9), names, count: 0 };
      entry.count += 1;
      lists.set(sig, entry);
    });
  });
  const best = [...lists.values()].sort((a, b) => b.count - a.count)[0];
  // Without a usable mapping, say why on the result (ids stay as the page wrote them).
  // The page's own image lists the platform can fill (const PHOTO_URLS = [...]).
  const slots = [...new Set([...html.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g)].map((x) => x[1]).filter(isImageListName))];
  if (!best) {
    return formats.length && slots.length
      ? { names: [], formats, reason: `这些答卷里没有媒体库图片列表（${slots.join(', ')}）：提交时页面没有从媒体库取图（没链接媒体库文件夹，或答卷在链接之前提交），页面显示的是它自己的图，所以只能用页面编号` }
      : null;
  }
  const list = escapeRe(best.name);
  // The page must use the list by position.
  const positional = new RegExp(`${list}\\s*\\.\\s*forEach\\s*\\(\\s*(?:function\\s*)?\\(?\\s*\\w+\\s*,\\s*\\w+|${list}\\s*\\[\\s*\\w+\\s*(?:[-+]\\s*\\d+\\s*)?\\]|${list}\\s*\\.\\s*map\\s*\\(\\s*(?:function\\s*)?\\(?\\s*\\w+\\s*,\\s*\\w+`).test(html);
  if (!positional || !formats.length) {
    return { names: [], formats, reason: `页面代码里找不到编号和媒体库图片（${best.name}）按位置对应的写法，所以保留页面编号` };
  }
  return { list: best.name, names: best.names, formats };
}

/**
 * Give the analysis the images participants really saw. When the page names
 * its items itself ("S03") and takes the pictures from the media list it was
 * given, by position, each record's page ids are replaced with the library
 * image at that position in THAT participant's list (lists are drawn at random
 * per participant). Values are rewritten in place of exact matches only, and a
 * value that was a JSON string stays one.
 */
export function mapRecordsToMedia(records, pageHtml) {
  const map = pageIdMediaMap(records, pageHtml);
  if (!map || map.reason || !map.formats.length) return records;
  const key = `sp-media:${map.list}`;
  return (records || []).map((record) => {
    const state = record?.page_state && typeof record.page_state === 'object' ? record.page_state : null;
    if (!state) return record;
    const list = jsonInString(state[key]) ?? state[key];
    if (!Array.isArray(list) || !list.length) return record;
    const names = list.map((x) => (x && typeof x === 'object' ? (x.name || String(x.url || '').split('/').pop()) : String(x || '').split('/').pop()));
    const own = { ...map, names };
    const swap = (value) => {
      if (typeof value === 'string') return mediaNameForId(own, value) || value;
      if (Array.isArray(value)) return value.map(swap);
      if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).forEach((k) => { out[mediaNameForId(own, k) || k] = swap(value[k]); });
        return out;
      }
      return value;
    };
    const next = {};
    Object.keys(state).forEach((k) => {
      if (k.startsWith('sp-media:')) { next[k] = state[k]; return; }
      const parsed = jsonInString(state[k]);
      next[k] = parsed !== undefined ? JSON.stringify(swap(parsed)) : swap(state[k]);
    });
    return { ...record, page_state: next };
  });
}

/** name -> url for every image in the media lists the page was given. */
export function pageMediaUrls(records) {
  const out = new Map();
  (records || []).forEach((record) => {
    const state = record?.page_state && typeof record.page_state === 'object' ? record.page_state : {};
    Object.keys(state).filter((k) => k.startsWith('sp-media:')).forEach((k) => {
      const list = jsonInString(state[k]) ?? state[k];
      (Array.isArray(list) ? list : []).forEach((m) => {
        if (m && typeof m === 'object' && m.name && m.url && !out.has(m.name)) out.set(m.name, m.url);
      });
    });
  });
  return out;
}

function idNumber(map, id) {
  if (!map || typeof id !== 'string') return null;
  for (const f of map.formats) {
    const m = id.match(new RegExp(`^${escapeRe(f.prefix)}0*(\\d+)$`));
    if (m) return { index: Number(m[1]) - f.offset };
  }
  return null;
}

function mediaNameForId(map, id) {
  const hit = idNumber(map, id);
  return hit && map.names[hit.index] ? map.names[hit.index] : null;
}

/**
 * Replace page ids with library image names in normalized blocks (for ids the
 * records still carry), and say on each block what was done: mapped from each
 * participant's list, ids past the end of the list kept, or why nothing could
 * be mapped.
 */
export function remapBlocksToMedia(blocks, map, { mappedRecords = false, libraryNames = new Set() } = {}) {
  if (!map) return blocks;
  const addNote = (block, text) => (text ? { ...block, note: [block.note, text].filter(Boolean).join(' · ') } : block);
  const doneNote = `编号已按页面代码换成每位参与者实际看到的媒体库图片（${map.list}）`;
  return blocks.map((block) => {
    const ids = [];
    if (block.type === 'pairwise') block.matches.forEach((x) => ids.push(x.winner, x.loser));
    else if (block.type === 'ranking') block.orders.forEach((o) => ids.push(...o));
    else if (block.type === 'per_item') block.values.forEach((v) => ids.push(v.item));
    else if (block.type === 'rating') block.items.forEach((it) => ids.push(it.label));
    else if (block.type === 'bar') block.items.forEach((it) => ids.push(it.label));
    else if (block.type === 'choice') ids.push(...block.values);
    else if (block.type === 'table') {
      // Only cells that are exactly a page id; everything else stays as written.
      let seen = false;
      let changed = false;
      const rows = block.rows.map((row) => row.map((cell) => {
        if (idNumber(map, cell)) seen = true;
        const name = mediaNameForId(map, cell);
        if (name) changed = true;
        return name ? `${name} (${cell})` : cell;
      }));
      if (changed) return addNote({ ...block, rows }, doneNote);
      return seen && map.reason ? addNote(block, map.reason) : block;
    } else return block;
    if (!ids.length) return block;
    const pageIds = [...new Set(ids.filter((id) => idNumber(map, id)))];
    const names = ids.filter((id) => libraryNames.has(id));
    // Every item is either a page id or a library image, and at least one id or image is there.
    if (pageIds.length + new Set(names).size === 0 || !ids.every((id) => idNumber(map, id) || libraryNames.has(id))) return block;
    if (map.reason) return pageIds.length ? addNote(block, map.reason) : block;
    if (mappedRecords) {
      // The records were mapped per participant; ids left over had no image at that position.
      const left = pageIds.length ? `；${pageIds.slice(0, 8).join('、')} 超出参与者拿到的 ${map.names.length} 张图，页面没有对应的媒体库图片，保留编号` : '';
      return addNote(block, names.length ? doneNote + left : left.slice(1));
    }
    const missing = pageIds.filter((id) => !mediaNameForId(map, id));
    if (missing.length === pageIds.length) return addNote(block, `媒体库图片列表（${map.list}）只有 ${map.names.length} 张，这些编号都超出了，页面用的是它自己的图`);
    const to = (id) => mediaNameForId(map, id) || id;
    const note = `${doneNote}${missing.length ? `；${missing.slice(0, 8).join('、')} 超出媒体库的 ${map.names.length} 张图，保留编号` : ''}`;
    if (block.type === 'pairwise') return addNote({ ...block, matches: block.matches.map((x) => ({ ...x, winner: to(x.winner), loser: to(x.loser) })) }, note);
    if (block.type === 'ranking') return addNote({ ...block, orders: block.orders.map((o) => o.map(to)) }, note);
    if (block.type === 'per_item') return addNote({ ...block, values: block.values.map((v) => ({ ...v, item: to(v.item) })) }, note);
    if (block.type === 'rating' || block.type === 'bar') return addNote({ ...block, items: block.items.map((it) => ({ ...it, label: to(it.label) })) }, note);
    return addNote({ ...block, values: block.values.map(to) }, note);
  });
}

// ── Platform summaries: record shapes the platform recognises without the model ──

const OBS_IMAGE_ID_KEYS = ['imageId', 'image_id', 'stimulusId', 'stimulus_id', 'sceneId', 'scene_id', 'photoId', 'photo_id'];
const OBS_IMAGE_KEYS = ['imageName', 'image_name', 'image', 'img', 'photo', 'picture', 'stimulus', 'file', 'filename', 'imageUrl', 'image_url', 'url', 'name'];
const OBS_ITEM_KEYS = ['itemId', 'item_id', 'item', 'dimension', 'dim', 'attribute', 'scale', 'metric', 'question', 'key'];
const OBS_VALUE_KEYS = ['value', 'score', 'rating', 'response', 'answer'];
const OBS_MAP_KEYS = ['ratings', 'scores', 'answers', 'values', 'responses', 'items', 'rating', 'scale'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The image an object is about: { key, label }. The key is the page's own id
 * (imageId) when it has one, so the same image stored nested (scenes[].imageId)
 * and flat (ratings[].imageId) counts once; else the file name. The label is
 * the file name when known. Never a generic id like P057B_S3 under `id`.
 */
function observationImage(obj) {
  const str = (keys) => {
    for (const key of keys) {
      const v = obj[key];
      if (typeof v !== 'string' || !v.trim()) continue;
      if (/^(https?:)?\/\/|\//.test(v)) return v.split(/[?#]/)[0].split('/').pop();
      return v.trim();
    }
    return '';
  };
  const id = str(OBS_IMAGE_ID_KEYS);
  const name = str(OBS_IMAGE_KEYS);
  if (!id && !name) return null;
  return { key: id || name, label: name || id };
}

/** A map of several numeric items ({ A1: 3, M1: 5, … }) with at least two entries. */
function numericItemMap(value) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value).filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
  return entries.length >= 2 && entries.length === Object.keys(value).length ? entries : null;
}

/**
 * Rating observations { image, item, value } found anywhere in one record:
 * objects that name an image and carry a map of numeric items (scenes[].ratings),
 * objects with an image, an item and a value (a flat list), or a map keyed by
 * image whose values are maps of numbers. One observation per image and item,
 * so a page that stores the same ratings twice (nested and flat) is not counted twice.
 */
function recordObservations(record) {
  const seen = new Map();
  const labels = new Map();
  const add = (image, item, value) => {
    if (!image || !item || typeof value !== 'number' || !Number.isFinite(value)) return;
    const key = `${image.key}\u0000${item}`;
    if (!seen.has(key)) seen.set(key, { image: image.key, item: String(item), value });
    // A file name beats a bare id as the row label.
    if (image.label !== image.key || !labels.has(image.key)) labels.set(image.key, image.label);
  };
  const visit = (value, depth) => {
    if (depth > 7 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.slice(0, 5000).forEach((v) => visit(v, depth + 1));
      return;
    }
    const image = observationImage(value);
    if (image) {
      OBS_MAP_KEYS.forEach((k) => { const entries = numericItemMap(value[k]); if (entries) entries.forEach(([item, v]) => add(image, item, v)); });
      const item = OBS_ITEM_KEYS.map((k) => value[k]).find((v) => typeof v === 'string' && v.trim());
      const val = OBS_VALUE_KEYS.map((k) => value[k]).find((v) => typeof v === 'number');
      if (item && val !== undefined) add(image, item.trim(), val);
    }
    // { P057B: { A1: 3, … }, P027B: { … } }
    if (isIdMap(value)) {
      Object.entries(value).forEach(([imageKey, v]) => { const entries = numericItemMap(v); if (entries) entries.forEach(([item, n]) => add({ key: imageKey, label: imageKey }, item, n)); });
    }
    Object.values(value).forEach((v) => {
      const parsed = typeof v === 'string' ? jsonInString(v) : v;
      visit(parsed, depth + 1);
    });
  };
  visit(record?.answer, 0);
  if (record?.page_state !== undefined) visit(record.page_state, 0);
  return { observations: [...seen.values()], labels };
}

/**
 * The summaries the platform computes itself from the records' shape, before
 * and regardless of any model-written code. Today: when every participant
 * rated several images on the same set of items, a table of the mean per
 * image and item. Empty when the records do not have such a shape.
 */
export function platformSummaryBlocks(records) {
  const cells = new Map(); // image -> item -> values
  const raters = new Map(); // image -> set of raters
  const itemCounts = new Map();
  const labels = new Map();
  (records || []).forEach((record, i) => {
    const { observations: obs, labels: recordLabels } = recordObservations(record);
    if (!obs.length) return;
    recordLabels.forEach((label, key) => { if (label !== key || !labels.has(key)) labels.set(key, label); });
    const rater = record?.participant_id || `row_${i + 1}`;
    obs.forEach(({ image, item, value }) => {
      if (!cells.has(image)) cells.set(image, new Map());
      const row = cells.get(image);
      if (!row.has(item)) row.set(item, []);
      row.get(item).push(value);
      if (!raters.has(image)) raters.set(image, new Set());
      raters.get(image).add(rater);
      itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
    });
  });
  const images = [...cells.keys()];
  // Items rated on most images, in a stable order; one-off keys are noise.
  const items = [...itemCounts.entries()].filter(([, n]) => n >= Math.max(2, images.length * 0.5)).map(([item]) => item).sort();
  if (images.length < 2 || items.length < 2) return [];
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const round = (n) => (n == null ? '' : Math.round(n * 100) / 100);
  const rows = images.sort().map((image) => [labels.get(image) || image, ...items.map((item) => round(mean(cells.get(image).get(item) || []))), raters.get(image).size]);
  return [{
    type: 'table',
    platform: true,
    title: '图片 × 条目 平均分（平台自动汇总 · platform summary）',
    note: `每位参与者对每张图的每个条目计一次；n = 评分人数。${images.length} 张图 × ${items.length} 个条目。 One observation per participant, image and item; n = raters.`,
    columns: ['image', ...items, 'n'],
    rows,
  }];
}

/** What a saved analysis holds: a plan (the model's reading of the fields) and/or code (sandboxed analyze()). */
export function savedParts(saved) {
  if (typeof saved === 'string') return { plan: null, code: saved };
  if (!saved || typeof saved !== 'object') return { plan: null, code: '' };
  return { plan: saved.plan && typeof saved.plan === 'object' && Array.isArray(saved.plan.fields) ? saved.plan : null, code: String(saved.code || '') };
}

/** True when the question's answers are objects the plan can read (a custom question, a custom task), not a page-only record. */
export function hasPlannableAnswers(records) {
  return answerRows(records).length > 0;
}

/**
 * What the platform computes itself: the image × item table it recognises
 * on its own, then (when a plan is saved) the plan's coverage and one block
 * per field the plan maps. Deterministic: the same records and plan always
 * give the same blocks.
 */
export function platformAnalysis(records, { pageHtml = '', plan = null } = {}) {
  const mapped = mapRecordsToMedia(records, pageHtml);
  const summary = platformSummaryBlocks(records);
  const run = plan ? runPlan(mapped, plan, { imageItemTable: summary.length > 0 }) : { blocks: [], coverage: [], rows: 0, participants: 0 };
  const coverage = plan ? planBlock(plan, run) : null;
  // A plan that maps the ratings itself replaces the platform's own guess of the same table.
  const keepSummary = !run.blocks.some((b) => b.type === 'table' && /每张图在每个条目上的平均分/.test(b.title));
  // Same shape as checked model blocks, so the same statistics run on them.
  const shaped = run.blocks.map((block) => ({
    note: '',
    ...block,
    ...(block.type === 'rating' ? { items: block.items || [], values: block.values || [], min: block.min ?? null, max: block.max ?? null } : null),
    ...(block.type === 'choice' ? { values: block.values.map(String), multi: Boolean(block.multi), total: block.total || null } : null),
    ...(block.type === 'per_item' ? { labels: block.labels || {}, measure: block.measure || 'number' } : null),
  }));
  return { run, blocks: [...(keepSummary ? summary : []), ...(coverage ? [coverage] : []), ...shaped] };
}

/** The data a block carries, order-free: two blocks with the same signature show the same thing. */
function blockSignature(block) {
  const sorted = (list) => JSON.stringify([...list].sort());
  // Items by file name (a URL and its file name are the same image); who answered does not change what is shown.
  const file = (v) => String(v ?? '').split(/[?#]/)[0].split('/').pop();
  if (block.type === 'pairwise') return `pairwise:${sorted(block.matches.map((m) => `${file(m.winner)}>${file(m.loser)}`))}`;
  if (block.type === 'per_item') return `per_item:${sorted(block.values.map((v) => `${file(v.item)}|${v.value}`))}`;
  // Platform choice values read "label (code)"; a model copy may use either the code or the label.
  if (block.type === 'choice') return `choice:${sorted(block.values.map((v) => { const m = String(v).match(/^(.*) \(([^()]*)\)$/); return m ? m[2] : String(v); }))}`;
  if (block.type === 'rating') return `rating:${sorted((block.items?.length ? block.items.flatMap((i) => i.values) : block.values).map(Number))}`;
  return null;
}

/**
 * Run the saved analysis (plan and/or code) on the records:
 * { ok, blocks, platformBlocks, modelBlocks, problems, error }. The plan part
 * never depends on code running: when the code fails, the plan's blocks are
 * still shown and `error` says what went wrong with the code.
 */
export async function evaluateAnalysis(saved, records, runner, { pageHtml = '' } = {}) {
  const { plan, code } = savedParts(saved);
  const platform = platformAnalysis(records, { pageHtml, plan });
  const platformBlocks = computeAnalysisBlocks(platform.blocks);
  // The platform's own table or a plan's blocks stand without code.
  const hasPlatform = platform.blocks.length > 0;
  const finish = (modelBlocks, problems, error = '') => {
    const ok = !error || hasPlatform;
    return { ok, error, problems, platformBlocks, modelBlocks, blocks: [...platformBlocks, ...modelBlocks] };
  };
  if (!String(code || '').trim()) return hasPlatform ? finish([], []) : { ...finish([], [], 'No analysis code.'), ok: false };
  const mapped = mapRecordsToMedia(records, pageHtml);
  const run = await runner(code, mapped);
  if (!run?.ok) return finish([], [], run?.error || 'The code did not run.');
  const { blocks, problems } = normalizeAnalysisResult(run.result);
  // A model block with exactly the data of a platform block would only repeat it; anything else is kept.
  const done = new Set(platform.blocks.map(blockSignature).filter(Boolean));
  platform.blocks.filter((b) => b.type === 'choice').forEach((b) => {
    done.add(`choice:${JSON.stringify(b.values.map((v) => String(v).replace(/ \([^()]*\)$/, '')).sort())}`);
    // The plan shows labels; a model copy may list the stored codes instead.
    if (Array.isArray(b.codes)) done.add(`choice:${JSON.stringify(b.codes.map(String).sort())}`);
  });
  const extra = blocks.filter((b) => !done.has(blockSignature(b)));
  if (!extra.some((b) => b.type !== 'note')) {
    return hasPlatform ? finish(computeAnalysisBlocks(extra), problems) : finish([], problems, problems.join(' ') || 'No usable result.');
  }
  const remapped = remapBlocksToMedia(extra, pageIdMediaMap(records, pageHtml), {
    mappedRecords: mapped !== records,
    libraryNames: new Set(pageMediaUrls(records).keys()),
  });
  return finish(computeAnalysisBlocks(remapped), problems);
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text) && !/^-?\d/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeName(name) {
  return String(name || 'question').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'question';
}

/** Export files for one question's AI analysis: a CSV per block, the code, and a note. */
export function aiAnalysisExportFiles(question, saved, computedBlocks) {
  const base = `questions/${safeName(question?.name)}__ai`;
  const files = [];
  (computedBlocks || []).forEach((block, index) => {
    if (!block.table) return;
    const lines = [block.table.columns.map(csvCell).join(','), ...block.table.rows.map((row) => row.map(csvCell).join(','))];
    // Platform blocks are marked so a reader knows no model was involved.
    files.push({ path: `${base}__${index + 1}_${block.platform ? 'platform_' : ''}${block.type}.csv`, content: `﻿${lines.join('\r\n')}\r\n` });
  });
  if (saved?.code) files.push({ path: `${base}__analyze.js`, content: `${aiAnalysisCodeHeader(question, saved)}${saved.code}\n` });
  return files;
}

export function aiAnalysisCodeHeader(question, saved) {
  return [
    '// AI-written analysis for SP-Survey question',
    `//   ${clean(question?.name)}${question?.title ? ` · ${clean(typeof question.title === 'string' ? question.title : Object.values(question.title)[0])}` : ''}`,
    `// Written by ${saved?.model || 'the Assistant model'} on ${saved?.createdAt || ''}. The question type was inferred by the model: check it.`,
    '// analyze(records, helpers) reshapes the records; SP-Survey runs TrueSkill, Borda/Kendall W,',
    '// Wilson intervals, descriptive stats and word frequency on the blocks it returns.',
    '',
  ].join('\n');
}

export const AI_ANALYSIS_README_LINES = [
  '',
  'AI-written analyses',
  '-------------------',
  'questions/{name}__ai__{n}_{type}.csv   Results of the analysis the Assistant model wrote for a',
  '                                       question SP-Survey does not analyse by itself.',
  'questions/{name}__ai__{n}_platform_{type}.csv   Computed by SP-Survey itself from the answer fields, no model',
  '                                       involved (the _coverage file lists every field: analysed or skipped and why).',
  'questions/{name}__ai__analyze.js       The code it wrote. The question type was inferred by the model;',
  '                                       check it. Statistics are SP-Survey\'s own (TrueSkill, Borda,',
  '                                       Kendall W, Wilson 95% CI, descriptive stats, word frequency).',
];

/** Saved analyses live in the project's metadata, keyed by question name. */
export function readSavedAnalyses(project) {
  const saved = project?.metadata?.resultsAiAnalyses;
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

export function makeSavedAnalysis({ code, plan = null, model, provider, instructions = '', questionTitle = '' }) {
  return {
    version: AI_ANALYSIS_VERSION,
    ...(plan ? { plan } : {}),
    code: String(code || '').slice(0, 60000),
    model: model || '',
    provider: provider || '',
    instructions: String(instructions || '').slice(0, 2000),
    questionTitle: clean(questionTitle, 300),
    createdAt: new Date().toISOString(),
  };
}

/** The question text the model reads. */
export function questionBrief(question) {
  const text = (value) => (value && typeof value === 'object' ? Object.values(value)[0] : value);
  const parts = [`name: ${clean(question?.name, 160)}`];
  if (question?.type) parts.push(`type as recorded: ${clean(question.type, 60)}${question.pageOnly ? ' (seen on the page; the answers are only in page_state / requests)' : ''}`);
  if (text(question?.title)) parts.push(`title: ${clean(text(question.title), 600)}`);
  if (text(question?.description)) parts.push(`description: ${clean(text(question.description), 800)}`);
  if (Array.isArray(question?.choices) && question.choices.length) {
    parts.push(`choices: ${question.choices.slice(0, 30).map((c) => (c && typeof c === 'object' ? `${clean(c.value, 60)}=${clean(text(c.text), 80)}` : clean(c, 80))).join('; ')}`);
  }
  if (question?.rateMin != null || question?.rateMax != null) parts.push(`scale: ${question.rateMin ?? ''}..${question.rateMax ?? ''}`);
  return parts.join('\n');
}

function listSizes(records, lists) {
  const sizes = new Set();
  (records || []).forEach((record) => lists.forEach((k) => {
    const list = jsonInString(record?.page_state?.[k]) ?? record?.page_state?.[k];
    if (Array.isArray(list)) sizes.add(list.length);
  }));
  return sizes.size ? `${[...sizes].sort((a, b) => a - b).join(' or ')} images` : 'empty';
}

const JS_WORDS = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'this', 'true', 'false', 'null', 'undefined', 'length', 'forEach', 'map', 'filter', 'push', 'slice', 'Math', 'String', 'Number', 'Array', 'Object', 'JSON', 'from', 'img', 'src']);

/**
 * The lines of the page's own script that use the media library list (e.g.
 * PHOTO_URLS) and the lines defining what they use, two levels deep. This is
 * how the model learns that, say, scene "S03" shows PHOTO_URLS[2].
 */
export function pageCodeExcerpt(html, listNames = [], { maxChars = 5000, maxLine = 420, patterns = [] } = {}) {
  const names = [...new Set((listNames || []).map((n) => String(n).replace(/^sp-media:/, '')).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)))];
  if (!html || (!names.length && !patterns.length)) return '';
  const scripts = [...String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const lines = scripts.split('\n');
  const picked = new Set();
  const wordRe = (w) => new RegExp(`(^|[^\\w$])${w.replace(/\$/g, '\\$')}([^\\w$]|$)`);
  lines.forEach((line, i) => { if (names.some((n) => wordRe(n).test(line)) || patterns.some((re) => re.test(line))) picked.add(i); });
  let frontier = [...picked];
  for (let level = 0; level < 2 && frontier.length; level += 1) {
    const ids = new Set();
    frontier.forEach((i) => (lines[i].match(/[A-Za-z_$][\w$]*/g) || []).forEach((w) => { if (w.length > 1 && !JS_WORDS.has(w) && !names.includes(w)) ids.add(w); }));
    const next = [];
    lines.forEach((line, i) => {
      if (picked.has(i)) return;
      for (const id of ids) {
        if (new RegExp(`(?:const|let|var|function)\\s+${id.replace(/\$/g, '\\$')}\\b`).test(line)) {
          picked.add(i);
          next.push(i);
          // A function's body often continues on the next lines (where ids are built).
          if (/\bfunction\b|=>\s*\{?\s*$/.test(line)) for (let k = 1; k <= 2 && i + k < lines.length; k += 1) picked.add(i + k);
          break;
        }
      }
    });
    frontier = next;
  }
  let out = '';
  for (const i of [...picked].sort((a, b) => a - b)) {
    const text = lines[i].trim();
    const line = `${i + 1}: ${text.length > maxLine ? `${text.slice(0, maxLine)}…` : text}\n`;
    if (out.length + line.length > maxChars) break;
    out += line;
  }
  return out.trim();
}

/** Where a page or task hands its data over: the lines the model needs to read the records. */
const RECORD_API_RE = [/SPSkill\s*\.\s*setAnswer|SPSite\s*\.\s*(answer|complete|onSubmit|onRequest)|localStorage\s*\.\s*setItem|postMessage\s*\(|sendBeacon|\bfetch\s*\(/];
const GENERIC_FIELD_NAMES = new Set(['answer', 'page_state', 'requests', 'shown', 'participant_id', 'submitted_at', 'value', 'text', 'data', 'id', 'name', 'type', 'url', 'key', 'items', 'list', 'result', 'results']);

/** Field names the records use (answer.scenes[].ratings → scenes, ratings), to find the code that writes them. */
export function recordFieldNames(records, { max = 24 } = {}) {
  const counts = new Map();
  describeRecordShape(records).split('\n').forEach((line) => {
    const path = line.split(/\s{2,}/)[0] || '';
    path.split('.').forEach((part) => {
      const word = part.replace(/\[\]$/, '');
      if (!/^[A-Za-z_$][\w$]*$/.test(word) || word.length < 3 || GENERIC_FIELD_NAMES.has(word) || word === '{key}') return;
      counts.set(word, (counts.get(word) || 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

/** The page's or task's code the model should read: how it draws media and how it records answers. */
export function analysisCodeExcerpt(html, records) {
  return pageCodeExcerpt(html, [...mediaListNames(records), ...recordFieldNames(records)], { patterns: RECORD_API_RE });
}

/** Names of the media lists the platform filled for this page, from the records. */
export function mediaListNames(records) {
  const names = new Set();
  (records || []).forEach((record) => Object.keys(record?.page_state && typeof record.page_state === 'object' ? record.page_state : {})
    .forEach((k) => { if (k.startsWith('sp-media:')) names.add(k.slice(9)); }));
  return [...names];
}

/** The page's other questions, so the model leaves their data alone. */
export function otherQuestionList(questions, current) {
  const text = (value) => (value && typeof value === 'object' ? Object.values(value)[0] : value);
  return (questions || [])
    .filter((q) => q?.name && q.name !== current?.name && q.name !== current?.pageName)
    .slice(0, 40)
    .map((q) => `- ${clean(q.pageName || q.name, 120)}${q.type ? ` (${clean(q.type, 40)})` : ''}: ${clean(text(q.title), 200)}`)
    .join('\n');
}

const MEDIA_RE = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?|mp4|webm|mov)(?:[?#].*)?$/i;

/**
 * Which images the records mention and where, so the model keys results by
 * image (participants usually see a random subset or order).
 */
export function mediaSummary(records) {
  const names = new Set();
  const where = new Map();
  const lists = new Set();
  const perRecord = [];
  // Names the platform gave the page, so ids like "IMG0395" are recognised too.
  const known = new Set();
  const stem = (name) => String(name).split(/[?#]/)[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  (records || []).forEach((record) => {
    const state = record?.page_state && typeof record.page_state === 'object' ? record.page_state : {};
    Object.keys(state).filter((k) => k.startsWith('sp-media:')).forEach((k) => {
      const list = jsonInString(state[k]) ?? state[k];
      (Array.isArray(list) ? list : []).forEach((m) => { if (m?.name) known.add(stem(m.name)); if (m?.url) known.add(stem(m.url)); });
    });
  });
  const keyedBy = new Map();
  const walk = (value, path, depth, seen) => {
    if (depth > 8 || value == null) return;
    if (/(^|\.)sp-media:/.test(path)) return;
    const inner = typeof value === 'string' ? jsonInString(value) : undefined;
    if (inner !== undefined) { walk(inner, path, depth + 1, seen); return; }
    if (typeof value === 'string') {
      if (MEDIA_RE.test(value) || (known.size && known.has(stem(value)) && value.length < 300)) {
        names.add(stem(value));
        seen.add(stem(value));
        const at = path.replace(/\[\d+\]/g, '[]');
        where.set(at, (where.get(at) || 0) + 1);
      }
      return;
    }
    if (Array.isArray(value)) value.slice(0, 2000).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1, seen));
    else if (typeof value === 'object') {
      const keys = Object.keys(value);
      const mediaKeys = keys.filter((k) => MEDIA_RE.test(k) || known.has(stem(k)));
      if (keys.length && mediaKeys.length / keys.length >= 0.8) {
        // Answers keyed by image: { IMG0395: 2, ... }
        mediaKeys.forEach((k) => { names.add(stem(k)); seen.add(stem(k)); });
        keyedBy.set(`${path}.{image}`, (keyedBy.get(`${path}.{image}`) || 0) + mediaKeys.length);
        keys.slice(0, 2000).forEach((k) => walk(value[k], `${path}.{image}`, depth + 1, seen));
        return;
      }
      keys.slice(0, 200).forEach((k) => {
        if (k.startsWith('sp-media:')) lists.add(k);
        walk(value[k], path ? `${path}.${k}` : k, depth + 1, seen);
      });
    }
  };
  (records || []).forEach((record) => {
    const seen = new Set();
    walk(record, '', 0, seen);
    perRecord.push(seen.size);
  });
  if (!names.size && !lists.size) return '';
  const lines = [`${names.size} distinct images appear in the records${names.size ? ` (e.g. ${[...names].slice(0, 5).join(', ')})` : ''}.`];
  const nonZero = perRecord.filter(Boolean);
  if (nonZero.length) lines.push(`Per submission: ${Math.min(...nonZero)}–${Math.max(...nonZero)} distinct files.${Math.max(...nonZero) < names.size ? ' Each participant saw only a subset.' : ''}`);
  if (keyedBy.size) lines.push(`Answers keyed by image (object keys are image names): ${[...keyedBy.keys()].slice(0, 8).join('; ')}. Use the key as the item.`);
  if (where.size) lines.push(`Image names as values at: ${[...where.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${p} (${n})`).join('; ')}`);
  if (lists.size) lines.push(`${[...lists].map((k) => `page_state["${k}"]`).join(', ')} (read with helpers.media(r)${lists.size > 1 ? ', or helpers.media(r, "NAME")' : ''}; ${listSizes(records, lists)}): the image list the platform gave the page (filled the page's own ${[...lists].map((k) => k.slice(9)).join(', ')} array) for that participant, in the order given, as [{name, url, folder}]. If the page records an image by index or position, it means a position in the page's (possibly shuffled) copy of that list: prefer a stored file name/URL; use an index only if nothing else identifies the image.`);
  return lines.join('\n');
}

/**
 * Generate the analysis. For answers the plan can read (custom questions and
 * tasks), the model writes a PLAN (what each field means); fields it leaves
 * out are sent back once; the platform runs the plan. Fields the plan marks
 * "custom" (and page-only records, which have no fields to plan) get model
 * code instead, with one automatic fix round when it fails.
 * `request(body)` posts to the worker; `runner(code, records)` is the sandbox.
 */
export async function generateQuestionAnalysis({ question, records: rawRecords, otherQuestions = [], pageHtml = '', instructions = '', request, runner }) {
  // The model only ever sees library image names where the page took them by position.
  const records = mapRecordsToMedia(rawRecords, pageHtml);
  const base = {
    pageCode: analysisCodeExcerpt(pageHtml, records),
    question: questionBrief(question),
    otherQuestions: otherQuestionList(otherQuestions, question),
    media: mediaSummary(records),
    sample: sampleRecords(records),
    fields: describeRecordShape(records),
    recordCount: records.length,
    instructions,
  };
  let plan = null;
  let planProblems = [];
  let planAttempts = 0;
  let provider = '';
  let model = '';
  if (hasPlannableAnswers(records)) {
    const inventory = fieldInventory(records);
    const planBase = { ...base, mode: 'plan', fields: inventoryText(inventory) };
    let reply = await request(planBase);
    provider = reply.provider; model = reply.model;
    let checked = checkPlan(reply.plan, inventory);
    planAttempts = 1;
    if (checked.missing.length || checked.unknown.length) {
      const error = [
        checked.missing.length ? `These fields have no entry: ${checked.missing.join(', ')}.` : '',
        checked.unknown.length ? `These paths do not exist in FIELDS (copy paths exactly): ${checked.unknown.join(', ')}.` : '',
      ].filter(Boolean).join(' ');
      reply = await request({ ...planBase, previous: JSON.stringify(checked.plan, null, 1), error });
      const again = checkPlan(reply.plan, inventory);
      // Keep whichever plan covers more.
      checked = again.missing.length <= checked.missing.length ? again : checked;
      planAttempts = 2;
    }
    plan = checked.plan;
    planProblems = [...checked.problems, ...(checked.missing.length ? [`Fields still not in the plan: ${checked.missing.join(', ')}`] : [])];
    // Fields the plan could not express get code; otherwise no code is needed.
    const customFields = plan.fields.filter((e) => e.use === 'custom');
    if (!customFields.length) {
      const evaluation = await evaluateAnalysis({ plan, code: '' }, records, runner, { pageHtml });
      return {
        ok: evaluation.ok, error: evaluation.ok ? '' : evaluation.error, attempts: planAttempts, code: '', plan,
        saved: makeSavedAnalysis({ code: '', plan, model, provider, instructions, questionTitle: question?.title }),
        blocks: evaluation.blocks, platformBlocks: evaluation.platformBlocks, modelBlocks: evaluation.modelBlocks, modelError: '', problems: [...planProblems, ...evaluation.problems],
      };
    }
    const run = runPlan(records, plan);
    base.platformDone = planSummaryForCode(plan, run);
  }
  let reply = await request(base);
  provider = reply.provider || provider; model = reply.model || model;
  let evaluation = await evaluateAnalysis({ plan, code: reply.code }, records, runner, { pageHtml });
  let attempts = planAttempts + 1;
  // One automatic fix when the model's code failed (even if the plan part already stands).
  if (evaluation.error) {
    reply = await request({ ...base, previous: reply.code, error: evaluation.error });
    evaluation = await evaluateAnalysis({ plan, code: reply.code }, records, runner, { pageHtml });
    attempts += 1;
  }
  // Code that still fails is not kept: the plan's part stands on its own.
  const code = evaluation.error ? '' : reply.code;
  return {
    ok: evaluation.ok,
    error: evaluation.ok ? '' : evaluation.error,
    attempts,
    code: reply.code,
    plan,
    saved: makeSavedAnalysis({ code, plan, model, provider, instructions, questionTitle: question?.title }),
    blocks: evaluation.blocks,
    platformBlocks: evaluation.platformBlocks,
    modelBlocks: evaluation.modelBlocks,
    modelError: evaluation.error,
    problems: [...planProblems, ...evaluation.problems],
  };
}
