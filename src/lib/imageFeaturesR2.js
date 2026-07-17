/**
 * Image features in the configured Supabase Storage bucket as CSV.
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
import { getMediaId, normalizeMediaEntry } from './mediaUtils';

/** SAM3 researcher pre-annotation derived features. */
export const SAM_PREANNOT_MODEL = 'sp_sam_preannot_v1';

export const DEFAULT_SAM_LABELS = [
  'tree', 'building', 'sky', 'road', 'person', 'vehicle',
];

export const FEATURE_MODELS = [L0_MODEL, SEG_MODEL, SAM_PREANNOT_MODEL];

export function normalizeR2Prefix(prefix) {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

export function featureCsvKey(r2Prefix, model) {
  return `${normalizeR2Prefix(r2Prefix)}features/${model}.csv`;
}

export function featureCsvPublicUrl(r2Prefix, model) {
  if (!isR2Configured()) return null;
  return getMediaStoragePublicUrl(featureCsvKey(r2Prefix, model));
}

/** Safe object basename for preannotation JSON (avoid nested keys from R2 paths). */
export function preannotationSafeId(mediaEntryOrId, nameHint = '') {
  const entry = typeof mediaEntryOrId === 'object'
    ? normalizeMediaEntry(mediaEntryOrId)
    : null;
  const raw = entry?.name || nameHint || entry?.media_id || String(mediaEntryOrId || '');
  const base = String(raw).split('/').pop() || 'media';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'media';
}

export function preannotationKey(r2Prefix, mediaEntryOrId, nameHint = '') {
  return `${normalizeR2Prefix(r2Prefix)}preannotations/${preannotationSafeId(mediaEntryOrId, nameHint)}.json`;
}

export function preannotationPublicUrl(r2Prefix, mediaEntryOrId, nameHint = '') {
  if (!isR2Configured()) return null;
  return getMediaStoragePublicUrl(preannotationKey(r2Prefix, mediaEntryOrId, nameHint));
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
  const tool = shape.tool
    || (pts.length >= 3 ? 'region' : pts.length === 2 ? 'line' : 'point');
  if (tool === 'bbox' && pts.length >= 2) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const w = Math.max(0, Math.max(...xs) - Math.min(...xs));
    const h = Math.max(0, Math.max(...ys) - Math.min(...ys));
    return w * h;
  }
  if (tool === 'region' && pts.length >= 3) return polygonAreaNorm(pts);
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

/** Load feature records for one model from R2 CSV (empty if missing). */
export async function loadFeatureCsv(r2Prefix, model) {
  if (!isR2Configured() || !r2Prefix) return [];
  try {
    const text = await downloadStorageText(featureCsvKey(r2Prefix, model));
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

/** Load preannotation JSON for one media (null if missing). */
export async function loadPreannotation(r2Prefix, mediaEntry) {
  if (!isR2Configured() || !r2Prefix) return null;
  const entry = normalizeMediaEntry(mediaEntry);
  try {
    const text = await downloadStorageText(preannotationKey(r2Prefix, entry, entry?.name));
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    const msg = err.message || '';
    if (/404|403|NoSuchKey|not found|JSON/i.test(msg)) return null;
    console.warn('loadPreannotation', err);
    return null;
  }
}

/**
 * Save preannotation JSON + derived SAM feature CSV row.
 */
export async function savePreannotation(r2Prefix, mediaEntry, annotationPayload) {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const entry = normalizeMediaEntry(mediaEntry);
  const mediaId = getMediaId(entry);
  const shapes = annotationPayload?.shapes || [];
  const doc = {
    media_id: mediaId,
    name: entry?.name || '',
    image: entry?.url || annotationPayload?.image || '',
    shapes,
    labels: annotationPayload?.labels || DEFAULT_SAM_LABELS,
    updated_at: new Date().toISOString(),
    model: SAM_PREANNOT_MODEL,
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const key = preannotationKey(r2Prefix, entry, entry?.name);
  const up = await uploadImageToR2(blob, key);
  if (!up.success) throw new Error(up.error || 'Failed to upload preannotation');

  const featureRecord = deriveSamPreannotFeatures(shapes, {
    mediaId,
    name: entry?.name || '',
  });
  const csv = await saveFeatureCsv(r2Prefix, SAM_PREANNOT_MODEL, [featureRecord]);
  return { annotation: doc, featureRecord, csv, key: up.key, url: up.url };
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
