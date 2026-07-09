/** Shared descriptive statistics and distribution helpers. */

export function average(nums) {
  if (!nums?.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function median(nums) {
  if (!nums?.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stdDev(nums) {
  if (!nums?.length) return null;
  const avg = average(nums);
  return Math.sqrt(nums.reduce((s, n) => s + (n - avg) ** 2, 0) / nums.length);
}

export function descriptiveStats(nums) {
  const valid = (nums || []).map(Number).filter((n) => !Number.isNaN(n));
  if (!valid.length) {
    return { n: 0, mean: null, sd: null, median: null, min: null, max: null };
  }
  return {
    n: valid.length,
    mean: average(valid),
    sd: stdDev(valid),
    median: median(valid),
    min: Math.min(...valid),
    max: Math.max(...valid),
  };
}

export function pct(count, total) {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

export function normalPdf(x, mu, sigma) {
  if (sigma <= 1e-6) return 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

export function buildScoreHistogram(scores, binCount, domainMin = 0, domainMax = 5) {
  const n = scores.length;
  const span = domainMax - domainMin;
  const binWidth = span / binCount;
  const counts = Array(binCount).fill(0);
  for (const raw of scores) {
    const s = Math.min(domainMax, Math.max(domainMin, raw));
    let idx = Math.floor((s - domainMin) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    counts[idx] += 1;
  }
  return counts.map((count, i) => ({
    center: domainMin + (i + 0.5) * binWidth,
    binWidth,
    count,
    density: n > 0 && binWidth > 0 ? count / (n * binWidth) : 0,
  }));
}

/** Wilson score interval for a proportion (95% default). */
export function wilsonCI(successes, n, z = 1.96) {
  if (n <= 0) return { p: 0, low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return {
    p,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

/** Min-max scale values to 0–max (default 5). */
export function minMaxScale(values, maxOut = 5) {
  if (!values?.length) return [];
  const nums = values.map(Number);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min;
  if (span <= 1e-9) return nums.map(() => maxOut / 2);
  return nums.map((v) => ((v - min) / span) * maxOut);
}

export function histogramBinCount(n) {
  return Math.min(10, Math.max(5, Math.round(Math.sqrt(Math.max(n, 1)))));
}
