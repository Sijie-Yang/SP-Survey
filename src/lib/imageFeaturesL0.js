/**
 * Built-in L0 image features (sp_l0_v1): paper ventral pathway + streetscape proxies.
 * Runs in the browser via Canvas — no API / no neural net.
 */

import { getR2ServerUrl, isR2ProxyUnreachable, noteR2ProxyFailure } from './r2';

export const L0_MODEL = 'sp_l0_v1';
export const L0_MAX_SIDE = 512;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i += 1) s += arr[i];
  return s / arr.length;
}

function variance(arr, m = mean(arr)) {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i += 1) {
    const d = arr[i] - m;
    s += d * d;
  }
  return s / arr.length;
}

function stddev(arr, m = mean(arr)) {
  return Math.sqrt(variance(arr, m));
}

/** sRGB 0–255 → OpenCV-style HSV: H 0–179, S/V 0–255 */
function rgbToHsvOpenCv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return {
    h: Math.round((h / 2) * 10) / 10,
    s: Math.round(s * 255),
    v: Math.round(v * 255),
  };
}

/** Approximate CIE Lab L* from sRGB (D65). */
function rgbToLabL(r, g, b) {
  let rn = r / 255;
  let gn = g / 255;
  let bn = b / 255;
  rn = rn > 0.04045 ? ((rn + 0.055) / 1.055) ** 2.4 : rn / 12.92;
  gn = gn > 0.04045 ? ((gn + 0.055) / 1.055) ** 2.4 : gn / 12.92;
  bn = bn > 0.04045 ? ((bn + 0.055) / 1.055) ** 2.4 : bn / 12.92;
  let y = rn * 0.2126 + gn * 0.7152 + bn * 0.0722;
  y /= 1;
  const fy = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116;
  return 116 * fy - 16;
}

function grayOf(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Hasler–Süsstrunk colourfulness */
function colorfulnessMetric(rg, yb) {
  const meanRg = mean(rg);
  const meanYb = mean(yb);
  const stdRg = stddev(rg, meanRg);
  const stdYb = stddev(yb, meanYb);
  return Math.sqrt(stdRg * stdRg + stdYb * stdYb) + 0.3 * Math.sqrt(meanRg * meanRg + meanYb * meanYb);
}

function shannonEntropy(hist, total) {
  if (!total) return 0;
  let e = 0;
  for (let i = 0; i < hist.length; i += 1) {
    if (!hist[i]) continue;
    const p = hist[i] / total;
    e -= p * Math.log2(p);
  }
  return e;
}

function sobelMagnitude(gray, w, h, x, y) {
  const at = (xx, yy) => gray[yy * w + xx] || 0;
  const gx =
    -at(x - 1, y - 1) + at(x + 1, y - 1)
    - 2 * at(x - 1, y) + 2 * at(x + 1, y)
    - at(x - 1, y + 1) + at(x + 1, y + 1);
  const gy =
    -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
    + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
  return Math.sqrt(gx * gx + gy * gy);
}

function laplacianAt(gray, w, h, x, y) {
  const at = (xx, yy) => gray[yy * w + xx] || 0;
  return at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1) - 4 * at(x, y);
}

function needsCorsProxy(url) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return true;
  }
}

/** Fetch cross-origin image via public URL (CORS) or Express/CF proxy → blob URL (canvas-safe). */
async function resolveLoadableUrl(url) {
  if (!needsCorsProxy(url)) return { src: url, revoke: null };

  // Prefer direct public fetch (R2.dev usually allows CORS) so CRA-only local
  // dev does not require Express :3001 image-proxy.
  try {
    const direct = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (direct.ok) {
      const blob = await direct.blob();
      const objectUrl = URL.createObjectURL(blob);
      return { src: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) };
    }
  } catch {
    /* fall through to proxy */
  }

  if (isR2ProxyUnreachable()) {
    throw new Error('R2 image-proxy unreachable; cannot load cross-origin image for features');
  }

  const proxy = `${getR2ServerUrl()}/api/r2/image-proxy?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(proxy);
    if (!res.ok) {
      const text = await res.text();
      let msg = text.slice(0, 200);
      try {
        msg = JSON.parse(text).error || msg;
      } catch { /* ignore */ }
      throw new Error(msg || `Image proxy failed (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    return { src: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) };
  } catch (err) {
    noteR2ProxyFailure(err, 'image-proxy');
    throw err;
  }
}

/**
 * Load image URL into ImageData.
 * Cross-origin R2 URLs go through /api/r2/image-proxy to avoid CORS tainting.
 */
export async function loadImageData(url, maxSide = L0_MAX_SIDE, timeoutMs = 20000) {
  const { src, revoke } = await resolveLoadableUrl(url);
  return new Promise((resolve, reject) => {
    const img = new Image();
    // blob: URLs don't need crossOrigin; same-origin neither
    if (!src.startsWith('blob:')) img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => {
      if (revoke) revoke();
      img.src = '';
      reject(new Error(`Image load timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      try {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        resolve({ data, width: w, height: h });
      } catch (err) {
        reject(err);
      } finally {
        if (revoke) revoke();
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      if (revoke) revoke();
      reject(new Error('Failed to load image for feature extraction'));
    };
    img.src = src;
  });
}

/**
 * Extract sp_l0_v1 features from an image URL.
 */
export async function extractL0Features(imageUrl) {
  const { data, width, height } = await loadImageData(imageUrl);
  const { data: px } = data;
  const n = width * height;
  const hues = new Float32Array(n);
  const sats = new Float32Array(n);
  const labs = new Float32Array(n);
  const grays = new Float32Array(n);
  const rgArr = new Float32Array(n);
  const ybArr = new Float32Array(n);
  const grayHist = new Array(256).fill(0);
  const hueHist = new Array(180).fill(0);

  let green = 0;
  let sky = 0;
  let warm = 0;
  let cool = 0;
  let centerSum = 0;
  let centerCount = 0;
  const x0 = Math.floor(width * 0.375);
  const x1 = Math.ceil(width * 0.625);
  const y0 = Math.floor(height * 0.375);
  const y1 = Math.ceil(height * 0.625);

  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const r = px[p];
    const g = px[p + 1];
    const b = px[p + 2];
    const hsv = rgbToHsvOpenCv(r, g, b);
    const L = rgbToLabL(r, g, b);
    const gy = grayOf(r, g, b);
    hues[i] = hsv.h;
    sats[i] = hsv.s;
    labs[i] = L;
    grays[i] = gy;
    grayHist[clamp(Math.round(gy), 0, 255)] += 1;
    hueHist[clamp(Math.round(hsv.h), 0, 179)] += 1;

    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgArr[i] = rg;
    ybArr[i] = yb;

    const x = i % width;
    const y = Math.floor(i / width);
    // greenery heuristic (HSV)
    if (hsv.h >= 35 && hsv.h <= 85 && hsv.s >= 40 && hsv.v >= 40) green += 1;
    if (y < height / 2 && hsv.v >= 160 && hsv.s <= 60) sky += 1;
    if (hsv.h < 30 || hsv.h > 150) warm += 1;
    else cool += 1;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) {
      centerSum += L;
      centerCount += 1;
    }
  }

  let edgeSum = 0;
  const lapVars = [];
  const edgeThresh = 80;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const mag = sobelMagnitude(grays, width, height, x, y);
      if (mag > edgeThresh) edgeSum += 1;
      lapVars.push(laplacianAt(grays, width, height, x, y));
    }
  }
  const edgePixels = (width - 2) * (height - 2) || 1;

  const features = {
    width,
    height,
    aspect_ratio: height ? width / height : 0,
    Hue_Mean: mean(hues),
    Hue_Std: stddev(hues),
    Saturation_Mean: mean(sats),
    Saturation_Std: stddev(sats),
    hue_entropy: shannonEntropy(hueHist, n),
    Brightness_Mean: mean(labs),
    Brightness_Std: stddev(labs),
    Contrast: stddev(grays),
    Image_Variance: variance(grays),
    center_brightness: centerCount ? centerSum / centerCount : 0,
    Colorfulness: colorfulnessMetric(rgArr, ybArr),
    warm_ratio: warm / n,
    cool_ratio: cool / n,
    EdgePixelRatio: (edgeSum / edgePixels) * 100,
    Sharpness: variance(lapVars),
    Entropy: shannonEntropy(grayHist, n),
    greenery_ratio: green / n,
    sky_ratio_heuristic: sky / n,
  };

  return {
    model: L0_MODEL,
    features,
    status: 'ready',
    computed_at: new Date().toISOString(),
    compute_runtime: 'browser',
  };
}
