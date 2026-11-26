/**
 * Deterministic helpers for importing an existing survey page as it is
 * (see spSchemeAsIs.js): embedding the SP-Scheme block, planning the zip's
 * media into the library and listing the hosts the page loads from.
 * The online model conversion that used to live here was removed on
 * 2026-10-15; nothing in this file calls a model.
 */

import { SP_SCHEME_FORMAT, SP_SCHEME_VERSION } from './spScheme.js';
import { externalHostsIn, normalizeAllowedHosts, stripSitePreviewShim } from './spSiteCore.js';

export const CONVERT_MAX_HTML_CHARS = 200000;

/**
 * Questions the checks rejected are kept as records instead of dropped: their
 * type becomes "custom" (any value, stored as is, not analysed), so the page
 * still runs and the researcher analyses those answers from the export.
 * @returns {{ survey: object, degraded: { name: string, reason: string }[] }}
 */
export function degradeRejectedQuestions(survey, errors = [], problems = []) {
  const out = JSON.parse(JSON.stringify(survey || { pages: [] }));
  const degraded = [];
  const byName = new Map();
  const walk = (elements) => (elements || []).forEach((el, i, list) => {
    if (!el || typeof el !== 'object') return;
    if (el.name) byName.set(el.name, { el, list, i });
    walk(el.elements);
  });
  (out.pages || []).forEach((page) => walk(page?.elements));
  const degrade = (name, reason) => {
    const hit = byName.get(name);
    if (!hit || hit.el.type === 'custom' || degraded.some((d) => d.name === name)) return;
    const { el, list, i } = hit;
    list[i] = { type: 'custom', name: el.name, ...(el.title ? { title: el.title } : {}), ...(el.description ? { description: el.description } : {}), ...(el.isRequired ? { isRequired: true } : {}) };
    degraded.push({ name, reason });
  };
  const elementAt = (path) => {
    const page = /survey\.pages\[(\d+)\]/.exec(path);
    if (!page) return null;
    let list = out.pages?.[Number(page[1])]?.elements;
    let el = null;
    for (const m of path.slice(page.index + page[0].length).matchAll(/\.elements\[(\d+)\]/g)) {
      el = list?.[Number(m[1])] || null;
      list = el?.elements;
    }
    return el;
  };
  errors.forEach((e) => {
    const el = elementAt(String(e.path || ''));
    if (el?.name) degrade(el.name, e.message);
  });
  problems.forEach((text) => {
    const m = /^([\w.-]+): /.exec(String(text));
    if (m && byName.has(m[1])) degrade(m[1], text);
  });
  return { survey: out, degraded };
}

/**
 * The page as it is, with no questions declared: the platform keeps every
 * request it sends and the researcher analyses the export. Used when the
 * model's conversion cannot be made to pass, and offered as a choice.
 */
/** The questions the model found on the page, kept for display when it is imported as it is. */
export function modelQuestionList(survey) {
  const out = [];
  (Array.isArray(survey?.pages) ? survey.pages : []).forEach((page) => (Array.isArray(page?.elements) ? page.elements : []).forEach((el) => {
    if (!el?.name || ['html', 'image', 'expression'].includes(el.type)) return;
    const title = typeof el.title === 'string' ? el.title : (el.title && typeof el.title === 'object' ? Object.values(el.title)[0] : '');
    out.push({ name: String(el.name).slice(0, 120), title: String(title || '').slice(0, 300), type: String(el.type || '') });
  }));
  return out.slice(0, 500);
}

export function rawConversionResult(result = null, { keepAdapter = false } = {}) {
  return {
    survey: { pages: [], ...(result?.survey?.mediaFolders ? { mediaFolders: result.survey.mediaFolders } : {}) },
    adapterScript: keepAdapter ? String(result?.adapterScript || '') : '',
    replacements: keepAdapter ? (result?.replacements || []) : [],
    externalHosts: result?.externalHosts || [],
    originalImages: result?.originalImages || [],
    mediaGroups: result?.mediaGroups || [],
    notes: ['Imported as it is: no questions declared, the platform records the requests the page sends and does not analyse them.'],
  };
}
// One model call, never sent back for fixing.
export const CONVERT_FIX_ROUNDS = 0;
export const CONVERT_START_FIX_ROUNDS = 0;

const DATA_URI_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=\s]{200,}/gi;
const TOKEN_RE = /data:sp-token\/(\d+)/g;

/** Long embedded images waste the model's context; swap them for short tokens. */
export function tokenizeDataUris(html) {
  const tokens = [];
  const out = String(html || '').replace(DATA_URI_RE, (match) => {
    tokens.push(match);
    return `data:sp-token/${tokens.length - 1}`;
  });
  return { html: out, tokens };
}

export function restoreDataUris(text, tokens = []) {
  return String(text || '').replace(TOKEN_RE, (match, i) => tokens[Number(i)] ?? match);
}

function escapeJsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function escapeScriptText(text) {
  return String(text).replace(/<\/script/gi, '<\\/script');
}

const RUNTIME_DATA_RE = /\.(json|csv|tsv|txt)$/i;
const RUNTIME_DATA_MAX = 400000;
/** Data files the page may read at run time (never server code), by name. */
export function runtimeDataFiles(dataFiles = []) {
  const out = {};
  let total = 0;
  (dataFiles || []).forEach((f) => {
    const name = String(f?.name || '');
    const text = String(f?.text || '');
    if (!RUNTIME_DATA_RE.test(name) || f?.truncated || !text || total + text.length > RUNTIME_DATA_MAX) return;
    total += text.length;
    out[name] = text;
  });
  return out;
}

const NAME_RE = /^[A-Za-z_$][\w$]*$/;
const wordIn = (name, text) => new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text);

/**
 * Wrap the adapter in its own function scope. Top-level functions and
 * variables that the page's replaced code calls (and the page itself does not
 * define) are still put on window, so those calls keep working.
 */
export function isolateAdapter(adapter, replacements = [], pageHtml = '') {
  const added = (replacements || []).map((r) => String(r?.replace || '')).join('\n');
  const declared = new Set();
  const re = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:var|let|const)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(adapter))) declared.add(m[1] || m[2]);
  const exported = [...declared].filter((name) => NAME_RE.test(name) && wordIn(name, added) && !wordIn(name, pageHtml));
  const exports = exported.map((name) => `try { if (typeof ${name} !== 'undefined') window.${name} = ${name}; } catch (e) { /* not reached */ }`).join('\n');
  return `(function () {\n${adapter}\n;${exports ? `\n${exports}\n` : ''}window.__spAdapterRan = true;\n}).call(window);`;
}

function insertAfterHeadOpen(html, block) {
  const head = html.match(/<head\b[^>]*>/i);
  if (head) return html.slice(0, head.index + head[0].length) + block + html.slice(head.index + head[0].length);
  const htmlTag = html.match(/<html\b[^>]*>/i);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${html.slice(0, at)}<head>${block}</head>${html.slice(at)}`;
  }
  return block + html;
}

function insertBeforeBodyClose(html, block) {
  const at = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  return at >= 0 ? html.slice(0, at) + block + html.slice(at) : html + block;
}

/**
 * Apply one model answer to the page the model saw (data URIs tokenized).
 * @returns {{ html: string, pkg: object, problems: string[] }}
 */
export function applyConversion(tokenizedHtml, result, tokens = [], { mediaFiles = [], mediaBase = '', dataFiles = [] } = {}) {
  const problems = [];
  let html = stripSitePreviewShim(String(tokenizedHtml || ''));
  (result?.replacements || []).forEach(({ find, replace }, i) => {
    const at = html.indexOf(find);
    if (at < 0) {
      problems.push(`replacements[${i}].find was not found in the page; copy it exactly or drop it: ${JSON.stringify(find.slice(0, 120))}`);
      return;
    }
    if (html.indexOf(find, at + find.length) >= 0) {
      problems.push(`replacements[${i}].find occurs more than once; make it unique: ${JSON.stringify(find.slice(0, 120))}`);
      return;
    }
    html = html.slice(0, at) + replace + html.slice(at + find.length);
  });
  // An old embedded block would shadow the converted questions.
  html = html.replace(/<script\b[^>]*\bid=["']sp-scheme["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const survey = result?.survey ? JSON.parse(JSON.stringify(result.survey)) : null;
  // Models often leave out page names; they carry no meaning for a site.
  (survey?.pages || []).forEach((page, i) => {
    if (page && typeof page === 'object' && !page.name) page.name = `page${i + 1}`;
  });
  // The media library mirrors the zip's own folders; the page applies its own
  // assignment (its config) to them, so the model does not regroup files.
  const mediaPlan = mediaFiles.length ? planMediaUpload(mediaFiles, [], mediaBase) : null;
  if (mediaPlan) {
    problems.push(...mediaPlan.problems);
    if (survey && !(Array.isArray(survey.mediaFolders) && survey.mediaFolders.length)) {
      survey.mediaFolders = [...mediaPlan.folders.keys()];
    }
    problems.push(...linkQuestionFolders(survey, mediaPlan));
  }
  const pkg = { format: SP_SCHEME_FORMAT, spScheme: SP_SCHEME_VERSION, survey };
  html = insertAfterHeadOpen(html, `\n<script type="application/json" id="sp-scheme">\n${escapeJsonForScript(pkg)}\n</script>\n`);
  // The study's data files (config, CSV) travel with the page, so the adapter
  // can hand the page its own data as it is: SPSite.getData('config.json').
  html = html.replace(/<script\b[^>]*\bid=["']sp-data["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const runtimeData = runtimeDataFiles(dataFiles);
  if (Object.keys(runtimeData).length) {
    html = insertAfterHeadOpen(html, `\n<script type="application/json" id="sp-data">\n${escapeJsonForScript(runtimeData)}\n</script>\n`);
  }
  const adapter = String(result?.adapterScript || '').trim();
  const declared = (survey?.pages || []).some((page) => (page?.elements || []).length);
  if (adapter) {
    // The adapter runs in its own function scope, so its names never collide
    // with the page's own globals (a page's `let imageReady` and an adapter's
    // `let imageReady` would otherwise stop the whole adapter before it runs).
    // The marker after it tells whether it ran to its end; when it stops early
    // its onRequest handlers may never be registered, which is reported plainly.
    html = insertBeforeBodyClose(html, `\n<script data-sp-adapter>\n${escapeScriptText(isolateAdapter(adapter, result?.replacements, tokenizedHtml))}\n</script>\n<script data-sp-adapter-check>if (!window.__spAdapterRan) throw new Error('The adapter script stopped before its end because of an error at its top level, so the handlers it registers after that point (SPSite.onRequest, SPSite.onSubmit) do not exist.');</script>\n`);
  } else if (declared) {
    problems.push('adapterScript is empty: the page must record answers with SPSite.answer and finish with SPSite.complete().');
  }
  return { html: restoreDataUris(html, tokens), pkg, problems, mediaPlan };
}

const FOLDER_RE = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/i;

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : 'files';
}

/** A short media-library folder for an import ("sp-scheme/retail_validation_r10_mac"). */
// The media library belongs to one project, so imported files keep the
// upload's own folders (images/, app/) with no extra prefix.
export function importMediaBase() {
  return '';
}

/**
 * Where each stimulus file from the zip goes in the media library: the model's
 * groups first, then the file's own folder.
 * @returns {{ files: { path, folder }[], folders: Map<string, { full, count }>, problems: string[] }}
 */
export function planMediaUpload(mediaFiles, groups = [], base = '') {
  const problems = [];
  const known = new Set(mediaFiles.map((f) => f.path));
  const byBase = new Map();
  mediaFiles.forEach((f) => {
    const name = f.path.split('/').pop();
    byBase.set(name, byBase.has(name) ? null : f.path);
  });
  const assigned = new Map();
  (groups || []).forEach((group, gi) => {
    const folder = String(group.folder || '').replace(/^\/+|\/+$/g, '');
    if (!FOLDER_RE.test(folder)) {
      problems.push(`mediaGroups[${gi}].folder "${group.folder}" is not a short relative folder name of letters, digits, _ and -.`);
      return;
    }
    const missing = [];
    (group.files || []).forEach((file) => {
      const path = known.has(file) ? file : byBase.get(String(file).split('/').pop());
      if (!path) { missing.push(file); return; }
      if (!assigned.has(path)) assigned.set(path, folder);
    });
    if (missing.length) {
      problems.push(`mediaGroups[${gi}] lists ${missing.length} file(s) that are not in MEDIA FILES, e.g. ${missing.slice(0, 3).join(', ')}.`);
    }
  });
  const folders = new Map();
  const files = mediaFiles.map((f) => {
    const rel = assigned.get(f.path) || dirOf(f.path).replace(/[^a-z0-9_/-]+/gi, '_');
    const full = base ? `${base}/${rel}` : rel;
    const entry = folders.get(rel) || { full, count: 0 };
    entry.count += 1;
    folders.set(rel, entry);
    return { ...f, folder: full };
  });
  return { files, folders, problems };
}

function eachElement(survey, fn) {
  const walk = (elements) => (elements || []).forEach((el) => {
    if (!el || typeof el !== 'object') return;
    fn(el);
    walk(el.elements);
  });
  (survey?.pages || []).forEach((page) => walk(page?.elements));
}

/** Point questions at the uploaded folders; report folders that will be empty or too small. */
function linkQuestionFolders(survey, plan) {
  const problems = [];
  if (survey && Array.isArray(survey.mediaFolders)) {
    survey.mediaFolders = survey.mediaFolders.map((folder) => {
      const rel = String(folder || '').replace(/^\/+|\/+$/g, '');
      const hit = plan.folders.get(rel);
      if (!hit) problems.push(`survey.mediaFolders "${folder}" has no files; use one of: ${[...plan.folders.keys()].join(', ')}.`);
      return hit ? hit.full : folder;
    });
  }
  eachElement(survey, (el) => {
    if (!Array.isArray(el.mediaFolders) || !el.mediaFolders.length) return;
    let available = 0;
    el.mediaFolders = el.mediaFolders.map((folder) => {
      const rel = String(folder || '').replace(/^\/+|\/+$/g, '');
      const hit = plan.folders.get(rel);
      if (!hit) {
        problems.push(`${el.name}: mediaFolders "${folder}" has no files; use one of: ${[...plan.folders.keys()].join(', ')}.`);
        return folder;
      }
      available += hit.count;
      return hit.full;
    });
    const needed = (Number(el.trialCount) || 1) * (Number(el.imageCount) || 1);
    if (available && el.excludePreviouslyUsedImages !== false && needed > available) {
      problems.push(`${el.name}: shows ${needed} files without repeats but its folders hold only ${available}; lower trialCount or imageCount.`);
    }
  });
  return problems;
}

/**
 * Domains the page references plus the ones the model says it needs.
 * `needed` marks hosts the page loads code, styles or data from; hosts that
 * only received results are not needed, because results go through SPSite.
 */
export function candidateHosts(html, result) {
  const found = new Map();
  externalHostsIn(html).forEach(({ host, kinds }) => {
    found.set(host, { host, why: kinds.join(', '), needed: kinds.some((k) => k !== 'request') });
  });
  (result?.externalHosts || []).forEach(({ host, why }) => {
    const [clean] = normalizeAllowedHosts([host]);
    if (!clean) return;
    const entry = found.get(clean) || { host: clean, why: '' };
    found.set(clean, { ...entry, why: why || entry.why, needed: true });
  });
  return [...found.values()];
}
