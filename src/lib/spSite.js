/**
 * SP-Site: run a whole survey interface designed by an external LLM.
 *
 * The site is one HTML page rendered full-screen in a sandboxed iframe. The
 * platform keeps owning what matters for the data: it draws the media, tells
 * the site exactly what to show (questions + media + allowed answer values),
 * validates every answer against the native question contract and records it
 * through the normal SurveyJS model, so responses, analysis and export are the
 * same as for a standard survey. Pure module; the React host is SpSiteFrame.
 */

import { applyMediaToElement } from './surveyMediaInjection';
import { sliderScale } from './sliderScale';
import { normalizeMediaEntry } from './mediaUtils';
import { isTrialsAnswer, mediaSetToShownIds, mediaSetToShownImages } from './trialNavigation';
import {
  ANSWER_SHAPES,
  SP_SITE_SCRIPT_HOSTS as CDN_HOSTS,
  SP_SITE_VERSION,
  answerKindOf,
  flatElements,
  normalizeAllowedHosts,
  stripSitePreviewShim,
  utf8Bytes,
} from './spSiteCore.js';

// The pure part lives in spSiteCore.js (no DOM, no Supabase) so the Worker can
// import a page too; everything public is re-exported here.
export {
  ANSWER_SHAPES,
  SITE_SHIM_END,
  SITE_SHIM_START,
  SP_SITE_MAX_BYTES,
  SP_SITE_SCRIPT_HOSTS,
  SP_SITE_VERSION,
  answerKindOf,
  checkSiteHtml,
  externalHostsIn,
  extractEmbeddedScheme,
  normalizeAllowedHosts,
  siteMatchLevel,
  stripSitePreviewShim,
  utf8Bytes,
} from './spSiteCore.js';

// Choices of these types are the drawn media themselves (value image_N / media_N).
const MEDIA_CHOICE_TYPES = new Set(['imagepicker', 'imageranking', 'mediaranking', 'mediapicker']);

/** Largest JSON value a custom question may record (bytes). */
export const CUSTOM_ANSWER_MAX_BYTES = 32 * 1024;
/** Most records one custom question may hold (one per answer with { key } or { shown }). */
export const CUSTOM_ANSWER_MAX_RECORDS = 1000;

function localText(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const hit = (lang && value[lang]) ?? value.default ?? Object.values(value).find((v) => typeof v === 'string');
    return hit == null ? '' : String(hit);
  }
  return '';
}

function itemList(items, lang) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item == null) return null;
    if (typeof item !== 'object') return { value: String(item), text: String(item) };
    const value = String(item.value ?? item.id ?? item.text ?? '');
    if (!value) return null;
    const out = { value, text: localText(item.text ?? item.label, lang) || value };
    if (item.imageLink) out.imageUrl = item.imageLink;
    return out;
  }).filter(Boolean);
}

function mediaItem(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { url: entry, name: entry.split('?')[0].split('/').pop(), type: 'image' };
  const url = entry.url || entry.imageLink || entry.src;
  if (!url) return null;
  return { url, name: entry.name || entry.imageName || String(url).split('?')[0].split('/').pop(), type: entry.type || 'image' };
}

/** Media the platform drew for a (non-trial) question, in display order. */
export function elementMedia(element = {}) {
  if (Array.isArray(element.mediaItems) && element.mediaItems.length) return element.mediaItems.map(mediaItem).filter(Boolean);
  const urls = element.imageUrls?.length ? element.imageUrls : element.imageLinks;
  if (Array.isArray(urls) && urls.length) {
    return urls.map((url, i) => mediaItem({ url, name: element.imageNames?.[i] })).filter(Boolean);
  }
  if (element.annotationImageUrl) return [mediaItem({ url: element.annotationImageUrl })];
  if (element.imageLink) return [mediaItem({ url: element.imageLink, name: element.imageName })];
  if (MEDIA_CHOICE_TYPES.has(element.type) || ['imagerating', 'imageboolean', 'imagematrix'].includes(element.type)) {
    return (element.choices || []).map((c) => mediaItem(c && { url: c.imageLink, name: c.imageName })).filter(Boolean);
  }
  return [];
}

function answerChoices(element, lang) {
  const kind = answerKindOf(element);
  if (!['choice', 'multiChoice', 'ranking', 'allocation'].includes(kind)) return undefined;
  const choices = itemList(element.choices, lang);
  if (element.allowTie && element.tieLabel) {
    choices.push({ value: String(element.tieLabel), text: String(element.tieLabel), tie: true });
  }
  return choices;
}

function trialChoices(element, mediaSet, lang) {
  if (!MEDIA_CHOICE_TYPES.has(element.type)) return answerChoices(element, lang);
  const scratch = { type: element.type, name: element.name };
  applyMediaToElement(scratch, mediaSet || []);
  return answerChoices({ ...element, choices: scratch.choices || [] }, lang);
}

function trialCountOf(element) {
  const n = Number(element?.trialCount || 1);
  return Number.isFinite(n) && n > 1 ? Math.min(200, Math.floor(n)) : 1;
}

/**
 * What the site receives at start-up: every question with its wording, the
 * media drawn for this participant and the exact answer values allowed.
 * @param {object} surveyJson survey config after media injection
 */
export function buildSiteQuestions(surveyJson, { language } = {}) {
  const lang = language || surveyJson?.locale || null;
  return flatElements(surveyJson?.pages)
    // Empty pages get an invisible html placeholder at runtime; it is not content.
    .filter(({ element }) => element.name && !(element.type === 'html' && /_placeholder$/.test(element.name)))
    .map(({ element, pageName }) => {
    const kind = answerKindOf(element);
    const trialCount = trialCountOf(element);
    const q = {
      name: element.name,
      page: pageName || null,
      type: element.type === 'text' && element.inputType === 'number' ? 'number' : element.type,
      kind,
      answerShape: ANSWER_SHAPES[kind] || null,
      title: localText(element.title, lang) || element.name,
      description: localText(element.description, lang),
      required: Boolean(element.isRequired),
      trialCount,
    };
    if (kind === 'display' && element.type === 'html') q.html = localText(element.html, lang);
    if (kind === 'number') { q.min = element.min ?? null; q.max = element.max ?? null; }
    if (kind === 'text' && element.maxLength) q.maxLength = Number(element.maxLength);
    if (kind === 'rating') {
      q.rateMin = Number(element.rateMin ?? 1);
      q.rateMax = Number(element.rateMax ?? element.rateCount ?? 5);
      if (Array.isArray(element.rateValues) && element.rateValues.length) q.rateValues = itemList(element.rateValues, lang);
      else if (Array.isArray(element.rateLabels) && element.rateLabels.length) {
        // One label per scale point (rateMin, rateMin + step, …); the answer stays numeric.
        const step = Number(element.rateStep) || 1;
        q.rateValues = element.rateLabels.map((label, i) => ({ value: String(q.rateMin + i * step), text: localText(label, lang) }));
      }
      if (element.minRateDescription) q.minLabel = localText(element.minRateDescription, lang);
      if (element.maxRateDescription) q.maxLabel = localText(element.maxRateDescription, lang);
    }
    if (kind === 'boolean') {
      if (element.labelTrue) q.labelTrue = localText(element.labelTrue, lang);
      if (element.labelFalse) q.labelFalse = localText(element.labelFalse, lang);
    }
    if (kind === 'sliders') {
      q.dimensions = (element.dimensions || []).filter((d) => d?.id).map((d) => {
        const scale = sliderScale(d, element);
        return {
          id: String(d.id),
          label: localText(d.label ?? d.text, lang),
          left: localText(d.left ?? d.minLabel, lang),
          right: localText(d.right ?? d.maxLabel, lang),
          min: scale.min,
          max: scale.max,
          step: scale.step,
        };
      });
    }
    if (kind === 'matrix') {
      q.rows = itemList(element.rows, lang);
      q.columns = itemList(element.columns, lang);
    }
    if (kind === 'allocation') q.budget = Number(element.budget ?? 100);
    if (kind === 'annotation') {
      q.tools = (element.allowedTools?.length ? element.allowedTools : ['point', 'line', 'polygon', 'bbox']).map(String);
      q.labels = itemList(element.annotationLabels, lang).map((l) => l.text);
      q.minShapes = Number(element.minAnnotations ?? 0);
      q.maxShapes = Number(element.maxAnnotations ?? 50);
    }
    if (trialCount > 1 && Array.isArray(element.trialMediaSets) && element.trialMediaSets.length) {
      q.trials = element.trialMediaSets.slice(0, trialCount).map((set) => ({
        media: (set || []).map(mediaItem).filter(Boolean),
        choices: trialChoices(element, set, lang),
      }));
    } else {
      q.media = elementMedia(element);
      const choices = answerChoices(element, lang);
      if (choices) q.choices = choices;
    }
    if (trialCount > 1 && !q.trials) {
      q.trials = Array.from({ length: trialCount }, () => ({ media: q.media || [], choices: q.choices }));
    }
    return q;
  });
}

function fail(reason) { return { ok: false, reason }; }

function asValue(item) {
  return String(typeof item === 'object' && item ? item.value ?? item.text : item);
}

/** Check one answer (one trial for repeated questions) against its question. */
export function validateSiteAnswer(question, value, choices = question?.choices) {
  const kind = question?.kind;
  const allowed = (choices || []).map((c) => c.value);
  switch (kind) {
    case 'custom': {
      if (value === undefined || typeof value === 'function') return fail('Expected a JSON value');
      let text;
      try { text = JSON.stringify(value); } catch { return fail('Expected a JSON value'); }
      if (text === undefined) return fail('Expected a JSON value');
      if (utf8Bytes(text) > CUSTOM_ANSWER_MAX_BYTES) return fail(`Value larger than ${CUSTOM_ANSWER_MAX_BYTES / 1024} KB`);
      return { ok: true, value: JSON.parse(text) };
    }
    case 'text': {
      const text = typeof value === 'string' ? value : (value == null ? '' : String(value));
      if (question.maxLength && text.length > question.maxLength) return fail(`Text longer than ${question.maxLength} characters`);
      return { ok: true, value: text };
    }
    case 'number': {
      const n = Number(value);
      if (value === '' || value === true || value === false || !Number.isFinite(n)) return fail('Expected a number');
      if (question.min != null && n < Number(question.min)) return fail(`Expected a number ≥ ${question.min}`);
      if (question.max != null && n > Number(question.max)) return fail(`Expected a number ≤ ${question.max}`);
      return { ok: true, value: n };
    }
    case 'rating': {
      if (question.rateValues?.length) {
        const hit = question.rateValues.find((r) => r.value === asValue(value));
        if (!hit) return fail(`Expected one of ${question.rateValues.map((r) => r.value).join(', ')}`);
        const n = Number(hit.value);
        return { ok: true, value: Number.isFinite(n) ? n : hit.value };
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n < question.rateMin || n > question.rateMax) {
        return fail(`Expected a number from ${question.rateMin} to ${question.rateMax}`);
      }
      return { ok: true, value: n };
    }
    case 'boolean':
      if (typeof value !== 'boolean') return fail('Expected true or false');
      return { ok: true, value };
    case 'choice': {
      const v = asValue(value);
      if (!allowed.includes(v)) return fail(`Expected one of ${allowed.join(', ')}`);
      return { ok: true, value: v };
    }
    case 'multiChoice': {
      if (!Array.isArray(value)) return fail('Expected an array of choice values');
      const list = value.map(asValue);
      if (list.some((v) => !allowed.includes(v))) return fail(`Every item must be one of ${allowed.join(', ')}`);
      if (new Set(list).size !== list.length) return fail('Choice values must be unique');
      return { ok: true, value: list };
    }
    case 'ranking': {
      if (!Array.isArray(value)) return fail('Expected an array of choice values, best first');
      const list = value.map(asValue);
      const ranked = allowed.filter((v) => !(choices || []).find((c) => c.value === v)?.tie);
      if (new Set(list).size !== list.length) return fail('Ranking items must be unique');
      if (list.some((v) => !ranked.includes(v))) return fail(`Every item must be one of ${ranked.join(', ')}`);
      if (list.length !== ranked.length) return fail(`Rank all ${ranked.length} items`);
      return { ok: true, value: list };
    }
    case 'sliders': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected an object { dimensionId: number }');
      const out = {};
      for (const d of question.dimensions || []) {
        if (value[d.id] == null) continue;
        const n = Number(value[d.id]);
        if (!Number.isFinite(n) || n < d.min || n > d.max) return fail(`${d.id} must be a number from ${d.min} to ${d.max}`);
        out[d.id] = n;
      }
      const unknown = Object.keys(value).filter((k) => !(question.dimensions || []).some((d) => d.id === k));
      if (unknown.length) return fail(`Unknown dimension ${unknown.join(', ')}`);
      if (!Object.keys(out).length) return fail('Answer at least one dimension');
      return { ok: true, value: out };
    }
    case 'matrix': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected an object { row: column }');
      const rows = (question.rows || []).map((r) => r.value);
      const cols = (question.columns || []).map((c) => c.value);
      const out = {};
      for (const [row, raw] of Object.entries(value)) {
        if (!rows.includes(row)) return fail(`Unknown row ${row}`);
        const col = asValue(raw);
        if (!cols.includes(col)) return fail(`Row ${row} must be one of ${cols.join(', ')}`);
        out[row] = col;
      }
      return { ok: true, value: out };
    }
    case 'allocation': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected an object { choice: points }');
      const out = {};
      let sum = 0;
      for (const key of allowed) {
        const n = Number(value[key] ?? 0);
        if (!Number.isFinite(n) || n < 0) return fail(`${key} must be a number ≥ 0`);
        out[key] = n;
        sum += n;
      }
      const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
      if (unknown.length) return fail(`Unknown choice ${unknown.join(', ')}`);
      if (Math.abs(sum - question.budget) > 0.01) return fail(`Points must sum to ${question.budget}`);
      return { ok: true, value: out };
    }
    case 'annotation': {
      const shapes = Array.isArray(value) ? value : value?.shapes;
      if (!Array.isArray(shapes)) return fail('Expected { shapes: [...] }');
      if (shapes.length > question.maxShapes) return fail(`At most ${question.maxShapes} shapes`);
      const out = [];
      for (const shape of shapes) {
        const tool = String(shape?.tool || '').toLowerCase();
        if (!question.tools.includes(tool)) return fail(`Tool ${tool || '(missing)'} is not allowed; use ${question.tools.join(', ')}`);
        const label = shape?.label == null ? '' : String(shape.label);
        if (question.labels.length && label && !question.labels.includes(label)) return fail(`Label ${label} is not allowed`);
        const need = tool === 'point' ? 1 : (tool === 'polygon' ? 3 : 2);
        const points = (Array.isArray(shape?.points) ? shape.points : []).map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
        if (points.length < need) return fail(`${tool} needs at least ${need} points`);
        if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) {
          return fail('Points must be normalised to 0–1');
        }
        out.push({ tool, label, points });
      }
      return { ok: true, value: { shapes: out } };
    }
    case 'display':
      return fail('This item shows content and takes no answer');
    default:
      return fail(`Question type ${question?.type} cannot be answered from a site`);
  }
}

function emptyTrials(n) {
  return { trials: Array.from({ length: n }, () => ({ value: null, shown_images: [], shown_media_ids: [] })) };
}

/** The media library root in spSite.mediaFolders: the files directly in it, no subfolders. */
export const SITE_MEDIA_ROOT = '/';

/** Folders an SP-Scheme page may draw from itself (SPSite.getMedia). */
export function siteMediaFolderNames(config = {}) {
  const linked = config.spSite?.mediaFolders || [];
  const names = new Set(linked.map((f) => String(f || '').replace(/^\/+|\/+$/g, '')).filter(Boolean));
  if (linked.includes(SITE_MEDIA_ROOT)) names.add(SITE_MEDIA_ROOT);
  flatElements(config.pages).forEach(({ element }) => (element.mediaFolders || []).forEach((f) => {
    const name = String(f || '').replace(/^\/+|\/+$/g, '');
    if (name) names.add(name);
  }));
  return [...names];
}

export const SITE_MEDIA_MAX_ITEMS = 2000;

/**
 * The project's media grouped by folder for the page: only the folders the
 * survey names (recursively), so a large library is not sent whole.
 */
/** Media-folder key for the library files a page names by relative path (not a real folder). */
export const SITE_PAGE_FILES = '__page_files__';

const PAGE_FILE_RE = /["'(=]\s*((?:\.\/)?[^"'()<>\s:?#]*?([^"'()<>\s:?#/]+\.(?:jpe?g|png|webp|gif|avif|bmp|svg|mp4|webm|mov|mp3|wav|ogg|m4a)))(?:[?#][^"'()\s]*)?\s*["')]/gi;

/**
 * Files the page itself names by relative path ("images/a.jpg", "a.jpg"). The
 * media library counts as the folder the page sits in, so those names are the
 * library's files: same folder path, else the same file name.
 */
export function pageReferencedFiles(html) {
  const refs = new Map();
  const text = String(html || '');
  let m;
  PAGE_FILE_RE.lastIndex = 0;
  while ((m = PAGE_FILE_RE.exec(text))) {
    const path = m[1].replace(/^\.\//, '').replace(/^\/+/, '');
    if (/^(data|blob|https?):/i.test(path) || path.startsWith('//')) continue;
    refs.set(path.toLowerCase(), m[2].toLowerCase());
  }
  return refs;
}

function pageFilesFromPool(pool, html) {
  const refs = pageReferencedFiles(html);
  if (!refs.size) return [];
  const byPath = new Map();
  const byName = new Map();
  (Array.isArray(pool) ? pool : []).forEach((item) => {
    if (!item?.url) return;
    const folder = String(normalizeMediaEntry(item)?.folder || '').replace(/^\/+|\/+$/g, '');
    const name = item.name || String(item.url).split('?')[0].split('/').pop();
    const entry = { url: item.url, name, type: item.type || 'image', folder };
    const path = `${folder ? `${folder}/` : ''}${name}`.toLowerCase();
    if (!byPath.has(path)) byPath.set(path, entry);
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), entry);
  });
  const out = [];
  const seen = new Set();
  refs.forEach((name, path) => {
    const hit = byPath.get(path) || byName.get(name);
    if (hit && !seen.has(hit.url)) { seen.add(hit.url); out.push(hit); }
  });
  return out;
}

export function siteMediaFolders(pool = [], config = {}) {
  const wanted = siteMediaFolderNames(config);
  const out = {};
  // Library files the page names itself are always there, linked folder or not.
  const own = pageFilesFromPool(pool, config?.spSite?.html);
  if (own.length) out[SITE_PAGE_FILES] = own.slice(0, SITE_MEDIA_MAX_ITEMS);
  // A page with an empty image list of its own and no folder linked gets the
  // library root, so it never falls back to pictures it draws itself.
  if (!wanted.length && findImageSlots(config?.spSite?.html || '').some((slot) => !slot.count)) wanted.push(SITE_MEDIA_ROOT);
  let count = 0;
  (Array.isArray(pool) ? pool : []).forEach((item) => {
    if (!item?.url) return;
    // Same folder the media library shows (an entry may only carry its R2 key).
    const folder = String(normalizeMediaEntry(item)?.folder || '').replace(/^\/+|\/+$/g, '');
    const hit = wanted.find((w) => w !== SITE_MEDIA_ROOT && (folder === w || folder.startsWith(`${w}/`)))
      // Root files are read as SPSite.getMedia('').
      ?? (!folder && wanted.includes(SITE_MEDIA_ROOT) ? '' : undefined);
    if (hit === undefined || count >= SITE_MEDIA_MAX_ITEMS) return;
    count += 1;
    (out[hit] = out[hit] || []).push({ url: item.url, name: item.name || String(item.url).split('?')[0].split('/').pop(), type: item.type || 'image', folder });
  });
  return out;
}

/** Folder names the page asks for with SPSite.getMedia('...') (literal names only). */
export function pageMediaFolderNames(html) {
  const names = new Set();
  const re = /SPSite\s*\.\s*getMedia\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g;
  let m;
  while ((m = re.exec(String(html || '')))) names.add(m[2].replace(/^\/+|\/+$/g, ''));
  return [...names];
}

/**
 * Media for a page whose project library is empty, from the platform preview
 * library (as other surveys get): every folder the page asks for, or the
 * linked ones, holds the whole preview library; a page without
 * SPSite.getMedia gets it at the root, which fills its empty image lists.
 */
export function sitePreviewMediaFolders(pool = [], config = {}) {
  const html = config?.spSite?.html || '';
  const items = (Array.isArray(pool) ? pool : [])
    .filter((item) => item?.url && !/video|audio/i.test(String(item.type || '')))
    .slice(0, SITE_MEDIA_MAX_ITEMS)
    .map((item) => ({ url: item.url, name: item.name || String(item.url).split('?')[0].split('/').pop(), type: item.type || 'image', folder: '' }));
  if (!items.length) return {};
  if (!pageReadsMedia(html)) return { '': items };
  const names = new Set([...pageMediaFolderNames(html), ...siteMediaFolderNames(config).map((f) => (f === SITE_MEDIA_ROOT ? '' : f))]);
  if (!names.size) names.add('');
  const out = {};
  names.forEach((name) => { out[name] = items; });
  return out;
}

/**
 * Validate an answer from the site and merge it into the stored value.
 * `value === null` clears the answer (or the trial).
 * @returns {{ ok: true, stored: any } | { ok: false, reason: string }}
 */
export function applySiteAnswer(question, previous, value, { trial, shown, key } = {}, mediaIndex = null) {
  if (!question) return fail('Unknown question');
  const shownMedia = resolveShown(shown, question, mediaIndex);
  if (key != null || (shown != null && !(question.trialCount > 1 && trial != null))) {
    // A page that runs its own loop (its own media draw) records one entry per
    // answer: { key } updates an earlier entry (same image, same screen),
    // otherwise entries are appended. Values still follow the question's type.
    const next = isTrialsAnswer(previous) ? { trials: previous.trials.map((t) => ({ ...t })) } : { trials: [] };
    const id = key == null ? null : String(key);
    const at = id == null ? -1 : next.trials.findIndex((t) => t.key === id);
    if (value == null) {
      if (at >= 0) next.trials.splice(at, 1);
      return { ok: true, stored: next.trials.length ? next : null };
    }
    const checked = validateSiteAnswer(question, value);
    if (!checked.ok) return fail(`${question.name}: ${checked.reason}`);
    const entry = { value: checked.value, shown_images: mediaSetToShownImages(shownMedia), shown_media_ids: mediaSetToShownIds(shownMedia) };
    if (id != null) entry.key = id;
    if (at >= 0) next.trials[at] = entry;
    else if (next.trials.length >= CUSTOM_ANSWER_MAX_RECORDS) return fail(`${question.name}: more than ${CUSTOM_ANSWER_MAX_RECORDS} records`);
    else next.trials.push(entry);
    return { ok: true, stored: next };
  }
  if (question.trialCount > 1) {
    const index = Number(trial);
    if (!Number.isInteger(index) || index < 0 || index >= question.trialCount) {
      return fail(`${question.name} repeats ${question.trialCount} times: pass { trial: 0…${question.trialCount - 1} }`);
    }
    const slot = question.trials?.[index] || {};
    const next = isTrialsAnswer(previous) && previous.trials.length === question.trialCount
      ? { trials: previous.trials.map((t) => ({ ...t })) }
      : emptyTrials(question.trialCount);
    if (value == null) {
      next.trials[index] = { value: null, shown_images: [], shown_media_ids: [] };
      return { ok: true, stored: next };
    }
    const checked = validateSiteAnswer(question, value, slot.choices);
    if (!checked.ok) return fail(`${question.name} trial ${index}: ${checked.reason}`);
    const media = shownMedia.length ? shownMedia : (slot.media || []);
    next.trials[index] = {
      value: checked.value,
      shown_images: mediaSetToShownImages(media),
      shown_media_ids: mediaSetToShownIds(media),
    };
    return { ok: true, stored: next };
  }
  if (value == null) return { ok: true, stored: null };
  const checked = validateSiteAnswer(question, value);
  if (!checked.ok) return fail(`${question.name}: ${checked.reason}`);
  return { ok: true, stored: checked.value };
}

/**
 * Media the page says it showed, as media items. Names (or URLs) are looked up
 * in the drawn media and the folders the page may draw from; unknown names are
 * kept as names so the record still says what was shown.
 */
function resolveShown(shown, question, mediaIndex) {
  if (shown == null) return [];
  const list = (Array.isArray(shown) ? shown : [shown]).slice(0, 50);
  const known = new Map();
  const add = (m) => { if (m?.url) { known.set(String(m.url), m); if (m.name) known.set(String(m.name).toLowerCase(), m); } };
  (question?.media || []).forEach(add);
  (question?.trials || []).forEach((t) => (t.media || []).forEach(add));
  if (mediaIndex) Object.values(mediaIndex).forEach((items) => (items || []).forEach(add));
  return list.map((item) => {
    const text = typeof item === 'string' ? item : (item?.url || item?.name || '');
    if (!text) return null;
    return known.get(text) || known.get(text.toLowerCase()) || { name: text.split('?')[0].split('/').pop() };
  }).filter(Boolean);
}

function answered(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Required questions (or required trials) that still have no answer. */
export function missingRequired(questions, answers = {}) {
  return (questions || []).filter((q) => q.required && q.kind !== 'display').filter((q) => {
    const value = answers[q.name];
    if (q.trialCount > 1) {
      return !isTrialsAnswer(value) || value.trials.length < q.trialCount || value.trials.some((t) => !answered(t?.value));
    }
    if (q.kind === 'boolean') return typeof value !== 'boolean';
    return !answered(value);
  }).map((q) => q.name);
}

/** Runs first inside the site: defines window.SPSite and talks to the platform. */
export const SP_SITE_SDK_SOURCE = `
(function () {
  var boot = window.__SP_SITE_BOOT__ || null;
  var questions = [], survey = {}, answers = {}, media = {}, ready = false, waiters = [], pending = {}, seq = 0;
  var allowedHosts = (boot && boot.allowedHosts) || [];
  var submitHandlers = [], submitQueue = [];
  function post(msg) { window.parent.postMessage(Object.assign({ source: 'sp-site' }, msg), '*'); }
  // Script errors and failed requests go to the platform (shown in the Builder
  // preview, and fed back to the model when a page is converted).
  var problemCount = 0, seenProblems = {};
  function problem(kind, message) {
    var text = String(message || '').slice(0, 400);
    if (!text || seenProblems[text] || problemCount >= 20) return;
    seenProblems[text] = true; problemCount += 1;
    post({ type: 'problem', kind: kind, message: text });
  }
  window.addEventListener('error', function (e) {
    var el = e && e.target;
    if (el && el !== window && el.tagName) {
      var src = el.currentSrc || el.src || el.href;
      if (src && !/^data:/.test(src)) problem('resource', 'Could not load ' + String(src).slice(0, 200));
      return;
    }
    if (!e) return;
    var err = e.error, text = e.message || '';
    if (err && err.stack) text = String(err.stack).split(String.fromCharCode(10)).slice(0, 2).join(' ');
    else if (err && err.message) text = (err.name ? err.name + ': ' : '') + err.message;
    if (!text) return;
    if (/^Script error[.]?$/.test(text)) text += ' (no details were given; it came from ' + (e.filename || 'a script the browser hides the error of') + ')';
    problem('script', text + (e.lineno ? ' (line ' + e.lineno + ')' : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    problem('script', 'Unhandled promise rejection: ' + String(r && r.message || r));
  });
  function call(type, payload) {
    return new Promise(function (resolve) {
      seq += 1;
      pending[seq] = resolve;
      post(Object.assign({ type: type, requestId: seq }, payload));
    });
  }
  // The sandbox has no origin, so storage throws; give the site an in-memory stand-in.
  ['localStorage', 'sessionStorage'].forEach(function (key) {
    try { window[key].getItem('x'); } catch (err) {
      var data = {};
      var store = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; },
        clear: function () { data = {}; },
        key: function (i) { return Object.keys(data)[i] || null; }
      };
      Object.defineProperty(store, 'length', { get: function () { return Object.keys(data).length; } });
      try { Object.defineProperty(window, key, { value: store, configurable: true }); } catch (e2) { /* keep native */ }
    }
  });

  // Requests to hosts the researcher did not allow never leave the page. Submissions
  // (fetch/XHR/beacon/form posts) are handed to SPSite.onSubmit handlers instead, so a
  // converted survey can map its old "send results" payload onto SPSite.answer.
  // An imported page keeps a <base href> to its original site; otherwise relative
  // URLs belong to the page itself, which has no server here.
  function pageBase() { return /^https?:/.test(document.baseURI) ? document.baseURI : 'https://invalid.local/'; }
  function hostAllowed(url) {
    try { return allowedHosts.indexOf(new URL(url, pageBase()).host) >= 0; } catch (e) { return false; }
  }
  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch (e) { /* not JSON */ }
      if (/^[^=&\\s]+=[^&]*(&[^=&\\s]+=[^&]*)*$/.test(body)) {
        var out = {}; new URLSearchParams(body).forEach(function (v, k) { out[k] = v; }); return out;
      }
      return body;
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var fd = {}; body.forEach(function (v, k) { fd[k] = typeof v === 'string' ? v : '[file]'; }); return fd;
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      var sp = {}; body.forEach(function (v, k) { sp[k] = v; }); return sp;
    }
    return body;
  }
  // With no onSubmit handler the platform keeps the request itself, so a page
  // whose data the adapter could not map still loses nothing.
  function dispatch(item) {
    if (!submitHandlers.length) {
      submitQueue.push(item);
      post({ type: 'capture', request: { kind: item.kind, url: item.url, method: item.method, data: item.data } });
      return;
    }
    submitHandlers.forEach(function (fn) { try { fn(item); } catch (err) { console.error(err); } });
  }
  function capture(kind, url, method, body) {
    dispatch({ kind: kind, url: String(url || ''), method: String(method || 'POST').toUpperCase(), data: parseBody(body) });
  }
  // SPSite.onRequest handlers can answer the page's own requests (a converted page
  // that loaded its questions from, or saved answers to, its own server). Requests
  // made before the adapter script has run wait for it (DOMContentLoaded).
  var requestHandlers = [], dataFiles = null;
  var adaptersReady = new Promise(function (resolve) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(resolve, 0); });
    else resolve();
  });
  // Same-page paths stay relative ("/api/state?x=1"); other hosts keep their full URL.
  function absolute(url) {
    try {
      var base = new URL(pageBase()), u = new URL(url, base);
      return u.host === base.host ? u.pathname + u.search : u.href;
    } catch (e) { return String(url || ''); }
  }
  // A request the adapter never answers would leave the page waiting forever
  // (for example stuck on "Loading…"); it fails after a while instead, and the
  // platform hears about it so the Builder can show what went wrong.
  var netSeq = 0, REQUEST_TIMEOUT_MS = 15000;
  function answerRequest(req) {
    var id = (netSeq += 1), timer = null, label = req.method + ' ' + req.url;
    post({ type: 'net', phase: 'start', id: id, method: req.method, url: req.url });
    var work = adaptersReady.then(function () {
      for (var i = 0; i < requestHandlers.length; i += 1) {
        var out;
        try { out = requestHandlers[i](req); } catch (err) { console.error('[SPSite] onRequest handler failed', err); return { status: 500, json: { error: String(err && err.message || err) } }; }
        if (out !== undefined) return Promise.resolve(out).then(function (r) { return r === undefined || r === null ? { status: 200, json: { ok: true } } : r; });
      }
      return undefined;
    });
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () {
        var message = label + ' got no answer within ' + (REQUEST_TIMEOUT_MS / 1000) + ' s: the SPSite.onRequest handler never finished.';
        console.error('[SPSite] ' + message);
        problem('request', message);
        resolve({ status: 504, json: { error: message } });
      }, REQUEST_TIMEOUT_MS);
    });
    return Promise.race([work, timeout]).then(function (r) {
      clearTimeout(timer);
      // Backup copy: whatever the page sends is kept raw, even when the adapter
      // answered it, so an adapter that forgets SPSite.answer loses nothing.
      if (r !== undefined && !/^(GET|HEAD)$/.test(req.method)) {
        post({ type: 'capture', request: { kind: req.kind, url: req.url, method: req.method, data: req.data, answered: true } });
      }
      var status = r === undefined ? 0 : responseParts(r).status;
      post({ type: 'net', phase: 'end', id: id, status: status });
      if (r === undefined && /^(GET|HEAD)$/.test(req.method)) {
        problem('request', label + ' was blocked: no SPSite.onRequest handler answered it and its domain is not allowed.');
      } else if (status >= 400 && status !== 504) {
        problem('request', label + ' answered ' + status + ': ' + responseParts(r).body.slice(0, 200));
      }
      return r;
    }, function (err) {
      clearTimeout(timer);
      post({ type: 'net', phase: 'end', id: id, status: 0 });
      problem('request', label + ' failed: ' + String(err && err.message || err));
      throw err;
    });
  }
  function responseParts(r) {
    // A response wrapper is { json } or { body } (with optional status/contentType),
    // or a bare numeric status. Anything else is data, even if it has a 'status' field.
    var isRaw = !!r && typeof r === 'object' && !Array.isArray(r) && ('json' in r || 'body' in r || (typeof r.status === 'number' && Object.keys(r).length === 1));
    var status = isRaw && typeof r.status === 'number' && r.status >= 200 && r.status <= 599 ? r.status : 200;
    var raw = isRaw && !('json' in r) ? r.body : undefined;
    var body = isRaw ? ('json' in r ? JSON.stringify(r.json) : (raw == null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw))) : JSON.stringify(r);
    var type = isRaw && !('json' in r) && r.contentType ? r.contentType : 'application/json';
    return { status: status, body: body, type: type };
  }
  function headersOf(init) {
    var out = {};
    var h = init && init.headers;
    if (!h) return out;
    if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach(function (v, k) { out[k] = v; });
    else Object.keys(h).forEach(function (k) { out[k] = h[k]; });
    return out;
  }
  // Many standalone pages keep their answers in localStorage, which a sandboxed
  // page cannot use. Give it a working in-memory store and send each saved value
  // to the platform, which keeps the latest copy on the response.
  var stateTimers = {};
  function sendState(area, key, value) {
    var id = area + ':' + key;
    clearTimeout(stateTimers[id]);
    stateTimers[id] = setTimeout(function () { post({ type: 'state', area: area, key: String(key), value: value }); }, 300);
  }
  function memoryStorage(area) {
    var data = {};
    var store = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { k = String(k); data[k] = String(v); sendState(area, k, data[k]); },
      removeItem: function (k) { k = String(k); delete data[k]; sendState(area, k, null); },
      clear: function () { Object.keys(data).forEach(function (k) { delete data[k]; sendState(area, k, null); }); },
      key: function (i) { return Object.keys(data)[i] || null; },
    };
    Object.defineProperty(store, 'length', { get: function () { return Object.keys(data).length; } });
    return store;
  }
  ['localStorage', 'sessionStorage'].forEach(function (area) {
    try { Object.defineProperty(window, area, { configurable: true, value: memoryStorage(area) }); } catch (e) { /* keep the browser's own */ }
  });
  // A page that offers its results as a file download (CSV, JSON): keep the file's text.
  // (The page's CSP blocks fetching blob: URLs, so the blob is remembered when its URL is made.)
  var blobsByUrl = {};
  if (window.URL && URL.createObjectURL) {
    var nativeCreateUrl = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      var url = nativeCreateUrl.apply(URL, arguments);
      if (obj && typeof obj.text === 'function') blobsByUrl[url] = obj;
      return url;
    };
  }
  function downloadText(href) {
    if (blobsByUrl[href]) return blobsByUrl[href].text();
    var m = /^data:([^,]*),(.*)$/i.exec(href);
    if (!m) return Promise.reject(new Error('unreadable'));
    return Promise.resolve(/;base64/i.test(m[1]) ? decodeURIComponent(escape(atob(m[2]))) : decodeURIComponent(m[2]));
  }
  var nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var href = this.href || '', name = this.getAttribute('download');
    if (name != null && /^(blob|data):/i.test(href)) {
      downloadText(href).then(function (text) {
        text = String(text);
        post({ type: 'capture', request: { kind: 'download', url: name || 'download', method: 'FILE', data: text.length > 400000 ? text.slice(0, 400000) : text } });
      }).catch(function () {});
      return undefined;
    }
    return nativeAnchorClick.apply(this, arguments);
  };
  var nativeFetch = window.fetch && window.fetch.bind(window);
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (hostAllowed(url)) return nativeFetch(input, init);
      var req = { kind: 'fetch', url: absolute(url), method: method, data: parseBody(init && init.body), headers: headersOf(init) };
      return answerRequest(req).then(function (r) {
        if (r !== undefined) { var p = responseParts(r); return new Response(/^(204|205|304)$/.test(String(p.status)) ? null : p.body, { status: p.status, headers: { 'Content-Type': p.type } }); }
        if (/^(GET|HEAD)$/.test(method)) throw new TypeError('SP-Survey blocked a request to ' + url);
        dispatch(req);
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    };
  }
  if (window.XMLHttpRequest) {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this.__sp = { method: String(method || 'GET').toUpperCase(), url: url }; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
      var info = this.__sp || {};
      if (hostAllowed(info.url)) return send.apply(this, arguments);
      var xhr = this;
      var req = { kind: 'xhr', url: absolute(info.url), method: info.method || 'GET', data: parseBody(body), headers: {} };
      function finish(status, text) {
        ['readyState', 'status', 'responseText', 'response'].forEach(function (k) {
          Object.defineProperty(xhr, k, { configurable: true, value: { readyState: 4, status: status, responseText: text, response: text }[k] });
        });
        ['readystatechange', 'load', 'loadend'].forEach(function (type) {
          var ev = new Event(type); xhr.dispatchEvent(ev);
          if (typeof xhr['on' + type] === 'function') xhr['on' + type](ev);
        });
      }
      answerRequest(req).then(function (r) {
        if (r !== undefined) { var p = responseParts(r); finish(p.status, p.body); return; }
        if (/^(GET|HEAD)$/.test(req.method)) { var ev = new Event('error'); xhr.dispatchEvent(ev); if (typeof xhr.onerror === 'function') xhr.onerror(ev); return; }
        dispatch(req);
        finish(200, '{"ok":true}');
      });
    };
  }
  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url, data) { if (!hostAllowed(url)) capture('beacon', url, 'POST', data); return true; };
  }
  function formData(form) { var out = {}; new FormData(form).forEach(function (v, k) { out[k] = typeof v === 'string' ? v : '[file]'; }); return out; }
  HTMLFormElement.prototype.submit = function () {
    dispatch({ kind: 'form', url: String(this.action || ''), method: String(this.method || 'GET').toUpperCase(), data: formData(this) });
  };
  window.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    var form = e.target;
    dispatch({ kind: 'form', url: String(form.action || ''), method: String(form.method || 'GET').toUpperCase(), data: formData(form) });
  });

  // A page that loaded images from its own server ("/image/101?session=…") has no
  // such server here: a same-site image URL naming a drawn file (by file name, or
  // name without extension, in its path or query) shows that file instead.
  var mediaByKey = {};
  function indexMedia() {
    mediaByKey = {};
    function add(url, name) {
      if (!url || !name) return;
      var n = String(name).toLowerCase();
      mediaByKey[n] = url;
      mediaByKey[n.replace(/[.][a-z0-9]+$/, '')] = url;
    }
    function addMedia(m) { if (m) add(m.url, m.name); }
    Object.keys(media).forEach(function (folder) { (media[folder] || []).forEach(addMedia); });
    questions.forEach(function (q) {
      (q.media || []).forEach(addMedia);
      (q.trials || []).forEach(function (t) { (t.media || []).forEach(addMedia); });
    });
  }
  function mappedMedia(value) {
    if (typeof value !== 'string' || !value || /^(data|blob):/i.test(value)) return null;
    var u, base;
    try { u = new URL(value, document.baseURI); base = new URL(document.baseURI); } catch (e) { return null; }
    if (u.host !== base.host) return null;
    var parts = u.pathname.split('/').filter(Boolean).reverse();
    u.searchParams.forEach(function (v) { parts.push(v); });
    for (var i = 0; i < parts.length; i += 1) {
      var key;
      try { key = decodeURIComponent(parts[i]).toLowerCase(); } catch (e) { key = parts[i].toLowerCase(); }
      if (mediaByKey[key]) return mediaByKey[key];
    }
    return null;
  }
  [window.HTMLImageElement, window.HTMLSourceElement, window.HTMLMediaElement].forEach(function (Type) {
    var desc = Type && Object.getOwnPropertyDescriptor(Type.prototype, 'src');
    if (!desc || !desc.set) return;
    Object.defineProperty(Type.prototype, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) { desc.set.call(this, mappedMedia(String(v)) || v); }
    });
  });
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'src' && /^(IMG|SOURCE|VIDEO|AUDIO)$/.test(this.tagName)) {
      return setAttr.call(this, name, mappedMedia(String(value)) || value);
    }
    return setAttr.apply(this, arguments);
  };
  function remapTree(root) {
    if (!root || !root.querySelectorAll) return;
    var list = [root].concat(Array.prototype.slice.call(root.querySelectorAll('img[src],source[src],video[src],audio[src]')));
    list.forEach(function (el) {
      if (!/^(IMG|SOURCE|VIDEO|AUDIO)$/.test(el.tagName || '')) return;
      var mapped = mappedMedia(el.getAttribute('src'));
      if (mapped) setAttr.call(el, 'src', mapped);
    });
    // Inline background images: style="background-image:url(images/a.jpg)".
    var styled = [root].concat(Array.prototype.slice.call(root.querySelectorAll('[style*="url("]')));
    styled.forEach(function (el) {
      var style = el.getAttribute && el.getAttribute('style');
      if (!style || style.indexOf('url(') < 0) return;
      var next = style.replace(/url\\(\\s*(["']?)([^"')]+)\\1\\s*\\)/g, function (all, q, ref) {
        var mapped = mappedMedia(ref);
        return mapped ? 'url("' + mapped + '")' : all;
      });
      if (next !== style) setAttr.call(el, 'style', next);
    });
  }
  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      records.forEach(function (r) { Array.prototype.forEach.call(r.addedNodes || [], remapTree); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function detail() { return { questions: questions, survey: survey, answers: answers }; }
  function fire() {
    var d = detail();
    waiters.splice(0).forEach(function (cb) { try { cb(d); } catch (err) { console.error(err); } });
    document.dispatchEvent(new CustomEvent('spsite-ready', { detail: d }));
  }
  function whenDom(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  if (boot) {
    // Questions and media are known before the page's own scripts run.
    questions = boot.questions || []; survey = boot.survey || {}; answers = boot.answers || {}; media = boot.media || {};
    indexMedia();
    ready = true;
    whenDom(fire);
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || d.source !== 'sp-site-host') return;
    if (d.type === 'init') {
      if (ready) return;
      questions = d.questions || []; survey = d.survey || {}; answers = d.answers || {}; media = d.media || {};
      indexMedia();
      ready = true;
      whenDom(fire);
    } else if (d.type === 'result' && pending[d.requestId]) {
      var resolve = pending[d.requestId];
      delete pending[d.requestId];
      if (d.result && d.result.ok && d.name) answers[d.name] = d.stored;
      if (d.result && !d.result.ok) console.warn('[SPSite]', d.result.error || d.result.missing);
      resolve(d.result);
    }
  });
  window.SPSite = {
    version: '${SP_SITE_VERSION}',
    platform: true,
    allowedHosts: allowedHosts.slice(),
    onReady: function (cb) { if (ready) cb(detail()); else waiters.push(cb); },
    getQuestions: function () { return questions; },
    getQuestion: function (name) { for (var i = 0; i < questions.length; i += 1) if (questions[i].name === name) return questions[i]; return null; },
    getSurvey: function () { return survey; },
    getAnswers: function () { return answers; },
    getData: function (name) {
      // The study's own data files (config.json, a CSV) that came with the page.
      if (!dataFiles) { try { var el = document.getElementById('sp-data'); dataFiles = el ? JSON.parse(el.textContent || '{}') : {}; } catch (e) { dataFiles = {}; } }
      var key = String(name || '').replace(/^[.]?[/]+/, '');
      var hit = dataFiles[key] != null ? key : Object.keys(dataFiles).filter(function (k) { return k.split('/').pop() === key.split('/').pop(); })[0];
      if (hit == null) return null;
      var text = dataFiles[hit];
      if (/[.]json$/i.test(hit)) { try { return JSON.parse(text); } catch (e) { return text; } }
      return text;
    },
    getMedia: function (folder) {
      if (folder === undefined) { var all = {}; Object.keys(media).forEach(function (k) { all[k] = media[k].slice(); }); return all; }
      var key = String(folder || '').replace(/^[/]+|[/]+$/g, '');
      if (media[key]) return media[key].slice();
      var hit = Object.keys(media).filter(function (k) { return k === key || k.slice(-(key.length + 1)) === '/' + key; })[0];
      return hit ? media[hit].slice() : [];
    },
    answer: function (name, value, options) {
      var o = options || {};
      return call('answer', { name: name, value: value === undefined ? null : value, trial: o.trial, shown: o.shown, key: o.key });
    },
    imageSlot: function (name, fallback) {
      // A page's own image list (e.g. PHOTO_URLS). Files the page names itself
      // stay (the library is its folder); an empty list is filled with the
      // linked folders' images in a random order for each participant, so the
      // page shows library images instead of drawing its own. Which images went
      // in, in that order, is kept with the response.
      if (fallback && fallback.length) return fallback;
      var items = [];
      Object.keys(media).sort().forEach(function (k) {
        if (k === '__page_files__') return;
        media[k].forEach(function (m) { if (!/video|audio/i.test(String(m.type || ''))) items.push(m); });
      });
      if (!items.length) return fallback;
      for (var i = items.length - 1; i > 0; i -= 1) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
      }
      sendState('sp-media', name, JSON.stringify(items.map(function (m) { return { name: m.name, url: m.url, folder: m.folder }; })));
      return items.map(function (m) { return m.url; });
    },
    complete: function () { return call('complete', {}); },
    onRequest: function (fn) { requestHandlers.push(fn); },
    onSubmit: function (fn) {
      submitHandlers.push(fn);
      submitQueue.splice(0).forEach(function (item) { try { fn(item); } catch (err) { console.error(err); } });
    }
  };
  post({ type: 'hello' });
})();
`;

function escapeScript(text) {
  return String(text).replace(/<\/script/gi, '<\\/script');
}

/** CSP for one site; allowed hosts may serve scripts, styles, fonts and data. */
export function buildSiteCsp(allowedHosts = []) {
  const extra = normalizeAllowedHosts(allowedHosts).map((h) => `https://${h}`);
  const hosts = [...CDN_HOSTS, ...extra].join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${hosts}`,
    `style-src 'unsafe-inline' https://fonts.googleapis.com ${hosts}`,
    `font-src data: https://fonts.gstatic.com ${hosts}`,
    'img-src https: data: blob:',
    'media-src https: data: blob:',
    extra.length ? `connect-src ${extra.join(' ')}` : "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    'worker-src blob:',
  ].join('; ');
}

// A name holds pictures when one of its words says so: PHOTO_URLS, imageList,
// pics, stimuli; not "pick" or "picker", which a loose /pic/ would match.
const IMAGE_SLOT_WORD_RE = /^(photo|image|img|stimul|media)|^(pic|pics|picture|pictures)$/;
function isImageSlotName(name) {
  return String(name || '').replace(/([a-z\d])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/).some((word) => IMAGE_SLOT_WORD_RE.test(word.toLowerCase()));
}
// An array literal holding only quoted strings (or nothing).
const IMAGE_SLOT_ITEMS_RE = /^\s*(?:(?:'[^'\n]*'|"[^"\n]*")\s*,?\s*)*$/;
const IMAGE_SLOT_RE = /\b(const|let|var)(\s+)([A-Za-z_$][\w$]*)(\s*=\s*)\[([^[\]]*)\]/g;
const INLINE_SCRIPT_RE = /(<script\b(?![^>]*\bsrc\s*=)[^>]*>)([\s\S]*?)(<\/script>)/gi;

function pageReadsMedia(html) {
  return /SPSite\s*\.\s*getMedia\s*\(/.test(String(html || ''));
}

/**
 * Image lists a page keeps in its own code (`const PHOTO_URLS = []`): plain
 * arrays of URL strings whose name says they hold pictures. A page that does
 * not read SPSite.getMedia can still use the media library through them.
 */
export function findImageSlots(html) {
  const text = String(html || '');
  if (pageReadsMedia(text)) return [];
  const slots = [];
  text.replace(INLINE_SCRIPT_RE, (all, open, body) => {
    body.replace(IMAGE_SLOT_RE, (m, kw, sp, name, eq, items) => {
      if (isImageSlotName(name) && IMAGE_SLOT_ITEMS_RE.test(items)) {
        slots.push({ name, count: (items.match(/'[^'\n]*'|"[^"\n]*"/g) || []).length });
      }
      return m;
    });
    return all;
  });
  return slots;
}

/** Fill the page's image lists from the linked media folders (its own list when none). */
export function linkImageSlots(html) {
  const text = String(html || '');
  if (pageReadsMedia(text)) return text;
  return text.replace(INLINE_SCRIPT_RE, (all, open, body, close) => open + body.replace(IMAGE_SLOT_RE, (m, kw, sp, name, eq, items) => {
    if (!isImageSlotName(name) || !IMAGE_SLOT_ITEMS_RE.test(items)) return m;
    const list = `[${items}]`;
    return `${kw}${sp}${name}${eq}(window.SPSite && SPSite.imageSlot ? SPSite.imageSlot(${JSON.stringify(name)}, ${list}) : ${list})`;
  }) + close);
}

/**
 * Insert the CSP, the start-up data and the SDK at the top of <head> so they
 * run before the site's own code.
 */
/**
 * A script that makes Math.random repeatable (mulberry32). Used for card
 * covers so a page that draws its own random images looks the same on every
 * load; never used for participants.
 */
export function seededRandomScript(seed) {
  const s = (Number(seed) >>> 0) || 1;
  return `<script>(function(){var a=${s};Math.random=function(){a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();</script>`;
}

export function prepareSiteDocument(html, { boot = null, allowedHosts = [], randomSeed = null } = {}) {
  const hasMedia = Boolean(boot?.media && Object.values(boot.media).some((list) => list?.length));
  const source = hasMedia ? linkImageSlots(stripSitePreviewShim(html)) : stripSitePreviewShim(html);
  const hosts = normalizeAllowedHosts(allowedHosts);
  const bootData = boot ? { ...boot, allowedHosts: hosts } : (hosts.length ? { allowedHosts: hosts } : null);
  const inject = `<meta http-equiv="Content-Security-Policy" content="${buildSiteCsp(hosts)}">`
    + (randomSeed != null ? seededRandomScript(randomSeed) : '')
    + (bootData ? `<script>window.__SP_SITE_BOOT__=${JSON.stringify(bootData).replace(/</g, '\\u003c')};</script>` : '')
    + `<script>${escapeScript(SP_SITE_SDK_SOURCE)}</script>`;
  const head = source.match(/<head\b[^>]*>/i);
  if (head) return source.slice(0, head.index + head[0].length) + inject + source.slice(head.index + head[0].length);
  const htmlTag = source.match(/<html\b[^>]*>/i);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${source.slice(0, at)}<head>${inject}</head>${source.slice(at)}`;
  }
  const doctype = source.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return doctype[0] + inject + source.slice(doctype[0].length);
  return inject + source;
}

/** Config without the site page itself, for places that only need the questions (AI assistant context). */
export function withoutSiteHtml(config) {
  if (!config?.spSite?.html) return config;
  const { html, ...meta } = config.spSite;
  return { ...config, spSite: { ...meta, note: 'Participant page built with SP-Scheme; kept by the platform and not editable here.' } };
}
