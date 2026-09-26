import { union } from 'polygon-clipping';
/**
 * Image features in configured Supabase Storage (R2-compatible keys).
 * Paths: {r2Prefix}features/{model}.csv
 * Pre-annotations: {r2Prefix}preannotations/{safeId}.json
 * Rows keyed by media_id; also keep `name` for remapping when keys change on copy.
 */
import {
  uploadImageToR2,
  listImagesFromR2,
  isR2Configured,
  copyImagesInR2,
  getMediaStoragePublicUrl,
  downloadStorageText,
  getR2ServerUrl,
  isR2ProxyUnreachable,
  noteR2ProxyFailure,
} from './r2';
import { featureStorageKey } from './imageFeaturesStore';
import { L0_MODEL } from './imageFeaturesL0';
import { SEG_MODEL } from './falInference';
import { getMediaId, normalizeMediaEntry, mediaRelativePath } from './mediaUtils';


/** SAM3 researcher pre-annotation derived features. */
export const SAM_PREANNOT_MODEL = 'sp_sam_preannot_v1';

export const DEFAULT_SAM_LABELS = [
  'tree', 'building', 'sky', 'road', 'person', 'vehicle',
];

export const FEATURE_MODELS = [L0_MODEL, SEG_MODEL, SAM_PREANNOT_MODEL];

/** Shape provenance sources. */
export const SHAPE_SOURCE_MANUAL = 'manual';
export const SHAPE_SOURCE_SAM_TEXT = 'sam-text';
export const SHAPE_SOURCE_SAM_CLICK = 'sam-click';
export const SHAPE_SOURCE_SAM_BOX = 'sam-box';

export function normalizeR2Prefix(prefix) {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

export function featureCsvKey(r2Prefix, model) {
  return `${normalizeR2Prefix(r2Prefix)}features/${model}.csv`;
}

export function featureCsvPublicUrl(r2Prefix, model) {
  try {
    return getMediaStoragePublicUrl(featureCsvKey(r2Prefix, model));
  } catch {
    return null;
  }
}

/**
 * Legacy basename-only id (collides across folders). Kept for read fallback.
 * Prefer preannotationSafeIdPath for new writes.
 */
export function preannotationSafeId(mediaEntryOrId, nameHint = '') {
  const entry = typeof mediaEntryOrId === 'object'
    ? normalizeMediaEntry(mediaEntryOrId)
    : null;
  const raw = entry?.name || nameHint || entry?.media_id || String(mediaEntryOrId || '');
  const base = String(raw).split('/').pop() || 'media';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'media';
}

/**
 * Folder-aware safe id: `street__a__img.jpg` so nested files don't collide.
 */
export function preannotationSafeIdPath(mediaEntryOrId, nameHint = '') {
  const entry = typeof mediaEntryOrId === 'object'
    ? normalizeMediaEntry(mediaEntryOrId)
    : null;
  const rel = entry
    ? mediaRelativePath(entry.folder, entry.name || nameHint)
    : String(nameHint || mediaEntryOrId || '');
  const cleaned = String(rel || 'media')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9._/-]+/g, '_')
    .replace(/\//g, '__');
  return cleaned || preannotationSafeId(mediaEntryOrId, nameHint);
}

export function preannotationKey(r2Prefix, mediaEntryOrId, nameHint = '', { legacy = false, pathLegacy = false } = {}) {
  if (!legacy && !pathLegacy && typeof mediaEntryOrId === 'object') {
    const entry = normalizeMediaEntry(mediaEntryOrId);
    const id = getMediaId(entry);
    if (id) return `${normalizeR2Prefix(r2Prefix)}preannotations/by-id/${encodeURIComponent(id).replace(/~/g, '%7E').replace(/%/g, '~')}.json`;
  }
  const id = legacy
    ? preannotationSafeId(mediaEntryOrId, nameHint)
    : preannotationSafeIdPath(mediaEntryOrId, nameHint);
  return `${normalizeR2Prefix(r2Prefix)}preannotations/${id}.json`;
}

export function preannotationPublicUrl(r2Prefix, mediaEntryOrId, nameHint = '', opts = {}) {
  try {
    return getMediaStoragePublicUrl(preannotationKey(r2Prefix, mediaEntryOrId, nameHint, opts));
  } catch {
    return null;
  }
}

export function batchRunKey(r2Prefix, batchRunId) {
  const id = String(batchRunId || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'batch';
  return `${normalizeR2Prefix(r2Prefix)}preannotation_batches/${id}.json`;
}

export function batchRunPublicUrl(r2Prefix, batchRunId) {
  try {
    return getMediaStoragePublicUrl(batchRunKey(r2Prefix, batchRunId));
  } catch {
    return null;
  }
}

export function newBatchRunId() {
  return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newShapeId() {
  return `shp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Attach provenance fields to a new shape (backward compatible). */
export function withShapeProvenance(shape, {
  source = SHAPE_SOURCE_MANUAL,
  prompt = null,
  batchRunId = null,
  model = null,
  score = null,
} = {}) {
  return {
    ...shape,
    source: shape.source || source,
    prompt: prompt != null ? prompt : (shape.prompt ?? null),
    batchRunId: batchRunId != null ? batchRunId : (shape.batchRunId ?? null),
    createdAt: shape.createdAt || new Date().toISOString(),
    model: model != null ? model : (shape.model ?? null),
    score: score != null ? score : (shape.score ?? null),
  };
}

export function samLabelKey(label) {
  // A lossless UTF-8/Unicode escape for non-canonical labels; English legacy keys stay readable.
  const value = String(label || '').trim() || 'unlabeled';
  if (/^[a-z][a-z0-9_]*$/.test(value) && !value.startsWith('u_')) return value;
  return `u_${Array.from(value).map((c) => c.codePointAt(0).toString(16)).join('_')}`;
}

function shapePolygon(shape) {
  const pts = (shape?.points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const tool = shape?.tool || (pts.length >= 3 ? 'polygon' : 'point');
  if (tool === 'bbox' && pts.length >= 2) {
    const x = pts.map((p) => p.x), y = pts.map((p) => p.y);
    return [[[Math.min(...x), Math.min(...y)], [Math.max(...x), Math.min(...y)],
      [Math.max(...x), Math.max(...y)], [Math.min(...x), Math.max(...y)], [Math.min(...x), Math.min(...y)]]];
  }
  if (['polygon', 'region'].includes(tool) && pts.length >= 3) {
    const ring = pts.map((p) => [p.x, p.y]);
    return [[...ring, ring[0]]];
  }
  return null;
}

function unionArea(shapes) {
  const polygons = shapes.map(shapePolygon).filter(Boolean);
  if (!polygons.length) return 0;
  const merged = union(...polygons);
  return Math.min(1, Math.max(0, merged.reduce((sum, polygon) => sum + polygon.reduce((area, ring, i) =>
    area + (i ? -1 : 1) * polygonAreaNorm(ring.map(([x, y]) => ({ x, y }))), 0), 0)));
}

function polygonAreaNorm(pts) {
  if (!pts || pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function shapeAreaRatio(shape) {
  const pts = shape?.points || [];
  if (!pts.length) return 0;
  const raw = shape.tool
    || (pts.length >= 3 ? 'polygon' : pts.length === 2 ? 'line' : 'point');
  const tool = raw === 'region' ? 'polygon' : raw;
  if (tool === 'bbox' && pts.length >= 2) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const w = Math.max(0, Math.max(...xs) - Math.min(...xs));
    const h = Math.max(0, Math.max(...ys) - Math.min(...ys));
    return w * h;
  }
  if (tool === 'polygon' && pts.length >= 3) return polygonAreaNorm(pts);
  return 0;
}

/** Derive sp_sam_preannot_v1 feature record from annotation shapes. */
export function deriveSamPreannotFeatures(shapes = [], { mediaId, name, labels = [], reviewStatus = null, updatedAt = null } = {}) {
  const list = Array.isArray(shapes) ? shapes : [];
  const features = {
    sam_shape_count: list.length,
    sam_total_mask_ratio: unionArea(list),
    sam_area_sum: list.reduce((sum, shape) => sum + shapeAreaRatio(shape), 0),
  };
  const dictionary = {};
  const byLabel = new Map();
  [...labels.map((l) => typeof l === 'string' ? l : l.name), ...list.map((s) => s.label || 'unlabeled')].filter(Boolean).forEach((label) => {
    const key = samLabelKey(label);
    dictionary[key] = label;
    if (!byLabel.has(key)) byLabel.set(key, []);
  });
  list.forEach((shape) => byLabel.get(samLabelKey(shape.label || 'unlabeled')).push(shape));
  byLabel.forEach((items, key) => {
    features[`sam_count_${key}`] = items.length;
    features[`sam_ratio_${key}`] = unionArea(items);
    features[`sam_area_sum_${key}`] = items.reduce((sum, shape) => sum + shapeAreaRatio(shape), 0);
  });
  return {
    model: SAM_PREANNOT_MODEL, media_id: mediaId || '', name: name || '', status: 'ready',
    compute_runtime: 'annotation_geometry_v2', computed_at: updatedAt || new Date().toISOString(),
    review_status: reviewStatus || 'unreviewed', feature_version: '2', label_dictionary: dictionary,
    features,
  };
}

function escapeCsv(value) {
  if (value == null) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsv(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const records = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some((v) => v !== '')) records.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Invalid feature CSV: unterminated quoted field');
  if (cell || row.length) { row.push(cell); records.push(row); }
  const headers = records.shift() || [];
  return { headers, rows: records.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))) };
}

export function recordsToCsv(records) {
  const meta = ['media_id', 'name', 'status', 'computed_at', 'compute_runtime', 'error', 'review_status', 'feature_version', 'label_dictionary'];
  const featureKeys = new Set();
  records.forEach((r) => {
    Object.keys(r.features || {}).forEach((k) => featureKeys.add(k));
  });
  const featCols = [...featureKeys].sort();
  const headers = [...meta, ...featCols];
  const lines = [headers.join(',')];
  records.forEach((r) => {
    const row = {
      media_id: r.media_id || '',
      name: r.name || '',
      status: r.status || 'ready',
      computed_at: r.computed_at || '',
      compute_runtime: r.compute_runtime || '',
      error: r.error || '',
      review_status: r.review_status || '', feature_version: r.feature_version || '', label_dictionary: r.label_dictionary || {},
      ...(r.features || {}),
    };
    lines.push(headers.map((h) => escapeCsv(row[h])).join(','));
  });
  return `${lines.join('\n')}\n`;
}

function csvRowsToRecords(rows, model) {
  const meta = new Set(['media_id', 'name', 'status', 'computed_at', 'compute_runtime', 'error', 'review_status', 'feature_version', 'label_dictionary']);
  return rows.map((row) => {
    const features = {};
    Object.keys(row).forEach((k) => {
      if (meta.has(k)) return;
      const raw = row[k];
      if (raw === '' || raw == null) return;
      const n = Number(raw);
      features[k] = Number.isFinite(n) && String(raw).trim() !== '' ? n : raw;
    });
    return {
      media_id: row.media_id || '',
      name: row.name || '',
      model,
      status: row.status || (Object.keys(features).length ? 'ready' : 'missing'),
      computed_at: row.computed_at || null,
      compute_runtime: row.compute_runtime || null,
      error: row.error || null,
      review_status: row.review_status || null, feature_version: row.feature_version || null,
      label_dictionary: row.label_dictionary ? JSON.parse(row.label_dictionary) : {},
      features,
    };
  }).filter((r) => r.media_id || r.name);
}

async function fetchViaProxy(url) {
  // Feature CSVs / preannotation JSON are rewritten during batch jobs. Never use
  // the browser HTTP cache here — a stale snapshot causes saveFeatureCsv merges
  // to drop earlier batches (looks like "only a few finished" after refresh).
  // Prefer direct public R2 fetch so CRA-only local dev (no Express :3001) works.
  try {
    const direct = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (direct.status === 404) return null;
    if (direct.ok) return direct.text();
  } catch {
    /* CORS or network — fall through to API proxy */
  }

  if (isR2ProxyUnreachable()) throw new Error('Media service unavailable. Retry before editing annotations.');

  const proxyUrl =
    `${getR2ServerUrl()}/api/r2/image-proxy?url=${encodeURIComponent(url)}&_=${Date.now()}`;
  try {
    const res = await fetch(proxyUrl, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    }
    return res.text();
  } catch (err) {
    // Soft-fail when Express/Worker proxy is down — features simply unavailable.
    noteR2ProxyFailure(err, 'image-proxy');
    throw err;
  }
}

/** Load raw feature CSV text from R2 (null if missing). */
async function loadLegacyFeatureCsvText(r2Prefix, model) {
  if (!isR2Configured() || !r2Prefix) return null;
  try {
    return await downloadStorageText(featureCsvKey(r2Prefix, model));
  } catch (err) {
    const msg = err?.message || '';
    if (/404|403|NoSuchKey|not found/i.test(msg)) return null;
    return fetchViaProxy(featureCsvPublicUrl(r2Prefix, model));
  }
}

/** Build SAM features from independent source documents; a shared CSV is only a legacy fallback. */
export async function loadFeatureCsvText(r2Prefix, model) {
  if (model !== SAM_PREANNOT_MODEL) return loadLegacyFeatureCsvText(r2Prefix, model);
  const rows = await loadFeatureCsv(r2Prefix, model);
  return rows.length ? recordsToCsv(rows) : null;
}

const annotationDocumentCache = new Map();
export async function listAnnotationDocuments(r2Prefix, { fresh = false } = {}) {
  const cached = annotationDocumentCache.get(r2Prefix);
  if (!fresh && cached && cached.expires > Date.now()) return cached.promise;
  const promise = fetchAnnotationDocuments(r2Prefix);
  const record = { promise, expires: Date.now() + 10000 };
  annotationDocumentCache.set(r2Prefix, record);
  try { return await promise; }
  catch (err) { if (annotationDocumentCache.get(r2Prefix) === record) annotationDocumentCache.delete(r2Prefix); throw err; }
}

function isR2ListUnavailable(result) {
  const msg = String(result?.error || '');
  return Boolean(
    result?.unreachable
    || /not configured|HTTP 503/i.test(msg)
  );
}

async function fetchAnnotationDocuments(r2Prefix) {
  const prefix = `${normalizeR2Prefix(r2Prefix)}preannotations/`;
  const listed = await listImagesFromR2(prefix);
  const result = listed.success
    ? { ...listed, images: (listed.images || []).filter((f) => /\.json$/i.test(f.key || f.name || '')) }
    : listed;
  if (!result.success) {
    if (isR2ListUnavailable(result)) return [];
    throw new Error(result.error || 'Could not load annotation index');
  }
  return mapWithConcurrency(result.images || [], 8, async (file) => {
    const doc = await fetchJsonUrl(file.url);
    return doc ? { ...doc, storage_key: file.key } : null;
  }).then((docs) => docs.filter(Boolean));
}

export async function loadFeatureCsv(r2Prefix, model) {
  const text = await loadLegacyFeatureCsvText(r2Prefix, model);
  const legacy = text ? csvRowsToRecords(parseCsv(text).rows, model) : [];
  if (model !== SAM_PREANNOT_MODEL || !r2Prefix || !isR2Configured()) return legacy;
  const documents = await listAnnotationDocuments(r2Prefix, { fresh: true });
  const byId = new Map(legacy.map((r) => [r.media_id || r.name, r]));
  // Stable-ID documents take precedence over compatibility paths, regardless of timestamp.
  documents.sort((a, b) => Number(a.storage_key.includes('/by-id/')) - Number(b.storage_key.includes('/by-id/')) || String(a.updated_at).localeCompare(String(b.updated_at)));
  documents.forEach((doc) => {
    if (!doc.media_id) return;
    byId.set(doc.media_id, deriveSamPreannotFeatures(doc.shapes, {
      mediaId: doc.media_id, name: doc.name, labels: doc.labels || [], reviewStatus: doc.review_status, updatedAt: doc.updated_at,
    }));
  });
  return [...byId.values()];
}

/** Merge records by media_id (incoming wins) and upload CSV. */
export async function saveFeatureCsv(r2Prefix, model, records, options = {}) {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  // When the caller already holds the full set (batch job accumulator), skip
  // re-reading R2 so we never merge against a stale cached snapshot.
  const existing = options.replace
    ? []
    : (Array.isArray(options.baseRecords) ? options.baseRecords : await loadFeatureCsv(r2Prefix, model));
  const byId = new Map();
  existing.forEach((r) => {
    if (r.media_id) byId.set(r.media_id, r);
    else if (r.name) byId.set(`name:${r.name}`, r);
  });
  records.forEach((r) => {
    const id = r.media_id || (r.name ? `name:${r.name}` : null);
    if (!id) return;
    byId.set(id, {
      ...r,
      model,
      media_id: r.media_id || '',
    });
  });
  const merged = [...byId.values()];
  const csv = recordsToCsv(merged);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const key = featureCsvKey(r2Prefix, model);
  const result = await uploadImageToR2(blob, key);
  if (!result.success) throw new Error(result.error || 'Failed to upload feature CSV');
  return { success: true, key: result.key, url: result.url, count: merged.length };
}

/** Overwrite the model CSV with the given records (no R2 re-read). */
export async function writeFeatureCsv(r2Prefix, model, records) {
  return saveFeatureCsv(r2Prefix, model, records, { replace: true });
}

/** Upsert one record into R2 CSV for a model. */
export async function upsertFeatureRecordToR2(r2Prefix, record, mediaEntry) {
  const mediaId = record.media_id || getMediaId(mediaEntry);
  const name = mediaEntry?.name || normalizeMediaEntry(mediaEntry)?.name || '';
  return saveFeatureCsv(r2Prefix, record.model, [{
    ...record,
    media_id: mediaId,
    name,
  }]);
}

async function fetchJsonUrl(url) {
  if (!url) return null;
  const text = await fetchViaProxy(url);
  if (text == null) return null;
  try { return JSON.parse(text); }
  catch { throw new Error('Invalid annotation document. Existing data was not overwritten.'); }
}

export async function loadPreannotation(r2Prefix, mediaEntry) {
  if (!isR2Configured() || !r2Prefix) return null;
  const entry = normalizeMediaEntry(mediaEntry);
  const id = getMediaId(entry);
  const primary = await fetchJsonUrl(preannotationPublicUrl(r2Prefix, entry));
  if (primary) return primary;
  // Do not confuse a same-name image with this image. Legacy documents carry source identity.
  const matches = (doc) => doc && (doc.media_id === id || doc.image === entry.url);
  for (const opts of [{ pathLegacy: true }, { legacy: true }]) {
    const doc = await fetchJsonUrl(preannotationPublicUrl(r2Prefix, entry, entry.name, opts));
    if (matches(doc)) return doc;
  }
  // A logical folder move may have left the old annotation path behind.
  const docs = await listAnnotationDocuments(r2Prefix);
  const candidates = docs.filter(matches).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return candidates[0] || null;
}

/** Load batch run log (null if missing). */
export async function loadBatchRun(r2Prefix, batchRunId) {
  if (!isR2Configured() || !r2Prefix || !batchRunId) return null;
  try {
    return await fetchJsonUrl(batchRunPublicUrl(r2Prefix, batchRunId));
  } catch (err) {
    console.warn('loadBatchRun', err);
    return null;
  }
}

/** Persist batch run checkpoint / final log. */
export async function saveBatchRun(r2Prefix, batchDoc) {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const id = batchDoc?.batchRunId || newBatchRunId();
  const doc = {
    ...batchDoc,
    batchRunId: id,
    updated_at: new Date().toISOString(),
    model: SAM_PREANNOT_MODEL,
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const key = batchRunKey(r2Prefix, id);
  const up = await uploadImageToR2(blob, key);
  if (!up.success) throw new Error(up.error || 'Failed to upload batch run');
  return { ...doc, key: up.key, url: up.url };
}

/**
 * Load preannotation JSON for many media entries (concurrency-limited).
 * @returns {Promise<Array<{ mediaEntry: object, annotation: object|null }>>}
 */
export async function loadPreannotationsForMediaList(r2Prefix, mediaEntries, { concurrency = 8 } = {}) {
  const list = (mediaEntries || []).map((m) => normalizeMediaEntry(m)).filter((m) => m?.url || m?.name);
  if (!list.length || !r2Prefix || !isR2Configured()) {
    return list.map((mediaEntry) => ({ mediaEntry, annotation: null }));
  }
  const out = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (cursor < list.length) {
      const i = cursor;
      cursor += 1;
      const mediaEntry = list[i];
      // eslint-disable-next-line no-await-in-loop
      const annotation = await loadPreannotation(r2Prefix, mediaEntry);
      out[i] = { mediaEntry, annotation };
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Save preannotation JSON + derived SAM feature CSV row.
 * Writes path-aware key; also mirrors to legacy basename key when folder is empty
 * (keeps older clients working for root-level files).
 */
export async function savePreannotation(r2Prefix, mediaEntry, annotationPayload) {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const entry = normalizeMediaEntry(mediaEntry);
  const mediaId = getMediaId(entry);
  const shapes = annotationPayload?.shapes || [];
  const doc = {
    media_id: mediaId,
    name: entry?.name || '',
    folder: entry?.folder || '',
    image: entry?.url || annotationPayload?.image || '',
    shapes,
    labels: annotationPayload?.labels || DEFAULT_SAM_LABELS,
    review_status: annotationPayload?.review_status || null,
    updated_at: new Date().toISOString(),
    model: SAM_PREANNOT_MODEL,
  };
  deriveSamPreannotFeatures(shapes, { mediaId, labels: doc.labels });
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const key = preannotationKey(r2Prefix, entry, entry?.name);
  const up = await uploadImageToR2(blob, key);
  if (!up.success) throw new Error(up.error || 'Failed to upload preannotation');
  const cached = annotationDocumentCache.get(r2Prefix);
  if (cached) {
    cached.promise = cached.promise.then((docs) => [...docs.filter((d) => d.storage_key !== key), { ...doc, storage_key: key }]);
    cached.expires = Date.now() + 10000;
  }

  const featureRecord = deriveSamPreannotFeatures(shapes, {
    mediaId, name: entry?.name || '', labels: doc.labels,
    reviewStatus: doc.review_status, updatedAt: doc.updated_at,
  });
  // The source JSON is authoritative. Never race other images by rewriting one shared CSV.
  return { annotation: doc, featureRecord, key: up.key, url: up.url };

}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const out = new Array(list.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency || 8, list.length));
  await Promise.all(Array.from({ length: n }, async () => {
    while (cursor < list.length) {
      const i = cursor;
      cursor += 1;
      // eslint-disable-next-line no-await-in-loop
      out[i] = await worker(list[i], i);
    }
  }));
  return out;
}

/**
 * Undo / cancel a batch: remove shapes added by batchRunId and restore removedSnapshots.
 * @param {{ finalStatus?: 'undone'|'cancelled', concurrency?: number }} opts
 */
export async function undoBatchRun(r2Prefix, batchRunId, {
  labelNames = DEFAULT_SAM_LABELS,
  onProgress,
  onItemSaved,
  finalStatus = 'undone',
  concurrency = 8,
} = {}) {
  const batch = await loadBatchRun(r2Prefix, batchRunId);
  if (!batch) throw new Error('Batch run not found.');
  if (batch.status === 'accepted' || batch.status === 'cancelled' || batch.status === 'undone') {
    throw new Error(`Batch already closed (${batch.status}).`);
  }
  const images = Array.isArray(batch.images) ? batch.images : [];
  onProgress?.({ done: 0, total: Math.max(1, images.length), name: '', phase: 'close' });
  const progress = { done: 0 };
  const results = await mapWithConcurrency(images, concurrency, async (img) => {
    const entry = normalizeMediaEntry({
      name: img.name,
      url: img.url,
      media_id: img.media_id,
      folder: img.folder || '',
    });
    const doc = await loadPreannotation(r2Prefix, entry);
    const shapes = Array.isArray(doc?.shapes) ? doc.shapes : [];
    const addedSet = new Set(img.addedShapeIds || []);
    const hasBatchShapes = shapes.some((s) => s.batchRunId === batchRunId || addedSet.has(s.id));
    const restored = Array.isArray(img.removedShapes) ? img.removedShapes : [];
    if (!hasBatchShapes && !restored.length) {
      progress.done += 1;
      onProgress?.({ done: progress.done, total: images.length, name: entry.name, phase: 'close' });
      return null;
    }
    let next = shapes.filter((s) => !addedSet.has(s.id) && s.batchRunId !== batchRunId);
    if (restored.length) {
      const existingIds = new Set(next.map((s) => s.id));
      restored.forEach((s) => {
        if (s?.id && !existingIds.has(s.id)) next.push(s);
      });
    }
    const saved = await savePreannotation(r2Prefix, entry, {
      image: entry.url || img.url,
      shapes: next,
      labels: labelNames,
      review_status: finalStatus === 'cancelled' ? null : (doc?.review_status || null),
    });
    progress.done += 1;
    onProgress?.({ done: progress.done, total: images.length, name: entry.name, phase: 'close' });
    onItemSaved?.(saved, entry);
    return saved;
  });
  const closedAt = new Date().toISOString();
  const closed = await saveBatchRun(r2Prefix, {
    ...batch,
    status: finalStatus === 'cancelled' ? 'cancelled' : 'undone',
    undone_at: closedAt,
    closed_at: closedAt,
  });
  return { batch: closed, results: results.filter(Boolean) };
}

/**
 * Accept all images touched by a batch (keep polygons, mark review_status accepted, close batch).
 * Writes batch status first so the close is durable, then stamps images in parallel.
 * @param {{ concurrency?: number }} opts
 */
export async function acceptBatchRun(r2Prefix, batchRunId, {
  labelNames = DEFAULT_SAM_LABELS,
  onProgress,
  onItemSaved,
  concurrency = 8,
} = {}) {
  const batch = await loadBatchRun(r2Prefix, batchRunId);
  if (!batch) throw new Error('Batch run not found.');
  if (batch.status === 'accepted' || batch.status === 'cancelled' || batch.status === 'undone') {
    throw new Error(`Batch already closed (${batch.status}).`);
  }
  const closedAt = new Date().toISOString();

  const images = Array.isArray(batch.images) ? batch.images : [];
  const targets = images.filter((i) => (
    (i.status === 'done' || i.status === 'partial')
    && (i.polygonsAdded > 0 || (i.addedShapeIds || []).length)
  ));
  onProgress?.({ done: 0, total: Math.max(1, targets.length), name: '', phase: 'close' });
  const progress = { done: 0 };
  const results = await mapWithConcurrency(targets, concurrency, async (img) => {
    const entry = normalizeMediaEntry({
      name: img.name,
      url: img.url,
      media_id: img.media_id,
      folder: img.folder || '',
    });
    const doc = await loadPreannotation(r2Prefix, entry);
    if (doc?.review_status === 'accepted') {
      progress.done += 1;
      onProgress?.({ done: progress.done, total: targets.length, name: entry.name, phase: 'close' });
      return null;
    }
    const saved = await savePreannotation(r2Prefix, entry, {
      image: entry.url || img.url || doc?.image,
      shapes: Array.isArray(doc?.shapes) ? doc.shapes : [],
      labels: labelNames.length ? labelNames : (doc?.labels || DEFAULT_SAM_LABELS),
      review_status: 'accepted',
    });
    progress.done += 1;
    onProgress?.({ done: progress.done, total: targets.length, name: entry.name, phase: 'close' });
    onItemSaved?.(saved, entry);
    return saved;
  });
  const closed = await saveBatchRun(r2Prefix, { ...batch, status: 'accepted', accepted_at: closedAt, closed_at: closedAt });
  return { batch: closed, results: results.filter(Boolean) };
}

/**
 * Build in-memory map `${media_id}::${model}` → record.
 */
export async function loadFeaturesMapFromR2(r2Prefix, models = FEATURE_MODELS) {
  const map = {};
  await Promise.all(models.map(async (model) => {
    const rows = await loadFeatureCsv(r2Prefix, model);
    const nameCounts = new Map();
    rows.forEach((r) => nameCounts.set(r.name, (nameCounts.get(r.name) || 0) + 1));
    rows.forEach((r) => {
      if (!r.media_id && !r.name) return;
      if (r.media_id) map[featureStorageKey(r.media_id, model)] = r;
      if (r.name && nameCounts.get(r.name) === 1) map[featureStorageKey(r.name, model)] = r;
    });
  }));
  return map;
}

/**
 * After template→project image copy: remap feature CSVs + copy preannotation JSONs.
 */
export async function copyFeatureCsvsTemplateToProject({
  templatePrefix,
  projectPrefix,
  nameToNewMediaId,
}) {
  const results = [];
  for (const model of FEATURE_MODELS) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await loadFeatureCsv(templatePrefix, model);
    if (!rows.length) continue;
    const remapped = [];
    rows.forEach((r) => {
      const newId = nameToNewMediaId.get(r.name);
      if (!newId) return;
      remapped.push({
        ...r,
        media_id: newId,
        name: r.name,
      });
    });
    if (!remapped.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const saved = await saveFeatureCsv(projectPrefix, model, remapped);
    results.push({ model, ...saved });
  }

  const docs = await listAnnotationDocuments(templatePrefix);
  let copied = 0;
  for (const [name, newId] of nameToNewMediaId) {
    const matches = docs.filter((d) => d.name === name);
    const ids = new Set(matches.map((d) => d.media_id || d.image));
    if (ids.size > 1) throw new Error(`Ambiguous template annotation name: ${name}`);
    const doc = matches.sort((a, b) => Number(b.storage_key.includes('/by-id/')) - Number(a.storage_key.includes('/by-id/')) || String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    if (!doc) continue;
    await savePreannotation(projectPrefix, { name, media_id: newId, key: newId, url: getMediaStoragePublicUrl(newId) }, doc);
    copied += 1;
  }
  results.push({ model: 'preannotations', copied, errors: 0 });
  return results;
}

/** One-shot: push legacy project JSON imageFeatures into R2 CSVs if R2 is empty. */
export async function migrateLegacyFeaturesToR2(r2Prefix, imageFeaturesMap) {
  if (!isR2Configured() || !r2Prefix || !imageFeaturesMap) return { migrated: false };
  const results = [];
  for (const model of FEATURE_MODELS) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await loadFeatureCsv(r2Prefix, model);
    if (existing.length) continue;
    const records = Object.entries(imageFeaturesMap)
      .filter(([key]) => key.endsWith(`::${model}`))
      .map(([key, rec]) => ({
        ...rec,
        model,
        media_id: rec.media_id || key.split('::')[0],
        name: rec.name || '',
      }));
    if (!records.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const saved = await saveFeatureCsv(r2Prefix, model, records);
    results.push({ model, count: saved.count });
  }
  return { migrated: results.length > 0, results };
}

/** Convert features map → status helpers for gallery. */
export function featureStatusFromMap(map, mediaEntry, models = FEATURE_MODELS) {
  const entry = normalizeMediaEntry(mediaEntry);
  const mediaId = getMediaId(entry);
  const status = {};
  const records = {};
  models.forEach((m) => {
    const rec = map[featureStorageKey(mediaId, m)]
      || map[featureStorageKey(entry?.name || '', m)]
      || null;
    records[m] = rec;
    if (!rec) status[m] = 'missing';
    else if (rec.status === 'error') status[m] = 'error';
    else if (rec.status === 'ready' || (rec.features && Object.keys(rec.features).length > 0)) status[m] = 'ready';
    else status[m] = 'missing';
  });
  return { mediaId, status, records };
}
