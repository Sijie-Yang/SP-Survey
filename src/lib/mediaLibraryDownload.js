/**
 * Batch downloads for Media Library / Pre-annotate:
 * - media ZIP (preserve subfolders)
 * - L0 / Seg feature CSVs (whichever exist)
 * - pre-annotate package (JSON + SAM CSV + analysis + annotated images)
 */
import { downloadZip } from './zipDownload';
import {
  normalizeMediaEntry,
  mediaRelativePath,
  mediaRelativePathFromListing,
  getRecursiveMedia,
} from './mediaUtils';
import {
  getR2ServerUrl,
  isR2Configured,
  isR2ProxyUnreachable,
  noteR2ProxyFailure,
} from './r2';
import { L0_MODEL } from './imageFeaturesL0';
import { SEG_MODEL } from './falInference';
import {
  SAM_PREANNOT_MODEL,
  loadFeatureCsvText,
  loadPreannotationsForMediaList,
  preannotationSafeId,
} from './imageFeaturesR2';
import { buildQuestionExportFiles } from './questionSummaryExport';
import { preannotationsToAnalysisInputs } from './preannotateAnalysis';
import { drawAnnotationShape } from '../components/ImageAnnotationWidget';
import { findDuplicateShapePairs } from './annotationGeometry';

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function loadImageFromBlobUrl(blobUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = blobUrl;
  });
}

/** `folder/foo.jpg` → `folder/foo_annotated.jpg` */
function annotatedRelPath(relPath) {
  const raw = String(relPath || 'image.jpg').replace(/^\/+/, '');
  const slash = raw.lastIndexOf('/');
  const dir = slash >= 0 ? raw.slice(0, slash + 1) : '';
  const base = slash >= 0 ? raw.slice(slash + 1) : raw;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${dir}${stem}_annotated.jpg`;
}

/**
 * Burn shapes onto a copy of the source image (JPEG bytes).
 * Uses the same draw helpers as the annotation editor.
 */
export async function renderAnnotatedImageBytes(imageUrl, shapes = []) {
  const bytes = await fetchUrlBytes(imageUrl);
  const blobUrl = URL.createObjectURL(new Blob([bytes]));
  try {
    const img = await loadImageFromBlobUrl(blobUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('Invalid image size');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    (shapes || []).forEach((shape) => {
      drawAnnotationShape(ctx, shape, w, h, {
        alpha: 1,
        fillAlpha: 0.35,
        selected: false,
        showLabel: true,
        showVertices: false,
      });
    });
    const outBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
        'image/jpeg',
        0.92,
      );
    });
    return new Uint8Array(await outBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function safeSlug(s, fallback = 'media') {
  const t = String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_|_$/g, '');
  return t || fallback;
}

/** Fetch bytes for a public URL (direct CORS, then R2 image-proxy). */
export async function fetchUrlBytes(url) {
  if (!url) throw new Error('Missing URL');
  if (String(url).startsWith('blob:')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  try {
    const direct = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (direct.status === 404) throw new Error('Not found');
    if (direct.ok) return new Uint8Array(await direct.arrayBuffer());
  } catch (err) {
    if (/Not found/i.test(err.message || '')) throw err;
    /* fall through to proxy */
  }

  const base = getR2ServerUrl();
  if (!base || isR2ProxyUnreachable()) {
    throw new Error('Failed to fetch media (direct CORS). Ensure Supabase Storage is public.');
  }
  const proxyUrl =
    `${base}/api/r2/image-proxy?url=${encodeURIComponent(url)}&_=${Date.now()}`;
  try {
    const res = await fetch(proxyUrl, { cache: 'no-store' });
    if (res.status === 404) throw new Error('Not found');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (noteR2ProxyFailure(err, 'image-proxy')) throw new Error('R2 proxy unreachable');
    throw err;
  }
}

/**
 * Zip media entries, preserving each file's relative folder path.
 * @returns {{ filename: string, succeeded: number, failed: number, failures: array }}
 */
export async function downloadMediaEntriesZip(entries, {
  filename,
  projectPrefix = '',
  onProgress,
  pathPrefix = '',
} = {}) {
  const list = (entries || [])
    .map((e) => normalizeMediaEntry(e, projectPrefix))
    .filter((e) => e?.url);
  if (!list.length) throw new Error('No media files to download.');

  const files = [];
  const failures = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const rel = mediaRelativePathFromListing(entry, projectPrefix)
      || mediaRelativePath(entry.folder, entry.name)
      || entry.name
      || `file_${i}`;
    const zipPath = pathPrefix ? `${String(pathPrefix).replace(/\/?$/, '/')}${rel}` : rel;
    try {
      const content = await fetchUrlBytes(entry.url);
      files.push({ path: zipPath, content });
    } catch (err) {
      failures.push({ name: entry.name || rel, error: err.message || 'Download failed' });
    }
    onProgress?.(i + 1, list.length);
  }

  if (!files.length) {
    throw new Error(failures[0]?.error || 'All media downloads failed.');
  }

  const stamp = dateStamp();
  const outName = filename || `media_${stamp}.zip`;
  downloadZip(outName, files);
  return {
    filename: outName,
    succeeded: files.length,
    failed: failures.length,
    failures,
  };
}

/** Zip all media under a folder (recursive), preserving subfolders. */
export async function downloadFolderMediaZip(pool, folderPath, {
  filename,
  projectPrefix = '',
  onProgress,
} = {}) {
  const entries = getRecursiveMedia(pool, folderPath, projectPrefix);
  const folder = String(folderPath || '').replace(/\/+$/, '');
  const label = folder ? safeSlug(folder.split('/').pop(), 'folder') : 'all';
  return downloadMediaEntriesZip(entries, {
    filename: filename || `media_${label}_${dateStamp()}.zip`,
    projectPrefix,
    onProgress,
  });
}

/**
 * Download L0 / Seg (and optional SAM) CSVs that exist under r2Prefix.
 * Missing models are skipped — not an error.
 */
export async function downloadFeatureCsvsZip(r2Prefix, {
  models = [L0_MODEL, SEG_MODEL],
  filename,
  includeSam = false,
} = {}) {
  if (!isR2Configured() || !r2Prefix) {
    throw new Error('R2 is not configured.');
  }
  const wanted = [...models];
  if (includeSam && !wanted.includes(SAM_PREANNOT_MODEL)) {
    wanted.push(SAM_PREANNOT_MODEL);
  }

  const files = [];
  const missing = [];
  for (const model of wanted) {
    const text = await loadFeatureCsvText(r2Prefix, model);
    if (!text) {
      missing.push(model);
      continue;
    }
    files.push({ path: `features/${model}.csv`, content: text });
  }

  if (!files.length) {
    throw new Error(`No feature CSVs found (looked for ${wanted.join(', ')}). Run extraction first.`);
  }

  const stamp = dateStamp();
  const outName = filename || `features_l0_seg_${stamp}.zip`;
  const readme = [
    'SP-Survey feature CSV export',
    `prefix: ${r2Prefix}`,
    `exported: ${new Date().toISOString()}`,
    '',
    'Included:',
    ...files.map((f) => `  ${f.path}`),
    '',
    missing.length ? `Missing (not on R2): ${missing.join(', ')}` : 'All requested models present.',
  ].join('\n');
  files.push({ path: 'README.txt', content: readme });
  downloadZip(outName, files);
  return { filename: outName, included: files.filter((f) => f.path.startsWith('features/')).map((f) => f.path), missing };
}

/**
 * Pre-annotate research package:
 *   preannotations/*.json  — raw shapes (source of truth)
 *   features/sp_sam_preannot_v1.csv — derived counts/ratios if present
 *   analysis/* — long + summary CSVs (same as results Export ZIP)
 *   images/{folder}/{file} — annotated images only (optional)
 *   manifest.json
 */
export async function downloadPreannotatePackageZip({
  r2Prefix,
  mediaList = [],
  items = null,
  includeImages = true,
  includeOverlays = true,
  filename,
  projectPrefix = '',
  onProgress,
} = {}) {
  if (!isR2Configured() || !r2Prefix) {
    throw new Error('R2 is not configured.');
  }

  let annotatedItems = Array.isArray(items) ? items.filter((it) => it?.annotation?.shapes?.length) : null;
  if (!annotatedItems) {
    const loaded = await loadPreannotationsForMediaList(r2Prefix, mediaList, { concurrency: 12 });
    annotatedItems = loaded.filter(({ annotation }) => annotation?.shapes?.length);
  }
  if (!annotatedItems.length) {
    throw new Error('No saved pre-annotations to export.');
  }

  const files = [];
  const manifest = [];
  const perItemSteps = 1 + (includeImages ? 1 : 0) + (includeOverlays ? 1 : 0);
  const totalSteps = annotatedItems.length * perItemSteps + 2;
  let step = 0;
  const tick = () => {
    step += 1;
    onProgress?.(step, totalSteps);
  };

  for (const { mediaEntry, annotation } of annotatedItems) {
    const entry = normalizeMediaEntry(mediaEntry || {
      name: annotation?.name,
      url: annotation?.image,
      media_id: annotation?.media_id,
    }, projectPrefix);
    const safeId = preannotationSafeId(entry || annotation?.name, annotation?.name);
    const rel = mediaRelativePathFromListing(entry, projectPrefix)
      || mediaRelativePath(entry?.folder, entry?.name || annotation?.name)
      || `${safeId}.jpg`;
    const shapes = annotation.shapes || [];
    const dupPairs = findDuplicateShapePairs(shapes, { iouThreshold: 0.7 });
    const sources = {};
    shapes.forEach((s) => {
      const src = s.source || 'unknown';
      sources[src] = (sources[src] || 0) + 1;
    });
    const batchIds = [...new Set(shapes.map((s) => s.batchRunId).filter(Boolean))];
    const doc = {
      media_id: annotation.media_id || entry?.media_id || '',
      name: annotation.name || entry?.name || safeId,
      image: annotation.image || entry?.url || '',
      shapes,
      labels: annotation.labels || [],
      review_status: annotation.review_status || null,
      updated_at: annotation.updated_at || null,
      model: annotation.model || SAM_PREANNOT_MODEL,
      folder: entry?.folder || '',
    };
    files.push({
      path: `preannotations/${safeId}.json`,
      content: `${JSON.stringify(doc, null, 2)}\n`,
    });
    manifest.push({
      media_id: doc.media_id,
      name: doc.name,
      folder: doc.folder || '',
      shape_count: doc.shapes.length,
      review_status: doc.review_status,
      sources,
      batch_run_ids: batchIds,
      possible_duplicates: dupPairs.length,
      updated_at: doc.updated_at,
      image_path: `images/${rel}`,
      overlay_path: `overlays/${annotatedRelPath(rel)}`,
      json_path: `preannotations/${safeId}.json`,
    });
    tick();
  }

  if (includeImages || includeOverlays) {
    for (let i = 0; i < annotatedItems.length; i += 1) {
      const { mediaEntry, annotation } = annotatedItems[i];
      const entry = normalizeMediaEntry(mediaEntry || {
        name: annotation?.name,
        url: annotation?.image,
        media_id: annotation?.media_id,
      }, projectPrefix);
      const url = entry?.url || annotation?.image;
      const rel = mediaRelativePathFromListing(entry, projectPrefix)
        || mediaRelativePath(entry?.folder, entry?.name || annotation?.name)
        || `file_${i}.jpg`;
      if (!url) {
        if (includeImages) tick();
        if (includeOverlays) tick();
        continue;
      }
      if (includeImages) {
        try {
          const content = await fetchUrlBytes(url);
          files.push({ path: `images/${rel}`, content });
        } catch {
          /* skip missing images; JSON still exported */
        }
        tick();
      }
      if (includeOverlays) {
        try {
          const overlay = await renderAnnotatedImageBytes(url, annotation?.shapes || []);
          files.push({ path: `overlays/${annotatedRelPath(rel)}`, content: overlay });
        } catch {
          /* skip failed burn-in; JSON / source image still exported */
        }
        tick();
      }
    }
  }

  const samCsv = await loadFeatureCsvText(r2Prefix, SAM_PREANNOT_MODEL);
  if (samCsv) {
    files.push({ path: `features/${SAM_PREANNOT_MODEL}.csv`, content: samCsv });
  }
  tick();

  const analysis = preannotationsToAnalysisInputs(annotatedItems);
  if (analysis?.question && analysis.responses?.length) {
    const analysisFiles = buildQuestionExportFiles(
      analysis.question,
      analysis.responses,
      null,
      { pathPrefix: 'analysis' },
    );
    (analysisFiles || []).forEach((f) => files.push(f));
  }
  tick();

  files.push({
    path: 'manifest.json',
    content: `${JSON.stringify({
      exported_at: new Date().toISOString(),
      r2_prefix: r2Prefix,
      annotated_count: annotatedItems.length,
      include_images: includeImages,
      include_overlays: includeOverlays,
      items: manifest,
    }, null, 2)}\n`,
  });

  files.push({
    path: 'README.txt',
    content: [
      'SP-Survey pre-annotate export',
      '',
      'preannotations/  — raw researcher annotations (normalized coords 0–1)',
      'features/        — derived SAM feature CSV (if computed)',
      'analysis/        — long + summary CSVs for charts / stats',
      'images/          — source images that have annotations (folder layout preserved)',
      'overlays/        — same images with shapes + labels burned in (*_annotated.jpg)',
      'manifest.json    — index of exported items',
      '',
      `Annotated sets: ${annotatedItems.length}`,
      `Exported: ${new Date().toISOString()}`,
    ].join('\n'),
  });

  const outName = filename || `preannotate_${dateStamp()}.zip`;
  downloadZip(outName, files);
  return { filename: outName, annotatedCount: annotatedItems.length, fileCount: files.length };
}
