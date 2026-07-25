/**
 * Image features in configured Supabase Storage (R2-compatible keys).
 * Paths: {r2Prefix}features/{model}.csv
 * Pre-annotations: {r2Prefix}preannotations/{safeId}.json
 * Rows keyed by media_id; also keep `name` for remapping when keys change on copy.
 */
import {
  uploadImageToR2,
  isR2Configured,
  copyImagesInR2,
  getMediaStoragePublicUrl,
  downloadStorageText,
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

export function preannotationKey(r2Prefix, mediaEntryOrId, nameHint = '', { legacy = false } = {}) {
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
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'unlabeled';
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
export function deriveSamPreannotFeatures(shapes = [], { mediaId, name } = {}) {
  const list = Array.isArray(shapes) ? shapes : [];
  const features = {
    sam_shape_count: list.length,
    sam_total_mask_ratio: 0,
  };
  const byLabel = {};
  let totalArea = 0;
  list.forEach((s) => {
    const area = shapeAreaRatio(s);
    totalArea += area;
    const label = s.label || 'unlabeled';
    const key = samLabelKey(label);
    if (!byLabel[key]) byLabel[key] = { count: 0, area: 0 };
    byLabel[key].count += 1;
    byLabel[key].area += area;
  });
  features.sam_total_mask_ratio = Math.min(1, totalArea);
  Object.entries(byLabel).forEach(([key, v]) => {
    features[`sam_count_${key}`] = v.count;
    features[`sam_ratio_${key}`] = Math.min(1, v.area);
  });
  return {
    model: SAM_PREANNOT_MODEL,
    media_id: mediaId || '',
    name: name || '',
    status: 'ready',
    compute_runtime: 'fal_sam3_preannot',
    computed_at: new Date().toISOString(),
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
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

function recordsToCsv(records) {
  const meta = ['media_id', 'name', 'status', 'computed_at', 'compute_runtime', 'error'];
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
      ...(r.features || {}),
    };
    lines.push(headers.map((h) => escapeCsv(row[h])).join(','));
  });
  return `${lines.join('\n')}\n`;
}

function csvRowsToRecords(rows, model) {
  const meta = new Set(['media_id', 'name', 'status', 'computed_at', 'compute_runtime', 'error']);
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
      features,
    };
  }).filter((r) => r.media_id || r.name);
}

/** Load raw feature CSV text from storage (null if missing). */
export async function loadFeatureCsvText(r2Prefix, model) {
  if (!isR2Configured() || !r2Prefix) return null;
  try {
    const text = await downloadStorageText(featureCsvKey(r2Prefix, model));
    if (!text || !String(text).trim()) return null;
    return text;
  } catch (err) {
    const msg = err.message || '';
    if (/404|403|NoSuchKey|not found/i.test(msg)) return null;
    console.warn('loadFeatureCsvText', model, err);
    return null;
  }
}

/** Load feature records for one model from R2 CSV (empty if missing). */
export async function loadFeatureCsv(r2Prefix, model) {
  try {
    const text = await loadFeatureCsvText(r2Prefix, model);
    if (!text) return [];
    const { rows } = parseCsv(text);
    return csvRowsToRecords(rows, model);
  } catch (err) {
    const msg = err.message || '';
    if (/404|403|NoSuchKey|not found/i.test(msg)) return [];
    console.warn('loadFeatureCsv', model, err);
    return [];
  }
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

async function loadStorageJson(key) {
  if (!key) return null;
  try {
    const text = await downloadStorageText(key);
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    const msg = err.message || '';
    if (/404|403|NoSuchKey|not found|JSON/i.test(msg)) return null;
    throw err;
  }
}

/** Load preannotation JSON for one media (null if missing). Tries path key then legacy basename. */
export async function loadPreannotation(r2Prefix, mediaEntry) {
  if (!isR2Configured() || !r2Prefix) return null;
  const entry = normalizeMediaEntry(mediaEntry);
  try {
    const primary = await loadStorageJson(preannotationKey(r2Prefix, entry, entry?.name));
    if (primary) return primary;
    const legacyId = preannotationSafeId(entry, entry?.name);
    const pathId = preannotationSafeIdPath(entry, entry?.name);
    if (legacyId !== pathId) {
      return loadStorageJson(preannotationKey(r2Prefix, entry, entry?.name, { legacy: true }));
    }
    return null;
  } catch (err) {
    console.warn('loadPreannotation', err);
    return null;
  }
}

/** Load batch run log (null if missing). */
export async function loadBatchRun(r2Prefix, batchRunId) {
  if (!isR2Configured() || !r2Prefix || !batchRunId) return null;
  try {
    return await loadStorageJson(batchRunKey(r2Prefix, batchRunId));
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
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const key = preannotationKey(r2Prefix, entry, entry?.name);
  const up = await uploadImageToR2(blob, key);
  if (!up.success) throw new Error(up.error || 'Failed to upload preannotation');

  // Mirror to legacy basename when path id differs and folder is set — helps
  // gradual migration; load already prefers path key.
  const pathId = preannotationSafeIdPath(entry, entry?.name);
  const legacyId = preannotationSafeId(entry, entry?.name);
  if (pathId !== legacyId && !(entry?.folder || '')) {
    await uploadImageToR2(blob, preannotationKey(r2Prefix, entry, entry?.name, { legacy: true }));
  }

  const featureRecord = deriveSamPreannotFeatures(shapes, {
    mediaId,
    name: entry?.name || '',
  });
  const csv = await saveFeatureCsv(r2Prefix, SAM_PREANNOT_MODEL, [featureRecord]);
  return { annotation: doc, featureRecord, csv, key: up.key, url: up.url };
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
  // Persist close immediately — UI can treat the batch as done without waiting on images.
  const closed = await saveBatchRun(r2Prefix, {
    ...batch,
    status: 'accepted',
    accepted_at: closedAt,
    closed_at: closedAt,
  });

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
  return { batch: closed, results: results.filter(Boolean) };
}

/**
 * Build in-memory map `${media_id}::${model}` → record.
 */
export async function loadFeaturesMapFromR2(r2Prefix, models = FEATURE_MODELS) {
  const map = {};
  await Promise.all(models.map(async (model) => {
    const rows = await loadFeatureCsv(r2Prefix, model);
    rows.forEach((r) => {
      if (!r.media_id && !r.name) return;
      if (r.media_id) map[featureStorageKey(r.media_id, model)] = r;
      if (r.name) map[featureStorageKey(r.name, model)] = r;
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

  const copies = [];
  const samRows = await loadFeatureCsv(templatePrefix, SAM_PREANNOT_MODEL);
  const namesWithSam = new Set(samRows.map((r) => r.name).filter(Boolean));
  nameToNewMediaId.forEach((_newId, name) => {
    if (!namesWithSam.has(name)) return;
    copies.push({
      from: preannotationKey(templatePrefix, name, name),
      to: preannotationKey(projectPrefix, name, name),
    });
  });
  if (copies.length) {
    try {
      const copyRes = await copyImagesInR2(copies);
      results.push({
        model: 'preannotations',
        copied: copyRes.copied?.length || 0,
        errors: copyRes.errors?.length || 0,
      });
    } catch (err) {
      console.warn('preannotation copy:', err);
    }
  }
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
