/**
 * Persist image features on the project (imageDatasetConfig.imageFeatures)
 * and optionally mirror to Supabase image_features when available.
 */
import { supabase } from './supabase';
import { getMediaId, normalizeMediaEntry } from './mediaUtils';

export function getFeaturesMap(project) {
  const map = project?.imageDatasetConfig?.imageFeatures;
  return map && typeof map === 'object' ? { ...map } : {};
}

/** Key: `${media_id}::${model}` */
export function featureStorageKey(mediaId, model) {
  return `${mediaId}::${model}`;
}

export function getFeatureRecord(project, mediaId, model) {
  const map = getFeaturesMap(project);
  return map[featureStorageKey(mediaId, model)] || null;
}

export function upsertFeatureInConfig(imageDatasetConfig, mediaId, record) {
  const prev = imageDatasetConfig?.imageFeatures && typeof imageDatasetConfig.imageFeatures === 'object'
    ? imageDatasetConfig.imageFeatures
    : {};
  const key = featureStorageKey(mediaId, record.model);
  return {
    ...(imageDatasetConfig || {}),
    imageFeatures: {
      ...prev,
      [key]: {
        media_id: mediaId,
        ...record,
      },
    },
  };
}

/** Merge two imageFeatures maps (later wins on same key). */
export function mergeImageFeatures(...maps) {
  const out = {};
  maps.forEach((m) => {
    if (m && typeof m === 'object') Object.assign(out, m);
  });
  return out;
}

/**
 * Look up a feature record, trying media_id / key / name variants
 * so badges still work if ids were normalized differently across runs.
 */
export function findFeatureRecord(imageFeatures, entry, model) {
  const map = imageFeatures && typeof imageFeatures === 'object' ? imageFeatures : {};
  const candidates = [
    getMediaId(entry),
    entry?.media_id,
    entry?.key,
    entry?.name,
    normalizeMediaEntry(entry)?.media_id,
  ].filter(Boolean);
  for (const id of candidates) {
    const rec = map[featureStorageKey(id, model)];
    if (rec) return rec;
  }
  return null;
}

export async function upsertFeatureToSupabase(projectId, mediaId, record) {
  if (!supabase || !projectId || !mediaId) return { success: false, skipped: true };
  try {
    const row = {
      project_id: projectId,
      media_id: mediaId,
      model: record.model,
      features_json: record.features || record.features_json || {},
      overlay_url: record.seg_overlay_url || record.overlay_url || null,
      status: record.status || 'ready',
      compute_runtime: record.compute_runtime || 'browser',
      computed_at: record.computed_at || new Date().toISOString(),
    };
    const { error } = await supabase.from('image_features').upsert(row, {
      onConflict: 'project_id,media_id,model',
    });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    // Table may not exist yet — config JSON remains source of truth
    return { success: false, error: err.message || String(err) };
  }
}

export function listMediaWithFeatureStatus(preloadedImages, imageDatasetConfig, models = ['sp_l0_v1', 'sp_seg_segformer_cs_v1']) {
  const map = imageDatasetConfig?.imageFeatures || {};
  return (preloadedImages || []).map((raw) => {
    const entry = normalizeMediaEntry(raw);
    const mediaId = getMediaId(entry);
    const status = {};
    const records = {};
    models.forEach((m) => {
      const rec = findFeatureRecord(map, raw, m) || findFeatureRecord(map, entry, m);
      records[m] = rec || null;
      if (!rec) status[m] = 'missing';
      else if (rec.status === 'error') status[m] = 'error';
      else if (rec.status === 'ready' || (rec.features && Object.keys(rec.features).length > 0)) status[m] = 'ready';
      else status[m] = rec.status || 'missing';
    });
    return { entry, mediaId, status, records };
  });
}
