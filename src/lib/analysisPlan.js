/**
 * Analysis plan for a custom question: the model says what each stored field
 * means, the platform does the analysis.
 *
 * A custom question (an SP-Scheme page's own task, an advanced custom task)
 * stores whatever object the page sends, often several answer types in one
 * record: two ratings, two reason lists and an A/B choice per round. Reading
 * what such a field means needs the question text, so the Assistant model
 * writes a PLAN: one entry per field with its meaning in the survey's own
 * words, the image it belongs to and how to analyse it (score, pick between
 * images, option, tags, group, duration, text, skip, or custom code). The plan
 * must cover every field; what is missing is sent back once. The platform
 * then runs the plan with its own algorithms, so the result is the same every
 * time and the researcher can read the plan to check the understanding.
 */

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const fileName = (v) => String(v ?? '').split(/[?#]/)[0].split('/').pop();
const MAX_INVENTORY = 120;

export const PLAN_USES = ['image', 'score', 'pick', 'option', 'tags', 'group', 'duration', 'time', 'text', 'skip', 'custom'];
export const PLAN_VERSION = 2;

/**
 * One row per stored entry: each trial of a { trials: [...] } answer or the
 * single answer object. Submitted rows wrap each answer as { type, answer,
 * shown_images, ... } and each trial as { trial_index, answer, ... }; both
 * are unwrapped here so the plan only ever sees the page's own object.
 */
export function answerRows(records) {
  const rows = [];
  (records || []).forEach((record, recordIndex) => {
    const participant = String(record?.participant_id || `row_${recordIndex + 1}`);
    let answer = record?.answer;
    const wrapped = isPlainObject(answer) && 'answer' in answer && 'type' in answer && ('shown_images' in answer || 'shown_media' in answer) && !Array.isArray(answer.trials);
    const wrapperShown = wrapped ? ((answer.shown_media_ids?.length ? answer.shown_media_ids : answer.shown_images) || []) : null;
    if (wrapped) answer = answer.answer;
    const trialValue = (t) => (isPlainObject(t?.value) ? t.value : isPlainObject(t?.answer) && ('trial_index' in t || 'shown_images' in t || 'key' in t) ? t.answer : t?.value);
    const trialShown = (t) => (t?.shown_media_ids?.length ? t.shown_media_ids : t?.shown_images) || [];
    let entries = [];
    if (isPlainObject(answer) && Array.isArray(answer.trials)) {
      entries = answer.trials.map((t) => ({ value: trialValue(t), shown: trialShown(t) }));
    } else if (Array.isArray(answer) && answer.every((a) => isPlainObject(a))) {
      entries = answer.map((t) => (isPlainObject(t.answer) && ('trial_index' in t || 'shown_images' in t) ? { value: t.answer, shown: trialShown(t) } : { value: t, shown: [] }));
    } else if (isPlainObject(answer)) {
      entries = [{ value: answer, shown: wrapperShown?.length ? wrapperShown : Array.isArray(record?.shown) ? record.shown : [] }];
    }
    entries.forEach((entry, trial) => {
      if (!isPlainObject(entry.value)) return;
      rows.push({ participant, trial, value: entry.value, shown: (entry.shown || []).map(fileName).filter(Boolean), context: isPlainObject(record?.context) ? record.context : {} });
    });
  });
  return rows;
}

function jsonInString(value) {
  if (typeof value !== 'string' || value.length < 2 || !/^\s*[[{]/.test(value)) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Every field path in the stored objects with its types, how many rows have
 * it and examples: `result.ratings[].value  number  (322/322)  e.g. 2, 5`.
 * Arrays of objects are entered ("[]"); JSON saved as text is parsed.
 * Context fields (short answers to the other questions of the submission)
 * are listed as `@grade`.
 */
export function fieldInventory(records) {
  const rows = answerRows(records);
  const paths = new Map();
  const note = (path, value, seen) => {
    if (!paths.has(path)) paths.set(path, { path, types: new Set(), rows: 0, examples: [] });
    const entry = paths.get(path);
    if (!seen.has(path)) { seen.add(path); entry.rows += 1; }
    entry.types.add(typeName(value));
    if (value !== null && typeof value !== 'object' && entry.examples.length < 4 && !entry.examples.includes(value)) entry.examples.push(value);
    if (Array.isArray(value) && value.length && value.every((x) => typeof x !== 'object')) {
      entry.listOf = entry.listOf || new Set();
      value.slice(0, 20).forEach((x) => entry.listOf.size < 6 && entry.listOf.add(x));
    }
  };
  const visit = (value, path, depth, seen) => {
    if (depth > 6) return;
    const inner = typeof value === 'string' ? jsonInString(value) : undefined;
    if (inner !== undefined) { note(path, value, seen); visit(inner, `${path}{json}`, depth + 1, seen); return; }
    note(path, value, seen);
    if (Array.isArray(value) && value.some(isPlainObject)) {
      value.slice(0, 200).forEach((el) => { if (isPlainObject(el)) Object.entries(el).forEach(([k, v]) => visit(v, `${path}[].${k}`, depth + 1, seen)); });
    } else if (isPlainObject(value) && Object.keys(value).length <= 40) {
      Object.entries(value).forEach(([k, v]) => visit(v, path ? `${path}.${k}` : k, depth + 1, seen));
    }
  };
  rows.forEach((row) => {
    const seen = new Set();
    Object.entries(row.value).forEach(([k, v]) => visit(v, k, 0, seen));
    Object.entries(row.context).forEach(([k, v]) => visit(v, `@${k}`, 0, seen));
  });
  const list = [...paths.values()].filter((p) => !p.types.has('object') || p.types.size > 1 || true);
  // Parents of entered structures are kept so the model can mark them as containers.
  return { rows: rows.length, participants: new Set(rows.map((r) => r.participant)).size, fields: list.slice(0, MAX_INVENTORY).map((p) => ({ path: p.path, types: [...p.types], rows: p.rows, examples: p.examples, listOf: p.listOf ? [...p.listOf] : undefined })) };
}

/** The inventory as text for the model. Container paths (objects, arrays of objects) are marked. */
export function inventoryText(inventory) {
  return inventory.fields.map((f) => {
    const container = f.types.includes('object') || (f.types.includes('array') && !f.listOf && f.types.length === 1);
    const example = f.listOf ? `list of e.g. ${f.listOf.map((x) => JSON.stringify(x)).join(', ')}` : f.examples.length ? `e.g. ${f.examples.map((x) => JSON.stringify(x)).join(', ')}` : '';
    return `${f.path}  ${f.types.join('|')}  (${f.rows}/${inventory.rows})  ${container ? '[container: its own fields are listed below it]' : example}`;
  }).join('\n');
}

/** Paths that need an entry in the plan: leaves only (containers are covered by their children). */
export function requiredPaths(inventory) {
  const all = inventory.fields.map((f) => f.path);
  return all.filter((p) => !all.some((q) => q !== p && (q.startsWith(`${p}.`) || q.startsWith(`${p}[]`) || q.startsWith(`${p}{json}`))));
}

/**
 * Check a plan against the inventory: { plan, missing, unknown, problems }.
 * Entries are normalised (use lower-case, paths trimmed); unknown uses become
 * "skip" with a problem noted.
 */
export function checkPlan(raw, inventory) {
  const problems = [];
  const plan = { summary: String(raw?.summary || '').slice(0, 300), fields: [] };
  const list = Array.isArray(raw?.fields) ? raw.fields : Array.isArray(raw) ? raw : [];
  const known = new Set(inventory.fields.map((f) => f.path));
  const jsonParents = new Set(inventory.fields.map((f) => f.path).filter((p) => inventory.fields.some((f) => f.path.startsWith(`${p}{json}`))));
  const seen = new Set();
  list.forEach((entry, i) => {
    if (!isPlainObject(entry) || typeof entry.path !== 'string') { problems.push(`fields[${i}] has no path.`); return; }
    const path = entry.path.trim();
    if (seen.has(path)) return;
    seen.add(path);
    let use = String(entry.use || entry.role || '').toLowerCase().trim();
    if (use === 'attribute' || use === 'person' || use === 'condition') use = 'group';
    if (!PLAN_USES.includes(use)) { problems.push(`${path}: use "${entry.use}" is not one of ${PLAN_USES.join(', ')}; treated as skip.`); use = 'skip'; }
    const e = { path, use, meaning: String(entry.meaning || entry.label || '').slice(0, 200).trim() };
    if (!known.has(path)) e.unknown = true;
    // A string that holds JSON is a container: its inner fields are listed on their own.
    if (use !== 'skip' && use !== 'custom' && jsonParents.has(path)) { e.use = 'skip'; e.why = 'JSON 字符串，里面的字段已单独列出'; }
    if (use === 'group' && (entry.compare === true || entry.split === true)) e.compare = true;
    if (typeof entry.image === 'string' && entry.image.trim()) e.image = entry.image.trim();
    if (Array.isArray(entry.images)) e.images = entry.images.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    if (typeof entry.item === 'string' && entry.item.trim()) e.item = entry.item.trim();
    if (typeof entry.measure === 'string' && entry.measure.trim()) e.measure = entry.measure.trim().slice(0, 80);
    if (typeof entry.unit === 'string') e.unit = /ms|milli/i.test(entry.unit) ? 'ms' : 's';
    if (typeof entry.why === 'string' && !e.why) e.why = entry.why.slice(0, 200);
    if (isPlainObject(entry.scale)) { e.scale = {}; Object.entries(entry.scale).slice(0, 30).forEach(([k, v]) => { e.scale[String(k)] = String(v).slice(0, 80); }); }
    if (isPlainObject(entry.options)) {
      e.options = {};
      Object.entries(entry.options).slice(0, 40).forEach(([k, v]) => {
        if (isPlainObject(v)) e.options[String(k)] = { label: String(v.label ?? k).slice(0, 80), picks: typeof v.picks === 'string' && v.picks.trim() ? v.picks.trim() : null };
        else e.options[String(k)] = { label: String(v ?? k).slice(0, 80), picks: null };
      });
    }
    if (use === 'pick' && !(e.images?.length >= 2)) { problems.push(`${path}: a pick needs images: [the fields that hold the images chosen between].`); e.use = 'option'; }
    if (use === 'pick' && e.images?.length >= 2 && !e.options) problems.push(`${path}: a pick should give options: { value: { label, picks: <image field or null> } }; values are matched to the image fields by name instead.`);
    plan.fields.push(e);
  });
  const required = requiredPaths(inventory);
  const covered = (p) => seen.has(p) || [...seen].some((s) => p.startsWith(`${s}.`) || p.startsWith(`${s}[]`) || p.startsWith(`${s}{json}`));
  const missing = required.filter((p) => !covered(p));
  const unknown = plan.fields.filter((e) => e.unknown).map((e) => e.path);
  return { plan, missing, unknown, problems };
}

// ── Reading values along a plan path ──

/** All values at `path` in one row, each with the array elements it was read through (for sibling look-ups). */
function readPath(root, path) {
  const out = [];
  // `elements`: the array elements entered at each "[]" on the way, so a sibling field of the same element can be read.
  const walk = (value, parts, elements) => {
    if (!parts.length) { out.push({ value, elements }); return; }
    const [head, ...rest] = parts;
    if (head === '[]') {
      if (!Array.isArray(value)) return;
      value.forEach((el) => walk(el, rest, [...elements, el]));
      return;
    }
    if (head === '{json}') { const inner = jsonInString(value); if (inner !== undefined) walk(inner, rest, elements); return; }
    if (!isPlainObject(value)) return;
    walk(value[head], rest, elements);
  };
  const parts = String(path).replace(/\[\]/g, '.[].').replace(/\{json\}/g, '.{json}.').split('.').filter(Boolean);
  walk(root, parts, []);
  return out;
}

/** The value of a sibling path (image, item) for one observation of `basePath`: read inside the same array element when both sit in one list. */
function siblingValue(row, basePath, siblingPath, elements) {
  if (!siblingPath) return undefined;
  const sibArr = siblingPath.lastIndexOf('[]');
  if (sibArr >= 0 && basePath.startsWith(siblingPath.slice(0, sibArr + 2))) {
    const depth = (siblingPath.slice(0, sibArr + 2).match(/\[\]/g) || []).length;
    const element = elements?.[depth - 1];
    const rest = siblingPath.slice(sibArr + 2).replace(/^\./, '');
    const hits = element === undefined ? [] : readPath(element, rest);
    return hits.length ? hits[0].value : undefined;
  }
  const hits = readPath(row.value, siblingPath);
  return hits.length ? hits[0].value : undefined;
}

function rowFieldValue(row, path) {
  if (path.startsWith('@')) return row.context[path.slice(1)];
  const hits = readPath(row.value, path);
  return hits.length === 1 ? hits[0].value : hits.length ? hits.map((h) => h.value) : undefined;
}

// ── Running the plan ──

const fmt = (n, d = 2) => (n == null || !Number.isFinite(n) ? '' : Math.round(n * 10 ** d) / 10 ** d);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const present = (v) => v !== null && v !== undefined && v !== '';

/** Which image field a pick value chooses: by the plan's options, else by the image's file name or the slot letter in the value. */
function pickedImageField(value, entry, row) {
  const v = String(value);
  const opt = entry.options?.[v];
  if (opt) return opt.picks && entry.images.includes(opt.picks) ? opt.picks : null;
  const direct = entry.images.find((f) => { const img = rowFieldValue(row, f); return img && fileName(img) === fileName(v); });
  if (direct) return direct;
  const tokens = v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits = entry.images.filter((f) => { const m = f.match(/([A-Za-z0-9]+)$/); const slot = m ? m[1].toLowerCase() : ''; return slot && tokens.includes(slot) && slot !== f.toLowerCase(); });
  return hits.length === 1 ? hits[0] : null;
}

const optionLabel = (entry, v) => entry.options?.[String(v)]?.label || entry.scale?.[String(v)] || String(v);
const title = (entry) => entry.meaning || entry.path;

/**
 * Run a checked plan on the records: { blocks, coverage, rows, participants }.
 * Blocks are the same shapes the model-code path returns (pairwise, per_item,
 * choice, rating, table, bar, text); computeAnalysisBlocks runs the statistics.
 */
export function runPlan(records, plan, { imageItemTable = false } = {}) {
  const rows = answerRows(records);
  const fields = (plan?.fields || []).filter((e) => !e.unknown);
  const participants = new Set(rows.map((r) => r.participant)).size;
  const blocks = [];
  const coverage = [];
  const covered = new Set();
  const done = (e, what) => { covered.add(e.path); coverage.push({ field: e.path, meaning: title(e), status: 'analysed', what }); };
  const skip = (e, why) => { covered.add(e.path); coverage.push({ field: e.path, meaning: e.meaning || '', status: 'skipped', what: why }); };
  if (!rows.length) return { blocks, coverage, rows: 0, participants: 0 };
  const byUse = (use) => fields.filter((e) => e.use === use);
  const imageOf = (row, entry, elements) => { const v = siblingValue(row, entry.path, entry.image, elements); return v ? fileName(v) : (row.shown.length === 1 ? row.shown[0] : ''); };

  // Scores: per image (and per item) or a plain distribution. Scores sharing a measure are one block.
  const scores = byUse('score');
  const scoreObs = new Map(); // entry.path -> [{ row, value, image, item }]
  scores.forEach((e) => {
    const obs = [];
    rows.forEach((row) => readPath(row.value, e.path).forEach(({ value, elements }) => {
      const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
      if (!Number.isFinite(n)) return;
      obs.push({ row, value: n, image: e.image || row.shown.length === 1 ? imageOf(row, e, elements) : '', item: e.item ? String(siblingValue(row, e.path, e.item, elements) ?? '') : '' });
    }));
    scoreObs.set(e.path, obs);
  });
  const pathTail = (path) => path.split(/[.\]]/).filter(Boolean).pop() || path;
  const scaleNote = (entries) => {
    const scale = entries.find((e) => e.scale)?.scale;
    return scale ? `分值含义：${Object.entries(scale).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}=${v}`).join('，')}。` : '';
  };
  const measures = new Map();
  scores.forEach((e) => { const key = e.measure || e.path; if (!measures.has(key)) measures.set(key, []); measures.get(key).push(e); });
  // Several score fields of one measure about the same image field (scenes[].ratings.A1, .M1, …): each field is one item.
  measures.forEach((entries) => {
    const byImage = new Map();
    entries.forEach((e) => { if (e.image && !e.item) { if (!byImage.has(e.image)) byImage.set(e.image, []); byImage.get(e.image).push(e); } });
    byImage.forEach((list) => {
      if (list.length < 2) return;
      list.forEach((e) => { (scoreObs.get(e.path) || []).forEach((o) => { o.item = pathTail(e.path); }); e.itemFromPath = true; });
    });
  });
  // A measure that mixes per-item scores with scores that name no item is two things: keep them apart (the second is often the same scores stored flat).
  [...measures.entries()].forEach(([key, entries]) => {
    const withItem = entries.filter((e) => e.item || e.itemFromPath);
    if (!withItem.length || withItem.length === entries.length) return;
    measures.set(key, withItem);
    measures.set(`${key}（未标条目）`, entries.filter((e) => !e.item && !e.itemFromPath));
  });
  const seenMeasures = new Map(); // signature of the observations -> measure key, to spot the same scores stored twice
  measures.forEach((entries, key) => {
    const obs = entries.flatMap((e) => scoreObs.get(e.path) || []);
    if (!obs.length) { entries.forEach((e) => skip(e, '没有数值')); return; }
    const signature = obs.map((o) => `${o.row.participant}|${o.row.trial}|${o.image}|${o.value}`).sort().join('\n');
    if (seenMeasures.has(signature)) { entries.forEach((e) => skip(e, `和「${seenMeasures.get(signature)}」是同一批分数的另一份存法，只算一次`)); return; }
    seenMeasures.set(signature, entries.length > 1 ? key : title(entries[0]));
    const heading = entries.length > 1 ? key : title(entries[0]);
    const itemLegend = entries[0].itemFromPath ? `条目：${entries.map((e) => `${pathTail(e.path)}=${e.meaning || e.path}`).join('；')}。` : '';
    const withImage = obs.filter((o) => o.image);
    const withItem = withImage.filter((o) => o.item);
    if (withItem.length >= withImage.length * 0.8 && withItem.length) {
      // image × item table (each participant counts once per image and item)
      const cells = new Map();
      const raters = new Map();
      const items = [];
      withItem.forEach((o) => {
        if (!items.includes(o.item)) items.push(o.item);
        const key2 = `${o.image}\u0000${o.item}\u0000${o.row.participant}`;
        if (cells.has(key2)) return;
        cells.set(key2, o);
        if (!raters.has(o.image)) raters.set(o.image, new Set());
        raters.get(o.image).add(o.row.participant);
      });
      const images = [...raters.keys()].sort();
      const byCell = new Map();
      cells.forEach((o) => { const k = `${o.image}\u0000${o.item}`; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(o.value); });
      blocks.push({
        type: 'table', platform: true,
        title: `${heading}：每张图在每个条目上的平均分`,
        note: `${images.length} 张图 × ${items.length} 个条目；每位参与者对每张图的每个条目计一次，n = 评分人数。${itemLegend}${scaleNote(entries)}`,
        columns: ['image', ...items, 'n'],
        rows: images.map((img) => [img, ...items.map((it) => fmt(mean(byCell.get(`${img}\u0000${it}`) || []))), raters.get(img).size]),
      });
      entries.forEach((e) => done(e, `按图和条目汇总平均分（${images.length} 张图 × ${items.length} 条目）`));
      return;
    }
    if (withImage.length >= obs.length * 0.8) {
      blocks.push({ type: 'per_item', platform: true, title: `${heading}：每张图的分数`, note: `${entries.map((e) => `${e.path}→${e.image || '显示的图'}`).join('，')}。${scaleNote(entries)}`, values: withImage.map((o) => ({ item: o.image, value: o.value, rater: o.row.participant })), measure: 'number', labels: {} });
      entries.forEach((e) => done(e, `每张图的分数：均值、SD（${e.image ? `对应 ${e.image}` : '对应显示的那张图'}）`));
      return;
    }
    blocks.push({ type: 'rating', platform: true, title: `${heading}：数值分布`, note: scaleNote(entries), values: obs.map((o) => o.value), items: [], min: null, max: null });
    entries.forEach((e) => done(e, '数值：均值、SD、中位数、95% CI'));
  });

  // Picks between images: TrueSkill ranking, option counts, agreement with the scores of the same images.
  byUse('pick').forEach((e) => {
    const matches = [];
    const counts = [];
    const codes = [];
    let ties = 0;
    const tieValues = new Set();
    const sideWins = new Map(e.images.map((f) => [f, 0]));
    const tally = { higher: 0, equal: 0, lower: 0 };
    let compared = 0;
    const scoreFor = (row, imageField) => {
      const s = scores.find((sc) => sc.image === imageField);
      if (!s) return undefined;
      const v = rowFieldValue(row, s.path);
      return typeof v === 'number' ? v : undefined;
    };
    rows.forEach((row) => {
      const v = rowFieldValue(row, e.path);
      if (!present(v) || typeof v === 'object') return;
      counts.push(optionLabel(e, v));
      codes.push(String(v));
      const winnerField = pickedImageField(v, e, row);
      if (!winnerField) { ties += 1; tieValues.add(optionLabel(e, v)); return; }
      sideWins.set(winnerField, (sideWins.get(winnerField) || 0) + 1);
      const winner = fileName(rowFieldValue(row, winnerField));
      e.images.filter((f) => f !== winnerField).forEach((other) => {
        const loser = fileName(rowFieldValue(row, other));
        if (winner && loser && winner !== loser) matches.push({ winner, loser });
      });
      const w = scoreFor(row, winnerField);
      const others = e.images.filter((f) => f !== winnerField).map((f) => scoreFor(row, f)).filter((x) => typeof x === 'number');
      if (typeof w === 'number' && others.length) { compared += 1; const best = Math.max(...others); tally[w > best ? 'higher' : w === best ? 'equal' : 'lower'] += 1; }
    });
    if (!counts.length) { skip(e, '没有作答'); return; }
    if (matches.length) {
      const items = new Set(matches.flatMap((m) => [m.winner, m.loser]));
      const perItem = items.size ? (matches.length * 2) / items.size : 0;
      blocks.push({
        type: 'pairwise', platform: true, title: `${title(e)}：图片排名（TrueSkill）`, matches,
        note: [
          `${matches.length} 次有明确选择。`,
          ties ? `另有 ${ties} 次选了“${[...tieValues].join('”或“')}”，不计入排名。` : '',
          `按位置：${[...sideWins.entries()].map(([f, n]) => `${f} ${n}`).join(' / ')}。`,
          perItem < 5 ? `每张图平均只比较了 ${fmt(perItem, 1)} 次，排名还不稳定；人多了会分开。` : '',
        ].filter(Boolean).join(' '),
      });
    }
    blocks.push({ type: 'choice', platform: true, title: `${title(e)}：各选项次数`, note: '', values: counts, codes, total: counts.length, multi: false });
    if (compared) {
      blocks.push({
        type: 'table', platform: true, title: `${title(e)}：选择和打分是否一致`,
        note: '“选中的图分数更高”是一致；“更低”说明选择和打分矛盾，可以检查这些作答。',
        columns: ['情况', '次数', '比例'],
        rows: [['选中的图分数更高（一致）', tally.higher, fmt(tally.higher / compared * 100, 1)], ['两张图分数一样', tally.equal, fmt(tally.equal / compared * 100, 1)], ['选中的图分数更低（矛盾）', tally.lower, fmt(tally.lower / compared * 100, 1)]],
      });
    }
    done(e, `在 ${e.images.join('、')} 之间的选择：TrueSkill 排名 + 各选项比例${compared ? ' + 和打分是否一致' : ''}${ties ? `（${ties} 次平局不进排名）` : ''}`);
  });

  // Single options.
  byUse('option').forEach((e) => {
    const raw = rows.map((r) => rowFieldValue(r, e.path)).filter((v) => present(v) && typeof v !== 'object');
    if (!raw.length) { skip(e, '没有作答'); return; }
    blocks.push({ type: 'choice', platform: true, title: `${title(e)}：各选项次数`, note: '', values: raw.map((v) => optionLabel(e, v)), codes: raw.map(String), total: raw.length, multi: false });
    done(e, '选项：次数和比例（Wilson 95% CI）');
  });

  // Tags (multi-select): counts, and the mean score of the same image when the tag was picked.
  const tagGroups = new Map();
  byUse('tags').forEach((e) => { const key = e.measure || e.path; if (!tagGroups.has(key)) tagGroups.set(key, []); tagGroups.get(key).push(e); });
  tagGroups.forEach((entries, key) => {
    const values = [];
    const codes = [];
    const scoreByTag = new Map();
    let answers = 0;
    rows.forEach((row) => entries.forEach((e) => {
      const tags = rowFieldValue(row, e.path);
      if (!Array.isArray(tags) || !tags.length) return;
      answers += 1;
      const s = e.image ? scores.find((sc) => sc.image === e.image) : null;
      const score = s ? rowFieldValue(row, s.path) : undefined;
      tags.forEach((t) => {
        if (typeof t === 'object') return;
        const tag = optionLabel(e, t);
        values.push(tag);
        codes.push(String(t));
        if (typeof score === 'number') { if (!scoreByTag.has(tag)) scoreByTag.set(tag, []); scoreByTag.get(tag).push(score); }
      });
    }));
    if (!values.length) { entries.forEach((e) => skip(e, '没有作答')); return; }
    const heading = entries.length > 1 ? key : title(entries[0]);
    blocks.push({ type: 'choice', platform: true, title: `${heading}：标签被选的次数`, note: `多选：比例 = 选了这个标签的作答 / 全部 ${answers} 次作答。`, values, codes, total: answers, multi: true });
    if (scoreByTag.size) {
      blocks.push({
        type: 'table', platform: true, title: `${heading}：选了这个标签时，那张图的平均分`,
        note: '把每个标签和它所描述那张图的分数放在一起，看哪些理由对应高分、哪些对应低分。',
        columns: ['标签', '次数', '平均分', '最低', '最高'],
        rows: [...scoreByTag.entries()].map(([tag, s]) => [tag, s.length, fmt(mean(s)), Math.min(...s), Math.max(...s)]).sort((a, b) => b[2] - a[2]),
      });
    }
    entries.forEach((e) => done(e, e.image ? `多选标签：次数 + 对应 ${e.image} 的平均分` : '多选标签：次数和比例'));
  });

  // Durations.
  const timeFields = byUse('time');
  byUse('duration').forEach((e) => {
    const unit = e.unit || (/ms$|Ms$|milli/i.test(e.path) ? 'ms' : 's');
    const raw = rows.map((r) => ({ r, v: rowFieldValue(r, e.path) })).filter((o) => typeof o.v === 'number' && o.v >= 0);
    if (!raw.length) { skip(e, '没有数值'); return; }
    const seconds = raw.map((o) => (unit === 'ms' ? o.v / 1000 : o.v));
    const fast = seconds.filter((s) => s < 2).length;
    const people = [...new Set(rows.map((r) => r.participant))];
    const sameStart = rows.length > people.length && timeFields.some((t) => /start|begin|open/i.test(t.path) && people.every((p) => new Set(rows.filter((r) => r.participant === p).map((r) => rowFieldValue(r, t.path))).size === 1));
    const growing = rows.length > people.length && people.every((p) => { const list = raw.filter((o) => o.r.participant === p).map((o) => o.v); return list.length >= 2 && list.every((v, i) => i === 0 || v > list[i - 1]); });
    const cumulative = sameStart && growing;
    const name = /秒|second|\bs\)|（s）/i.test(title(e)) ? title(e) : `${title(e)}（秒）`;
    blocks.push({ type: 'rating', platform: true, title: name, items: [], min: null, max: null, values: seconds.map((s) => fmt(s, 2)), note: `${cumulative ? '注意：每个人所有轮次的开始时间都一样、用时逐轮变长，看起来是从打开页面起的累计时间，不是每轮各自的用时；要每轮用时，页面需要在每轮开始时重新记开始时间。' : ''}${unit === 'ms' ? '原始单位毫秒，已换算成秒。' : ''}${fast ? `${fast} 次少于 2 秒，可能没认真看。` : ''}` });
    done(e, cumulative ? '用时分布（看起来是累计时间，见说明）' : '用时：均值、中位数、分布，标出过快作答');
  });

  // Free text.
  byUse('text').forEach((e) => {
    const values = rows.map((r) => rowFieldValue(r, e.path)).filter((v) => typeof v === 'string' && v.trim());
    if (!values.length) { skip(e, '没有文字'); return; }
    // A plan saved before the container rule: a JSON string is not free text.
    if (values.every((v) => jsonInString(v) !== undefined)) { skip(e, 'JSON 字符串，里面的字段已单独列出'); return; }
    blocks.push({ type: 'text', platform: true, title: `${title(e)}：文字回答`, note: '', values });
    done(e, '文字：词频和长度');
  });

  // Participant attributes: one background table (who took part), each attribute once.
  const groups = byUse('group');
  const picks = byUse('pick');
  const people = [...new Set(rows.map((r) => r.participant))];
  const personValue = (g) => {
    const map = new Map();
    rows.forEach((r) => { if (map.has(r.participant)) return; const v = rowFieldValue(r, g.path); if (present(v) && typeof v !== 'object') map.set(r.participant, v); });
    return map;
  };
  const backgroundRows = [];
  const seenAttributes = new Map(); // same values for everyone -> stored twice
  groups.filter((g) => !g.compare).forEach((g) => {
    const values = personValue(g);
    if (!values.size) { skip(g, '没有值'); return; }
    const signature = people.map((p) => `${p}=${values.has(p) ? String(values.get(p)) : ''}`).join('\n');
    if (seenAttributes.has(signature)) { skip(g, `和「${seenAttributes.get(signature)}」重复（同一信息存了两份），只列一次`); return; }
    seenAttributes.set(signature, title(g));
    const list = [...values.values()];
    const numeric = list.every((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))));
    const distinct = new Set(list.map(String)).size;
    let text;
    if (numeric && distinct > 7) {
      const nums = list.map(Number);
      const sorted = [...nums].sort((a, b) => a - b);
      const m = mean(nums);
      const sd = nums.length > 1 ? Math.sqrt(nums.reduce((a, v) => a + (v - m) ** 2, 0) / (nums.length - 1)) : 0;
      const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      text = `均值 ${fmt(m)}，SD ${fmt(sd)}，中位数 ${fmt(median)}，范围 ${sorted[0]}–${sorted[sorted.length - 1]}`;
    } else {
      const counts = new Map();
      list.forEach((v) => { const k = optionLabel(g, v); counts.set(k, (counts.get(k) || 0) + 1); });
      // Numbers (a 1–7 scale) in order of value; words by frequency.
      const sorted = [...counts.entries()].sort((a, b) => (numeric ? Number(a[0]) - Number(b[0]) : b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
      text = sorted.slice(0, 8).map(([k, n]) => `${k} ${n}（${fmt(n / list.length * 100, 0)}%）`).join('，') + (sorted.length > 8 ? `，其余 ${sorted.length - 8} 种` : '');
    }
    backgroundRows.push([title(g), values.size, text]);
    done(g, numeric && distinct > 7 ? '背景：均值、SD、中位数、范围' : '背景：各取值人数');
  });
  if (backgroundRows.length) {
    blocks.push({ type: 'table', platform: true, title: '参与者背景', note: `${people.length} 人。每项按人统计一次。要按某项比较结果，在说明里写“按 X 比较”再生成。`, columns: ['背景', '人数', '分布'], rows: backgroundRows });
  }

  // Group comparisons: only the attributes the researcher asked to compare by.
  groups.filter((g) => g.compare).forEach((g) => {
    const levelOf = (r) => { const v = rowFieldValue(r, g.path); return present(v) && typeof v !== 'object' ? optionLabel(g, v) : null; };
    const levels = [...new Set(rows.map(levelOf).filter(Boolean))].sort();
    if (levels.length < 2) { skip(g, levels.length === 1 ? `所有人都是“${levels[0]}”，没法分组比较；人多了有不同取值会自动分组` : '没有值'); return; }
    if (levels.length > 8) { skip(g, `取值有 ${levels.length} 种，太多了没法逐组比较；在说明里给出分段（如 18–30、31–45）再生成`); return; }
    if (!scores.length && !picks.length) {
      blocks.push({ type: 'choice', platform: true, title: `${title(g)}：各组人数`, note: '', values: rows.map(levelOf).filter(Boolean), total: rows.length, multi: false });
      done(g, '各组人数（这道题没有分数或选择可按组比较）');
      return;
    }
    const columns = ['组', '人数', '作答次数'];
    const scoreKeys = [...measures.keys()];
    scoreKeys.forEach((k) => columns.push(`${k} 平均`));
    const pickValues = picks.length ? [...new Set(rows.map((r) => rowFieldValue(r, picks[0].path)).filter((v) => present(v) && typeof v !== 'object').map((v) => optionLabel(picks[0], v)))] : [];
    pickValues.forEach((v) => columns.push(`${v} %`));
    const bars = [];
    const tableRows = levels.map((level) => {
      const inGroup = rows.filter((r) => levelOf(r) === level);
      const people = new Set(inGroup.map((r) => r.participant)).size;
      const row = [level, people, inGroup.length];
      scoreKeys.forEach((k) => {
        const obs = measures.get(k).flatMap((e) => (scoreObs.get(e.path) || []).filter((o) => inGroup.includes(o.row)));
        const m = mean(obs.map((o) => o.value));
        row.push(fmt(m));
        if (k === scoreKeys[0] && m != null) bars.push({ label: level, value: fmt(m) });
      });
      if (picks.length) {
        const answered = inGroup.map((r) => rowFieldValue(r, picks[0].path)).filter((v) => present(v) && typeof v !== 'object').map((v) => optionLabel(picks[0], v));
        pickValues.forEach((v) => row.push(answered.length ? fmt(answered.filter((x) => x === v).length / answered.length * 100, 1) : ''));
      }
      return row;
    });
    if (bars.length) blocks.push({ type: 'bar', platform: true, title: `按${title(g)}分组：${scoreKeys[0]} 平均分`, note: '每组人数少时差异不可靠。', items: bars, unit: '' });
    blocks.push({ type: 'table', platform: true, title: `按${title(g)}分组`, note: `${g.path.startsWith('@') ? `${title(g)} 来自同一份答卷里的另一道题。` : ''}每组人数少时差异不可靠。`, columns, rows: tableRows });
    done(g, `分组：${levels.length} 组，各组的平均分${picks.length ? '和选择比例' : ''}`);
  });

  // Everything else.
  fields.forEach((e) => {
    if (covered.has(e.path)) return;
    if (e.use === 'image') skip(e, e.meaning ? `${e.meaning}：图片名，用来把分数、选择和标签对应到图上` : '图片名，用来把分数、选择和标签对应到图上');
    else if (e.use === 'time') skip(e, e.why || '时间戳：不是作答内容');
    else if (e.use === 'custom') coverage.push({ field: e.path, meaning: title(e), status: 'custom', what: e.why || '平台菜单覆盖不了，由模型写的代码补充' });
    else if (e.use === 'skip') skip(e, e.why || (imageItemTable ? '不是作答内容' : '不是作答内容'));
    else skip(e, '没有可用的值');
  });
  const order = new Map(fields.map((e, i) => [e.path, i]));
  coverage.sort((a, b) => (order.get(a.field) ?? 999) - (order.get(b.field) ?? 999));
  return { blocks, coverage, rows: rows.length, participants };
}

/** The plan as a block shown first and exported as a CSV. */
export function planBlock(plan, run) {
  if (!run?.coverage?.length) return null;
  const analysed = run.coverage.filter((c) => c.status === 'analysed');
  const custom = run.coverage.filter((c) => c.status === 'custom');
  const skipped = run.coverage.filter((c) => c.status === 'skipped');
  return {
    type: 'coverage', platform: true,
    title: '分析方案',
    summary: plan?.summary || '',
    note: `${run.participants} 人 · ${run.rows} 条作答。模型读题后写出每个字段的含义和分析方式；数字由平台按方案算出，每次一样。已分析 ${analysed.length} 个字段${custom.length ? `，${custom.length} 个由模型代码补充` : ''}，跳过 ${skipped.length} 个。`,
    analysed: [...analysed, ...custom],
    skipped,
    columns: ['field', 'meaning', 'status', 'analysis'],
    rows: run.coverage.map((c) => [c.field, c.meaning, c.status === 'analysed' ? '已分析' : c.status === 'custom' ? '模型代码' : '跳过', c.what]),
  };
}

/** Text for the model's code step: which fields the platform already covers, which it must write code for. */
export function planSummaryForCode(plan, run) {
  const lines = (run?.blocks || []).map((b) => `- ${b.type}: ${b.title}`);
  const customFields = (plan?.fields || []).filter((e) => e.use === 'custom');
  lines.push(`Fields already analysed by the platform: ${(run?.coverage || []).filter((c) => c.status === 'analysed').map((c) => c.field).join(', ') || 'none'}`);
  if (customFields.length) lines.push(`Write analyze() for THESE fields only: ${customFields.map((e) => `${e.path} (${e.meaning || ''}${e.why ? `; ${e.why}` : ''})`).join('; ')}`);
  return lines.join('\n');
}
