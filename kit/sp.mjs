#!/usr/bin/env node
// SP-Survey Kit command line. Node 18+, no dependencies.
//
//   node kit/sp.mjs templates [words] survey templates rebuilt from published studies
//   node kit/sp.mjs new <folder> [--template <id>]   start a survey from the example or a template
//   node kit/sp.mjs check <folder>    check the page, list media into media.json, explain the draws
//   node kit/sp.mjs serve <folder>    run it locally; responses go to <folder>-responses/
//   node kit/sp.mjs export <folder>   download responses (Supabase or local) as CSV + JSON + per-image scores
//
// Everything here is deterministic: no model is called.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac)$/i;
const KIND = {
  text: 'text', comment: 'text', number: 'number', rating: 'rating', imagerating: 'rating', mediarating: 'rating',
  boolean: 'boolean', consent: 'boolean', imageboolean: 'boolean', mediaboolean: 'boolean',
  radiogroup: 'choice', dropdown: 'choice', imagepicker: 'choice', mediapicker: 'choice',
  checkbox: 'multiChoice', imagecheckbox: 'multiChoice', mediacheckbox: 'multiChoice',
  ranking: 'ranking', imageranking: 'ranking', mediaranking: 'ranking',
  slidergroup: 'sliders', imageslidergroup: 'sliders', mediaslidergroup: 'sliders',
  matrix: 'matrix', imagematrix: 'matrix', mediamatrix: 'matrix',
  pointallocation: 'allocation', imagepointallocation: 'allocation', mediapointallocation: 'allocation',
  imageannotation: 'annotation', custom: 'custom',
  html: 'display', expression: 'display', image: 'display', mediadisplay: 'display',
};
const MEDIA_CHOICE = { imagepicker: 'image_', imageranking: 'image_', mediaranking: 'image_', mediapicker: 'media_' };
const SECRET_KEY_RE = /(service[_-]?role|secret|password|api[_-]?key|access[_-]?token|hf_token|fal[_-]?key)/i;

// ---------- helpers ----------
function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }
function readText(file) { return fs.readFileSync(file, 'utf8'); }
function readJson(file, fallback = null) {
  try { return JSON.parse(readText(file)); } catch { return fallback; }
}
function siteDir(arg) {
  if (!arg) die('Give the study folder, e.g. node kit/sp.mjs check my-study');
  const dir = path.resolve(arg);
  if (!fs.existsSync(path.join(dir, 'index.html'))) die(`${dir} has no index.html`);
  return dir;
}
function responsesDir(dir) { return `${dir}-responses`; }

export function extractScheme(html) {
  const m = String(html).match(/<script\b[^>]*\bid=["']sp-scheme["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return { error: 'index.html has no <script type="application/json" id="sp-scheme"> block.' };
  try { return { scheme: JSON.parse(m[1]) }; } catch (err) { return { error: `The sp-scheme block is not valid JSON: ${err.message}` }; }
}
export function flatElements(pages) {
  const out = [];
  const walk = (list, page) => (list || []).forEach((el) => {
    if (!el || typeof el !== 'object') return;
    if (el.type === 'panel' || el.type === 'paneldynamic') return walk(el.elements || el.templateElements, page);
    out.push({ ...el, _page: page });
  });
  (pages || []).forEach((p) => walk(p.elements, p.name));
  return out;
}
const cleanFolder = (f) => String(f || '').replace(/^\.?\/+|\/+$/g, '');
const folderOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const inFolders = (p, folders) => !folders || !folders.length
  || folders.some((f) => { f = cleanFolder(f); return !f || p === f || p.startsWith(`${f}/`); });
function mediaCount(el) {
  if (!/^(image|media)/.test(el.type || '')) return 0;
  return Math.max(1, Number(el.imageCount) || (MEDIA_CHOICE[el.type] ? 4 : 1));
}
const trialCount = (el) => Math.max(1, Math.floor(Number(el.trialCount) || 1));
const isBalanced = (el) => /^(balanced|adaptive|uncertain|high_sigma)$/.test(String(el.pairingMode || ''));

export function listMedia(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(r);
      else if (MEDIA_RE.test(entry.name)) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

function jwtRole(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role || null;
  } catch { return null; }
}
function findSecrets(value, at = '') {
  const hits = [];
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k) && v) hits.push(`${at}${k}`);
      hits.push(...findSecrets(v, `${at}${k}.`));
    }
  }
  return hits;
}

// ---------- check ----------
export function checkSite(dir, { write = true } = {}) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const html = readText(path.join(dir, 'index.html'));
  const { scheme, error } = extractScheme(html);
  if (error) errors.push(error);
  const survey = scheme?.survey || scheme || {};
  if (scheme && scheme.format !== 'sp-scheme-package') warnings.push('The sp-scheme block should say "format": "sp-scheme-package" (needed to upload the same page to sp-survey.org).');
  if (scheme && !Array.isArray(survey.pages)) errors.push('survey.pages is missing.');
  const elements = flatElements(survey.pages);
  const names = new Set();
  elements.forEach((el) => {
    if (!el.name) { errors.push(`A ${el.type || 'question'} on page ${el._page || '?'} has no name.`); return; }
    if (names.has(el.name)) errors.push(`Question name "${el.name}" is used twice.`);
    names.add(el.name);
    if (!/^[a-z0-9_]+$/.test(el.name)) warnings.push(`Question name "${el.name}": use lowercase letters, digits and underscores.`);
    if (!KIND[el.type] && !(el.type === 'text')) errors.push(`Question "${el.name}" has type "${el.type}", which SP-Scheme does not know. Use a type from SP-SCHEME.md section 3 or "custom".`);
    if (/^(image|media)/.test(el.type || '') && Array.isArray(el.choices) && el.choices.some((c) => c && typeof c === 'object' && c.imageLink)) {
      errors.push(`Question "${el.name}" hard-codes image URLs; leave "choices": [] and put the files in a media folder.`);
    }
  });
  const secrets = findSecrets(scheme);
  if (secrets.length) errors.push(`The sp-scheme block contains credentials (${secrets.join(', ')}). Remove them.`);
  if (!/SPSite\.answer\s*\(/.test(html)) errors.push('index.html never calls SPSite.answer(...), so nothing would be recorded.');
  if (!/SPSite\.complete\s*\(/.test(html)) errors.push('index.html never calls SPSite.complete(), so participants could not submit.');
  if (!/<script\b[^>]*\bsrc=["'](\.\/)?sp-site\.js["']/i.test(html)) errors.push('index.html does not load sp-site.js. Add <script src="sp-site.js"></script> right after the sp-scheme block (inside the sp-site-preview markers).');
  if (!fs.existsSync(path.join(dir, 'sp-site.js'))) errors.push('sp-site.js is missing from the study folder: copy kit/sp-site.js next to index.html.');
  if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon)/.test(html.replace(/<!-- sp-site-preview:start -->[\s\S]*?<!-- sp-site-preview:end -->/g, ''))) {
    warnings.push('index.html makes its own network calls. Answers must go through SPSite.answer; on sp-survey.org these calls are blocked.');
  }

  // config
  const config = readJson(path.join(dir, 'sp-config.json'), null);
  if (!config) warnings.push('No sp-config.json: responses can only be stored while running "node kit/sp.mjs serve".');
  else {
    if (!config.projectId) warnings.push('sp-config.json has no projectId; the study title is used instead. Set one so exports find your rows.');
    const role = config.supabaseAnonKey ? jwtRole(config.supabaseAnonKey) : null;
    if (role === 'service_role' || /^sb_secret_/.test(String(config.supabaseAnonKey || ''))) errors.push('sp-config.json holds the Supabase SERVICE ROLE / secret key. Use the anon (publishable) key: this file is public.');
    const extra = Object.keys(config).filter((k) => SECRET_KEY_RE.test(k));
    if (extra.length) errors.push(`sp-config.json is public; remove ${extra.join(', ')}.`);
    if (!config.supabaseUrl || !config.supabaseAnonKey) warnings.push('sp-config.json has no supabaseUrl / supabaseAnonKey: fine for a local try with "serve", but the deployed site could not store responses.');
  }

  // media
  const files = listMedia(dir);
  if (write) fs.writeFileSync(path.join(dir, 'media.json'), `${JSON.stringify({ generated: new Date().toISOString(), files }, null, 2)}\n`);
  notes.push(`media.json lists ${files.length} media file${files.length === 1 ? '' : 's'}.`);
  (survey.mediaFolders || []).forEach((f) => {
    const n = files.filter((p) => inFolders(p, [f])).length;
    if (!n) warnings.push(`mediaFolders "${f}" (read by SPSite.getMedia) has no files yet.`);
    else notes.push(`SPSite.getMedia("${f}") returns ${n} files.`);
  });
  const libraries = new Map();
  elements.forEach((el) => {
    const n = mediaCount(el);
    if (!n) return;
    const pool = files.filter((p) => inFolders(p, el.mediaFolders));
    const where = el.mediaFolders?.length ? el.mediaFolders.join(', ') : 'all media folders';
    const rounds = trialCount(el);
    if (el.mediaAssignmentMode === 'set') {
      const byFolder = {};
      pool.forEach((p) => { (byFolder[folderOf(p)] ||= []).push(p); });
      const sets = Object.values(byFolder).filter((l) => l.length === n).length;
      if (!sets) warnings.push(`"${el.name}" shows sets of ${n}: no folder in ${where} holds exactly ${n} files, so placeholders are shown.`);
      else notes.push(`"${el.name}": ${rounds} round(s), each one folder of ${n} files, from ${sets} sets in ${where}${isBalanced(el) ? ', balanced' : ', random'}.`);
      return;
    }
    const need = n * rounds;
    if (!pool.length) warnings.push(`"${el.name}" needs ${need} file(s) per participant but ${where} has none yet: placeholders are shown until you add images.`);
    else if (pool.length < need) warnings.push(`"${el.name}" needs ${need} files per participant but ${where} has only ${pool.length}; some images repeat for one person.`);
    else notes.push(`"${el.name}": ${n} file(s) × ${rounds} round(s) = ${need} per participant, from ${pool.length} files in ${where}${isBalanced(el) ? ', balanced (every file shown equally often)' : ', random'}.`);
    if (isBalanced(el) && pool.length) {
      const key = `${el.excludePreviouslyUsedImages === false ? el.name : 'shared'}|${pool.join(',')}`;
      const lib = libraries.get(key) || { size: pool.length, perPerson: 0, questions: [] };
      lib.perPerson += need;
      lib.questions.push(el.name);
      libraries.set(key, lib);
    }
  });
  libraries.forEach((lib) => {
    const per = Math.min(lib.perPerson, lib.size);
    const full = Math.ceil(lib.size / per);
    notes.push(`Balanced library of ${lib.size} files (${lib.questions.join(', ')}): about every ${full} participants see the whole library once; with N participants each file is shown about N × ${per} / ${lib.size} times.`);
  });
  if (elements.some((el) => mediaCount(el) && isBalanced(el)) && !(config?.supabaseUrl)) {
    warnings.push('Balanced questions need numbers from your Supabase (claim_balance_number in kit/supabase.sql). Without Supabase they draw at random (serve keeps a local counter).');
  }
  return { errors, warnings, notes, survey, elements, files, config };
}

function cmdCheck(arg) {
  const dir = siteDir(arg);
  const r = checkSite(dir);
  r.notes.forEach((n) => console.log(`• ${n}`));
  r.warnings.forEach((w) => console.log(`! ${w}`));
  r.errors.forEach((e) => console.log(`✗ ${e}`));
  console.log(r.errors.length ? `\n${r.errors.length} problem(s) to fix.` : '\n✓ Ready. Try it with: node kit/sp.mjs serve ' + path.relative(process.cwd(), dir));
  process.exitCode = r.errors.length ? 1 : 0;
}

// ---------- new / library ----------
export function loadTemplates() { return readJson(path.join(KIT, 'templates', 'templates.json'), { templates: [] }).templates; }

export function writeGenericPage(dir, survey) {
  const pkg = { format: 'sp-scheme-package', spScheme: '2.0', survey };
  const html = readText(path.join(KIT, 'generic.html'))
    .replace('__SCHEME__', JSON.stringify(pkg, null, 2).replace(/<\//g, '<\\/'))
    .replace('__TITLE__', String(survey.title || 'Study').replace(/[<&]/g, ''))
    .replace('__LANG__', survey.locale || 'en');
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

function cmdNew(arg, flags) {
  if (!arg) die('Give a folder name, e.g. node kit/sp.mjs new my-study');
  const dir = path.resolve(arg);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) die(`${dir} is not empty`);
  let folder = 'streets';
  if ((flags.template || flags.from)) {
    const study = loadTemplates().find((s) => s.id === (flags.template || flags.from));
    if (!study) die(`No template "${(flags.template || flags.from)}". List them with: node kit/sp.mjs templates`);
    fs.mkdirSync(path.join(dir, 'stimuli'), { recursive: true });
    writeGenericPage(dir, { ...study.survey, id: study.id });
    fs.writeFileSync(path.join(dir, 'sp-config.json'), `${JSON.stringify({ projectId: '', supabaseUrl: '', supabaseAnonKey: '', completionUrl: '', thankYou: '' }, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'stimuli', 'PUT-IMAGES-HERE.txt'), 'Put the images participants will judge in this folder, then run node kit/sp.mjs check <study folder>.\n');
    fs.writeFileSync(path.join(dir, 'STUDY.md'), [
      `# ${study.title}`, '',
      `Original study: ${study.authors} (${study.year}). ${study.link || ''}`, '',
      study.description || '', '',
      'Made with an SP-Survey template. Cite the original study and SP-Survey (see CITATION.cff in the SP-Survey repository).', '',
    ].join('\n'));
    folder = 'stimuli';
  } else {
    fs.cpSync(path.join(KIT, 'example'), dir, { recursive: true });
  }
  fs.copyFileSync(path.join(KIT, 'sp-site.js'), path.join(dir, 'sp-site.js'));
  const cfgFile = path.join(dir, 'sp-config.json');
  const cfg = readJson(cfgFile, {});
  cfg.projectId = path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-study';
  fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);
  console.log(`✓ Created ${dir}${(flags.template || flags.from) ? ` from template ${(flags.template || flags.from)}` : ''}\n  1. Put your images in ${path.join(arg, folder)}/\n  2. node kit/sp.mjs check ${arg}\n  3. node kit/sp.mjs serve ${arg}`);
}

function cmdTemplates(words) {
  const q = (words || []).join(' ').toLowerCase();
  const list = loadTemplates().filter((t) => !q || `${t.id} ${t.title} ${t.authors} ${t.description}`.toLowerCase().includes(q));
  console.log(`Templates (node kit/sp.mjs new <folder> --template <id>). More at https://sp-survey.org\n`);
  list.forEach((t) => console.log(`  ${t.id.padEnd(30)} ${t.title} — ${t.authors} (${t.year})`));
  if (!list.length) console.log('  none match; try fewer words');
}

// ---------- serve ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

export function createServer(dir) {
  const out = responsesDir(dir);
  const claimsFile = path.join(out, 'claims.json');
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    if (req.method === 'POST' && (url.pathname === '/__sp/submit' || url.pathname === '/__sp/claim')) {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 10 * 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        fs.mkdirSync(out, { recursive: true });
        if (url.pathname === '/__sp/claim') {
          const claims = readJson(claimsFile, { next: 0 });
          const n = claims.next;
          claims.next = n + 1;
          fs.writeFileSync(claimsFile, JSON.stringify(claims));
          return send(200, JSON.stringify({ n, claim_id: `local-${n}` }));
        }
        let row;
        try { row = JSON.parse(body); } catch { return send(400, '{"error":"bad json"}'); }
        row.id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        row.created_at = new Date().toISOString();
        fs.appendFileSync(path.join(out, 'responses.jsonl'), `${JSON.stringify(row)}\n`);
        console.log(`  ✓ response from ${row.participant_id} saved to ${path.join(out, 'responses.jsonl')}`);
        return send(200, JSON.stringify({ id: row.id }));
      });
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'Not found', 'text/plain');
    send(200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

function cmdServe(arg, flags) {
  const dir = siteDir(arg);
  const r = checkSite(dir);
  r.errors.forEach((e) => console.log(`✗ ${e}`));
  const port = Number(flags.port) || 4173;
  createServer(dir).listen(port, () => {
    console.log(`\nSP-Survey study running at http://localhost:${port}/`);
    console.log(r.config?.supabaseUrl
      ? '  Responses go to your Supabase (sp-config.json).'
      : `  No Supabase set: responses are saved to ${responsesDir(dir)}/responses.jsonl`);
    console.log('  Ctrl+C to stop.');
  });
}

// ---------- export ----------
async function fetchSupabaseRows(projectId) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${base}/rest/v1/survey_responses?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) die(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const csvCell = (v) => {
  const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';

/** One row per recorded answer (per round), with the files shown and, for image choices, the chosen file. */
export function longRows(rows, elements) {
  const byName = Object.fromEntries(elements.map((el) => [el.name, el]));
  const out = [];
  rows.forEach((row) => {
    const responses = typeof row.responses === 'string' ? JSON.parse(row.responses) : (row.responses || {});
    const shownAll = typeof row.displayed_images === 'string' ? JSON.parse(row.displayed_images) : (row.displayed_images || {});
    const meta = typeof row.survey_metadata === 'string' ? JSON.parse(row.survey_metadata) : (row.survey_metadata || {});
    Object.entries(responses).forEach(([name, answer]) => {
      const el = byName[name] || {};
      const prefix = MEDIA_CHOICE[el.type];
      const records = answer && typeof answer === 'object' && Array.isArray(answer.trials)
        ? answer.trials.map((t, i) => ({ trial: i, key: t.key ?? '', value: t.value, shown: t.shown_images || [] }))
        : [{ trial: 0, key: '', value: answer, shown: (shownAll[name] && shownAll[name][0]) || [] }];
      records.forEach((r) => {
        if (r.value == null) return;
        const pick = (v) => (prefix && typeof v === 'string' && v.startsWith(prefix) ? r.shown[Number(v.slice(prefix.length))] ?? '' : '');
        const chosen = Array.isArray(r.value) ? r.value.map(pick).filter(Boolean).join('|') : pick(r.value);
        out.push({
          response_id: row.id, participant_id: row.participant_id, created_at: row.created_at,
          duration_s: meta.duration_ms != null ? Math.round(meta.duration_ms / 1000) : '',
          question: name, type: el.type || '', trial: r.trial, key: r.key,
          value: r.value, chosen, shown: r.shown.join('|'),
        });
      });
    });
  });
  return out;
}

/** Per question × file: how often shown, mean of numeric answers, and wins for image choices. */
export function imageScores(long, elements) {
  const byName = Object.fromEntries(elements.map((el) => [el.name, el]));
  const stats = new Map();
  const get = (q, f) => {
    const k = `${q}␟${f}`;
    if (!stats.has(k)) stats.set(k, { question: q, file: f, shown: 0, chosen: 0, rated: 0, sum: 0 });
    return stats.get(k);
  };
  long.forEach((r) => {
    const el = byName[r.question] || {};
    const files = r.shown ? r.shown.split('|') : [];
    if (!files.length) return;
    const kind = KIND[el.type];
    files.forEach((f) => { get(r.question, f).shown += 1; });
    if (kind === 'choice' && r.chosen) get(r.question, r.chosen).chosen += 1;
    const num = typeof r.value === 'number' ? r.value : null;
    if (num != null && files.length === 1) { const s = get(r.question, files[0]); s.rated += 1; s.sum += num; }
    if (kind === 'sliders' && r.value && typeof r.value === 'object' && files.length === 1) {
      Object.entries(r.value).forEach(([dim, v]) => {
        const s = get(`${r.question}.${dim}`, files[0]);
        s.shown += 1; s.rated += 1; s.sum += Number(v) || 0;
      });
    }
  });
  return [...stats.values()].map((s) => ({
    question: s.question, file: s.file, shown: s.shown,
    chosen: s.chosen || '', choice_rate: s.chosen ? (s.chosen / s.shown).toFixed(3) : '',
    ratings: s.rated || '', mean_rating: s.rated ? (s.sum / s.rated).toFixed(3) : '',
  })).sort((a, b) => a.question.localeCompare(b.question) || a.file.localeCompare(b.file));
}

async function cmdExport(arg, flags) {
  const dir = siteDir(arg);
  const { elements, config } = checkSite(dir, { write: false });
  const projectId = config?.projectId;
  let rows;
  if (!flags.local && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!projectId) die('sp-config.json needs a projectId to find your rows');
    rows = await fetchSupabaseRows(projectId);
    console.log(`Downloaded ${rows.length} response(s) for ${projectId} from Supabase.`);
  } else {
    const file = path.join(responsesDir(dir), 'responses.jsonl');
    if (!fs.existsSync(file)) die(`No local responses at ${file}. For Supabase set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell (never in the study folder).`);
    rows = readText(file).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    console.log(`Read ${rows.length} local response(s).`);
  }
  const out = path.resolve(flags.out || path.join(responsesDir(dir), 'export'));
  fs.mkdirSync(out, { recursive: true });
  const long = longRows(rows, elements);
  const scores = imageScores(long, elements);
  fs.writeFileSync(path.join(out, 'responses.json'), `${JSON.stringify(rows, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'answers_long.csv'), toCsv(['response_id', 'participant_id', 'created_at', 'duration_s', 'question', 'type', 'trial', 'key', 'value', 'chosen', 'shown'], long));
  fs.writeFileSync(path.join(out, 'image_scores.csv'), toCsv(['question', 'file', 'shown', 'chosen', 'choice_rate', 'ratings', 'mean_rating'], scores));
  fs.writeFileSync(path.join(out, 'README.txt'), [
    'SP-Survey Kit export',
    '',
    'responses.json     every submission as stored (survey_responses rows)',
    'answers_long.csv   one row per answer and round: value, the files shown (| separated) and, for image choices, the chosen file',
    'image_scores.csv   per question and file: times shown, times chosen and choice rate, number of ratings and mean rating',
    '',
    'Made with SP-Survey (https://github.com/Sijie-Yang/SP-Survey). Please cite the software (see CITATION.cff).',
    '',
  ].join('\n'));
  console.log(`✓ Wrote ${long.length} answer rows and ${scores.length} image rows to ${out}`);
}

// ---------- main ----------
function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true); } else pos.push(a);
  }
  return { pos, flags };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, arg] = pos;
  if (cmd === 'new') cmdNew(arg, flags);
  else if (cmd === 'templates' || cmd === 'library') cmdTemplates(pos.slice(1));
  else if (cmd === 'check') cmdCheck(arg);
  else if (cmd === 'serve') cmdServe(arg, flags);
  else if (cmd === 'export') await cmdExport(arg, flags);
  else {
    console.log(`SP-Survey Kit
  node kit/sp.mjs templates [words]  list survey templates rebuilt from published studies
  node kit/sp.mjs new <folder> [--template <id>]   start a survey (from the example or a template)
  node kit/sp.mjs check <folder>     check the page and the media, write media.json
  node kit/sp.mjs serve <folder>     try it locally (port 4173; --port 8080)
  node kit/sp.mjs export <folder>    responses → CSV (Supabase via SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else local; --out dir)`);
  }
}
