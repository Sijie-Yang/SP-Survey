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

/**
 * Convert a binary mask ImageData (or canvas) to normalized polygon points.
 */
export function maskCanvasToPolygon(maskCanvas, simplify = 4) {
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const ctx = maskCanvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, w, h);
  const visited = new Uint8Array(w * h);
  let best = null;

  const isOn = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return data[(y * w + x) * 4] > 127;
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
  const pts = best.boundary.filter((_, i) => i % simplify === 0);
  if (pts.length < 3) return best.boundary.slice(0, 20);
  return pts;
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
