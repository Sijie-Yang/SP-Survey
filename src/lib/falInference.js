/**
 * Client helpers for fal.ai (SAM3 annotation) and streetscape SegFormer (HF).
 */

const SERVER_URL =
  process.env.REACT_APP_SERVER_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

/** Streetscape semantic seg — SegFormer Cityscapes (one pass / image). */
export const SEG_MODEL = 'sp_seg_segformer_cs_v1';
export const SEGFORMER_HF_MODEL = 'nvidia/segformer-b0-finetuned-cityscapes-1024-1024';

/** Cityscapes 19 eval classes (SegFormer labels). */
export const STREETSCAPE_VOCAB = [
  'road', 'sidewalk', 'building', 'wall', 'fence', 'pole',
  'traffic light', 'traffic sign', 'vegetation', 'terrain', 'sky',
  'person', 'rider', 'car', 'truck', 'bus', 'train', 'motorcycle', 'bicycle',
];

async function parseJsonResponse(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    throw new Error(
      text.startsWith('<!DOCTYPE') || text.startsWith('<html')
        ? `Inference API returned HTML (is the server running on ${SERVER_URL || 'this host'}?)`
        : (text.slice(0, 200) || `HTTP ${res.status}`),
    );
  }
  return res.json();
}

export async function testFalKey(falKey) {
  const key = String(falKey || '').trim();
  if (!key) throw new Error('falKey is required');
  if (!key.includes(':')) {
    throw new Error('fal key should look like key_id:key_secret (copy the full key from fal.ai/dashboard/keys)');
  }
  const res = await fetch(`${SERVER_URL}/api/inference/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ falKey: key }),
  });
  const json = await parseJsonResponse(res);
  if (!res.ok || !json.success) throw new Error(json.error || 'Fal key test failed');
  return json;
}

/**
 * SAM3 segment — point / box / text prompt (annotation assist only).
 */
export async function runSam3(opts) {
  const res = await fetch(`${SERVER_URL}/api/inference/sam3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      falKey: opts.falKey || undefined,
      projectId: opts.projectId || undefined,
      imageUrl: opts.imageUrl,
      prompt: opts.prompt,
      points: opts.points,
      box: opts.box,
    }),
  });
  const json = await parseJsonResponse(res);
  if (!res.ok || !json.success) throw new Error(json.error || 'SAM3 request failed');
  return json;
}

/**
 * Streetscape class ratios via SegFormer Cityscapes (HuggingFace Inference).
 * One model call per image — not SAM3.
 */
export async function runStreetscapeSegmentation({
  hfToken, projectId, imageUrl, signal,
}) {
  const res = await fetch(`${SERVER_URL}/api/inference/streetscape-seg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hfToken: hfToken || undefined,
      projectId: projectId || undefined,
      imageUrl,
    }),
    signal,
  });
  const json = await parseJsonResponse(res);
  if (!res.ok || !json.success) throw new Error(json.error || 'Streetscape segmentation failed');
  return json;
}

/** Normalize Cityscapes / HF label → feature key suffix (seg_ratio_*). */
export function segLabelToKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** Andrew's monotone chain — flood-fill edge pixels are unordered, so hull them. */
export function convexHullNormalized(points) {
  const pts = (points || [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }));
  if (pts.length <= 2) return pts;
  pts.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Convert a binary mask canvas to normalized polygon points (largest blob, convex hull).
 */
export function maskCanvasToPolygon(maskCanvas, simplify = 4) {
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const ctx = maskCanvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, w, h);
  const visited = new Uint8Array(w * h);
  let best = null;

  // Auto-detect white-on-black vs black-on-white. Treating dark opaque pixels as
  // foreground used to turn whole-frame masks into a full-image polygon.
  let bright = 0;
  let dark = 0;
  const stride = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 16) continue;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > 127) bright += 1;
      else dark += 1;
    }
  }
  const fgIsBright = bright <= dark; // classic white blob on dark bg

  const isOn = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = (y * w + x) * 4;
    const a = data[i + 3];
    if (a < 16) return false;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return fgIsBright ? lum > 127 : lum < 127;
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (visited[idx] || !isOn(x, y)) continue;
      const stack = [[x, y]];
      visited[idx] = 1;
      let area = 0;
      const boundary = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        area += 1;
        const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        let edge = false;
        for (const [nx, ny] of neighbors) {
          if (!isOn(nx, ny)) edge = true;
          else {
            const nidx = ny * w + nx;
            if (!visited[nidx]) {
              visited[nidx] = 1;
              stack.push([nx, ny]);
            }
          }
        }
        if (edge) boundary.push({ x: cx / w, y: cy / h });
      }
      if (!best || area > best.area) best = { area, boundary };
    }
  }
  if (!best?.boundary?.length) return [];
  const cover = best.area / Math.max(1, w * h);
  // Reject near-full-frame / dust masks.
  if (cover > 0.85 || cover < 0.002) return [];
  const step = Math.max(1, simplify);
  const sampled = best.boundary.filter((_, i) => i % step === 0);
  const hull = convexHullNormalized(sampled.length >= 3 ? sampled : best.boundary);
  if (hull.length >= 3) return hull;
  if (sampled.length >= 3) return sampled;
  return best.boundary.slice(0, 20);
}

/** fal box [cx,cy,w,h] normalized → corner polygon (last-resort fallback only). */
export function samBoxToPolygon(box) {
  if (!box) return [];
  const cx = Number(box.cx);
  const cy = Number(box.cy);
  const bw = Number(box.w);
  const bh = Number(box.h);
  if (![cx, cy, bw, bh].every(Number.isFinite)) return [];
  const x1 = Math.min(1, Math.max(0, cx - bw / 2));
  const y1 = Math.min(1, Math.max(0, cy - bh / 2));
  const x2 = Math.min(1, Math.max(0, cx + bw / 2));
  const y2 = Math.min(1, Math.max(0, cy + bh / 2));
  if ((x2 - x1) * (y2 - y1) > 0.85) return [];
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

/**
 * Convert fal instances → polygons. Always prefer mask raster over box rectangle.
 * @returns {Promise<Array<Array<{x:number,y:number}>>>}
 */
export async function instancesToPolygons(result, { allowBoxFallback = true } = {}) {
  const list = Array.isArray(result?.instances) && result.instances.length
    ? result.instances
    : [{
      maskUrl: result?.maskUrl || null,
      box: result?.box || null,
      score: 0,
    }];
  const polys = [];
  for (const inst of list) {
    if (inst?.maskUrl) {
      try {
        const canvas = await loadMaskUrlToCanvas(inst.maskUrl);
        const poly = maskCanvasToPolygon(canvas, 4);
        if (poly.length >= 3) {
          polys.push(poly);
          continue;
        }
      } catch {
        // fall through to box
      }
    }
    if (allowBoxFallback) {
      const boxPoly = samBoxToPolygon(inst?.box);
      if (boxPoly.length >= 4) polys.push(boxPoly);
    }
  }
  return polys;
}

export async function loadMaskUrlToCanvas(maskUrl) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = maskUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas;
}

export async function maskUrlToRatio(maskUrl) {
  if (!maskUrl) return 0;
  try {
    const canvas = await loadMaskUrlToCanvas(maskUrl);
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let on = 0;
    const n = width * height;
    for (let i = 0; i < n; i += 1) {
      if (data[i * 4] > 127) on += 1;
    }
    return n ? on / n : 0;
  } catch {
    return 0;
  }
}
