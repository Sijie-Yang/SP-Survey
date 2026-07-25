/**
 * Shared fal.ai proxy helpers for Express (server.js) and Cloudflare Pages Functions.
 */

export async function falSubscribe(falKey, modelId, input) {
  const res = await fetch(`https://fal.run/${modelId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text || `fal HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(json?.detail || json?.error || json?.message || `fal HTTP ${res.status}`);
  }
  return json;
}

export async function handleFalTest(falKey) {
  if (!falKey) throw new Error('falKey is required');
  // Lightweight auth check — queue status endpoint
  const res = await fetch('https://api.fal.ai/v1/models', {
    headers: { Authorization: `Key ${falKey}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid fal API key');
  }
  // Some accounts may not list models; any non-auth response counts as ok
  if (res.status === 404) return { ok: true };
  if (!res.ok && res.status !== 404) {
    // Try a tiny SAM3 dry-run is expensive; accept 200–499 except 401/403
    const body = await res.text();
    if (res.status >= 500) throw new Error(body || 'fal server error');
  }
  return { ok: true };
}

export function buildSam3Input({ imageUrl, prompt, points, box, maxMasks = 32 }) {
  // fal defaults prompt to "wheel" if omitted — that breaks Click/Box. Always set explicitly.
  // Prefer binary masks; boxes are fallback metadata only. max_masks API range is 1–32.
  const input = {
    image_url: imageUrl,
    prompt: String(prompt || '').trim(),
    apply_mask: false,
    output_format: 'png',
    return_multiple_masks: true,
    max_masks: Math.min(32, Math.max(1, maxMasks)),
    include_scores: true,
    include_boxes: true,
    point_prompts: [],
    box_prompts: [],
  };
  if (points?.length) {
    input.point_prompts = points.map((p) => ({
      x: Math.round(Number(p.x)),
      y: Math.round(Number(p.y)),
      label: p.label === 0 ? 0 : 1,
    }));
  }
  if (box) {
    input.box_prompts = [{
      x_min: Math.round(Number(box.x1)),
      y_min: Math.round(Number(box.y1)),
      x_max: Math.round(Number(box.x2)),
      y_max: Math.round(Number(box.y2)),
    }];
  }
  return input;
}

function maskEntryUrl(entry) {
  if (!entry) return null;
  if (typeof entry === 'string' && entry.trim()) return entry.trim();
  if (typeof entry.url === 'string' && entry.url.trim()) return entry.url.trim();
  if (typeof entry.file_data === 'string' && entry.file_data) {
    return entry.file_data.startsWith('data:')
      ? entry.file_data
      : `data:image/png;base64,${entry.file_data}`;
  }
  return null;
}

/** Prefer binary mask URLs; skip empty-string placeholders from fal examples. */
export function extractMaskUrl(result) {
  if (!result) return null;
  if (Array.isArray(result.masks)) {
    for (const m of result.masks) {
      const u = maskEntryUrl(m);
      if (u) return u;
    }
  }
  const single = maskEntryUrl(result.mask);
  if (single) return single;
  if (Array.isArray(result.images)) {
    for (const m of result.images) {
      const u = maskEntryUrl(m);
      if (u) return u;
    }
  }
  return maskEntryUrl(result.image) || maskEntryUrl(result) || null;
}

/** Normalized [cx, cy, w, h] boxes + scores from fal SAM3 payload. */
export function extractSamBoxes(result) {
  const boxes = [];
  const topBoxes = Array.isArray(result?.boxes) ? result.boxes : [];
  const scores = Array.isArray(result?.scores) ? result.scores : [];
  const meta = Array.isArray(result?.metadata) ? result.metadata : [];
  const n = Math.max(topBoxes.length, meta.length, scores.length, Array.isArray(result?.masks) ? result.masks.length : 0);
  for (let i = 0; i < n; i += 1) {
    const fromTop = topBoxes[i];
    const fromMeta = meta[i]?.box;
    const box = Array.isArray(fromTop) && fromTop.length >= 4
      ? fromTop
      : (Array.isArray(fromMeta) && fromMeta.length >= 4 ? fromMeta : null);
    if (!box) continue;
    const [cx, cy, w, h] = box.map(Number);
    if (![cx, cy, w, h].every(Number.isFinite)) continue;
    const score = Number(scores[i] ?? meta[i]?.score);
    boxes.push({
      cx, cy, w, h,
      area: Math.max(0, w) * Math.max(0, h),
      score: Number.isFinite(score) ? score : 0,
      maskUrl: maskEntryUrl(result?.masks?.[i]) || null,
      index: i,
    });
  }
  return boxes;
}

/**
 * All SAM instances (one per mask / box). Client converts masks → polygons.
 * Box metadata is kept as fallback only when a mask URL is missing.
 */
export function extractSamInstances(result, {
  minArea = 0.002,
  maxArea = 0.85,
} = {}) {
  const masks = Array.isArray(result?.masks) ? result.masks : [];
  const boxes = extractSamBoxes(result);
  const byIndex = new Map(boxes.map((b) => [b.index, b]));
  const n = Math.max(masks.length, boxes.length);
  const instances = [];
  for (let i = 0; i < n; i += 1) {
    const box = byIndex.get(i) || null;
    const maskUrl = maskEntryUrl(masks[i]) || box?.maskUrl || null;
    if (!maskUrl && !box) continue;
    const area = box?.area ?? 0;
    if (box && (area < minArea || area > maxArea) && !maskUrl) continue;
    instances.push({
      index: i,
      maskUrl,
      box: box && area >= minArea && area <= maxArea ? box : null,
      score: box?.score ?? 0,
      area,
    });
  }
  if (!instances.length) {
    const maskUrl = extractMaskUrl(result);
    if (maskUrl) instances.push({ index: 0, maskUrl, box: null, score: 0, area: 0 });
  }
  instances.sort((a, b) => (b.score - a.score) || (a.area - b.area));
  return instances;
}

/** @deprecated use extractSamInstances — kept for older callers/tests */
export function pickSamInstance(result, opts = {}) {
  const instances = extractSamInstances(result, opts);
  if (!instances.length) return { box: null, maskUrl: null, candidates: 0, instances: [] };
  return {
    box: instances[0].box,
    maskUrl: instances[0].maskUrl,
    candidates: instances.length,
    instances,
  };
}

export async function estimateMaskRatioFromUrl(maskUrl) {
  // Server-side: fetch and count opaque-ish pixels via raw decode is heavy.
  // Return null; client can refine. For streetscape-seg we use fal output metadata if any.
  return null;
}
