/**
 * Shared L0 / SegFormer extraction runners (R2 CSV).
 * Used by FeatureExtractionJobs UI and admin bulk template jobs.
 */
import { normalizeMediaEntry, getMediaId } from './mediaUtils';
import { extractL0Features, L0_MODEL } from './imageFeaturesL0';
import { featureStorageKey } from './imageFeaturesStore';
import {
  runStreetscapeSegmentation, STREETSCAPE_VOCAB, SEG_MODEL,
  SEGFORMER_HF_MODEL, segLabelToKey, maskUrlToRatio,
} from './falInference';
import {
  loadFeaturesMapFromR2,
  writeFeatureCsv,
  FEATURE_MODELS,
} from './imageFeaturesR2';
import { isR2Configured } from './r2';

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export function isFeatureReady(rec) {
  return !!(rec?.status === 'ready' || (rec?.features && Object.keys(rec.features).length > 0));
}

export function getFeatureRec(map, media, model) {
  if (!map || !media) return null;
  return map[featureStorageKey(getMediaId(media), model)]
    || map[featureStorageKey(media.name, model)]
    || null;
}

/** Collect unique feature records for one model from an in-memory map. */
export function recordsFromMap(map, model) {
  const byKey = new Map();
  Object.values(map || {}).forEach((rec) => {
    if (!rec || rec.model !== model) return;
    const key = rec.media_id || (rec.name ? `name:${rec.name}` : null);
    if (!key) return;
    byKey.set(key, rec);
  });
  return [...byKey.values()];
}

export function normalizeImageList(rawImages) {
  return (rawImages || [])
    .map(normalizeMediaEntry)
    .filter((m) => m && m.type === 'image' && m.url);
}

export function filterPendingImages(images, map, model) {
  return images.filter((m) => !isFeatureReady(getFeatureRec(map, m, model)));
}

function putRecord(map, mediaId, name, model, record) {
  map[featureStorageKey(mediaId, model)] = record;
  if (name) map[featureStorageKey(name, model)] = record;
}

/**
 * Run L0 for images under an R2 prefix. Skips ready records when skipReady=true.
 * @returns {{ done, skipped, total, stopped, featureMap, error? }}
 */
export async function runL0Extraction({
  r2Prefix,
  images: rawImages,
  featureMap: initialMap = null,
  skipReady = true,
  flushEvery = 10,
  onProgress,
  shouldAbort,
}) {
  if (!isR2Configured()) throw new Error('Supabase Storage is not configured — features are stored as CSV in survey-images.');
  if (!r2Prefix) throw new Error('Missing R2 prefix.');

  const images = normalizeImageList(rawImages);
  if (!images.length) {
    return { done: 0, skipped: 0, total: 0, stopped: false, featureMap: initialMap || {} };
  }

  const map = { ...(initialMap || await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS)) };
  const pending = filterPendingImages(images, map, L0_MODEL);
  const work = skipReady ? pending : (pending.length ? pending : images);
  const skipped = images.length - pending.length;

  if (!work.length) {
    return { done: 0, skipped, total: 0, stopped: false, featureMap: map };
  }

  let done = 0;
  let stopped = false;
  const flush = async () => {
    await writeFeatureCsv(r2Prefix, L0_MODEL, recordsFromMap(map, L0_MODEL));
  };

  for (let i = 0; i < work.length; i += 1) {
    if (shouldAbort?.()) { stopped = true; break; }
    const media = work[i];
    const mediaId = getMediaId(media);
    let record;
    try {
      // eslint-disable-next-line no-await-in-loop
      record = await extractL0Features(media.url);
      record = { ...record, media_id: mediaId, name: media.name };
    } catch (err) {
      record = {
        model: L0_MODEL,
        media_id: mediaId,
        name: media.name,
        status: 'error',
        error: err.message || String(err),
        computed_at: new Date().toISOString(),
        features: {},
      };
    }
    putRecord(map, mediaId, media.name, L0_MODEL, record);
    done += 1;
    onProgress?.({ done, total: work.length, record, featureMap: map, model: L0_MODEL });
    if (done % flushEvery === 0) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    // eslint-disable-next-line no-await-in-loop
    await yieldToUi();
  }

  await flush();
  return { done, skipped, total: work.length, stopped, featureMap: map };
}

/**
 * Run SegFormer for images under an R2 prefix. Always skips ready records.
 * @returns {{ done, skipped, total, stopped, featureMap, error? }}
 */
export async function runSegExtraction({
  r2Prefix,
  images: rawImages,
  featureMap: initialMap = null,
  hfToken,
  flushEvery = 5,
  onProgress,
  shouldAbort,
}) {
  const token = String(hfToken || '').trim();
  if (!token) throw new Error('HuggingFace token required (save it in Spatial Intelligence / API keys).');
  if (!isR2Configured()) throw new Error('Supabase Storage is not configured.');
  if (!r2Prefix) throw new Error('Missing R2 prefix.');

  const images = normalizeImageList(rawImages);
  if (!images.length) {
    return { done: 0, skipped: 0, total: 0, stopped: false, featureMap: initialMap || {} };
  }

  const map = { ...(initialMap || await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS)) };
  const work = filterPendingImages(images, map, SEG_MODEL);
  const skipped = images.length - work.length;

  if (!work.length) {
    return { done: 0, skipped, total: 0, stopped: false, featureMap: map };
  }

  let done = 0;
  let stopped = false;
  const flush = async () => {
    await writeFeatureCsv(r2Prefix, SEG_MODEL, recordsFromMap(map, SEG_MODEL));
  };

  for (let i = 0; i < work.length; i += 1) {
    if (shouldAbort?.()) { stopped = true; break; }
    const media = work[i];
    const mediaId = getMediaId(media);
    let record;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { masks, labels, model, compute_runtime } = await runStreetscapeSegmentation({
        hfToken: token,
        imageUrl: media.url,
      });
      const features = {
        seg_vocab: labels || STREETSCAPE_VOCAB,
        seg_backbone: model || SEGFORMER_HF_MODEL,
      };
      const labelList = labels?.length ? labels : Object.keys(masks || {});
      // eslint-disable-next-line no-await-in-loop
      for (const label of labelList) {
        features[`seg_ratio_${segLabelToKey(label)}`] = await maskUrlToRatio(masks?.[label]);
      }
      record = {
        model: SEG_MODEL,
        media_id: mediaId,
        name: media.name,
        features,
        status: 'ready',
        compute_runtime: compute_runtime || 'hf_segformer_cityscapes',
        computed_at: new Date().toISOString(),
      };
    } catch (err) {
      if (err?.name === 'AbortError') { stopped = true; break; }
      record = {
        model: SEG_MODEL,
        media_id: mediaId,
        name: media.name,
        status: 'error',
        error: err.message || String(err),
        features: {},
        computed_at: new Date().toISOString(),
      };
    }
    putRecord(map, mediaId, media.name, SEG_MODEL, record);
    done += 1;
    onProgress?.({ done, total: work.length, record, featureMap: map, model: SEG_MODEL });
    if (done % flushEvery === 0) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    // eslint-disable-next-line no-await-in-loop
    await yieldToUi();
  }

  await flush();
  return { done, skipped, total: work.length, stopped, featureMap: map };
}

/**
 * Run L0 then Seg for one template/project prefix. Skips images that already have features.
 */
export async function runAllFeaturesForPrefix({
  r2Prefix,
  images,
  hfToken,
  runL0 = true,
  runSeg = true,
  onProgress,
  shouldAbort,
}) {
  let featureMap = await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS);
  const summary = {
    l0: { done: 0, skipped: 0, total: 0, stopped: false },
    seg: { done: 0, skipped: 0, total: 0, stopped: false },
  };

  if (runL0) {
    const l0 = await runL0Extraction({
      r2Prefix,
      images,
      featureMap,
      skipReady: true,
      onProgress: (p) => onProgress?.({ phase: 'l0', ...p }),
      shouldAbort,
    });
    featureMap = l0.featureMap;
    summary.l0 = l0;
    if (l0.stopped) return { ...summary, featureMap, stopped: true };
  }

  if (runSeg) {
    const seg = await runSegExtraction({
      r2Prefix,
      images,
      featureMap,
      hfToken,
      onProgress: (p) => onProgress?.({ phase: 'seg', ...p }),
      shouldAbort,
    });
    featureMap = seg.featureMap;
    summary.seg = seg;
    if (seg.stopped) return { ...summary, featureMap, stopped: true };
  }

  return { ...summary, featureMap, stopped: false };
}
