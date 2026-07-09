/** Video skill timeline aggregation. */

export function aggregateSegmentTimeline(answers, bucketSize = 1) {
  const duration = Math.max(
    ...answers.map(({ answer }) => Number(answer?.duration) || 0),
    ...answers.flatMap(({ answer }) => (answer?.segments || []).map((s) => s.end || 0)),
    60,
  );
  const buckets = Math.ceil(duration / bucketSize);
  const counts = Array(buckets).fill(0);
  let totalSegments = 0;

  for (const { answer } of answers) {
    const segments = answer?.segments || [];
    totalSegments += segments.length;
    for (const seg of segments) {
      const start = Math.max(0, Math.floor(seg.start / bucketSize));
      const end = Math.min(buckets - 1, Math.floor((seg.end || seg.start) / bucketSize));
      for (let b = start; b <= end; b += 1) counts[b] += 1;
    }
  }

  const n = answers.length;
  const timeline = counts.map((count, i) => ({
    t: i * bucketSize,
    count,
    proportion: n > 0 ? count / n : 0,
  }));

  const peak = timeline.reduce((best, cur) => (cur.proportion > (best?.proportion ?? 0) ? cur : best), null);

  return { timeline, duration, n, totalSegments, peakTime: peak?.t ?? null, peakProportion: peak?.proportion ?? 0 };
}

export function aggregateContinuousRating(answers, bucketSize = 1) {
  const bucketVals = {};
  let globalSum = 0;
  let globalN = 0;

  for (const { answer } of answers) {
    const samples = answer?.samples || [];
    for (const { t, v } of samples) {
      const b = Math.floor(Number(t) / bucketSize);
      if (!bucketVals[b]) bucketVals[b] = [];
      const val = Number(v);
      if (!Number.isNaN(val)) {
        bucketVals[b].push(val);
        globalSum += val;
        globalN += 1;
      }
    }
  }

  const buckets = Object.keys(bucketVals).map(Number).sort((a, b) => a - b);
  const timeline = buckets.map((b) => {
    const vals = bucketVals[b];
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    return {
      t: b * bucketSize,
      mean,
      sd: Math.sqrt(variance),
      n: vals.length,
    };
  });

  return {
    timeline,
    globalMean: globalN > 0 ? globalSum / globalN : null,
    sampleCount: globalN,
  };
}

export function exportTimelineCsv(prefix, timeline, columns) {
  const headers = columns.join(',');
  const rows = timeline.map((row) => columns.map((c) => {
    const v = row[c];
    return typeof v === 'number' ? v.toFixed(4) : v;
  }).join(','));
  return [headers, ...rows].join('\n');
}
