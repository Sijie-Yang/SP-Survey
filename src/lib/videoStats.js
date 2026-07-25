/** Video skill timeline aggregation. */

import { videoStimulusKey } from './skillMediaUtils.js';

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

/**
 * Group key-moment answers by video stimulus, then aggregate a timeline per video.
 * @returns {{ videoKey: string, videoUrl: string|null, answers: object[], agg: object }[]}
 */
export function aggregateSegmentTimelineByVideo(answers, bucketSize = 1) {
  const groups = new Map();
  for (const entry of answers || []) {
    const key = videoStimulusKey(entry.answer, entry.shown_images);
    if (!groups.has(key)) {
      const url = entry.answer?.videoUrl
        || entry.answer?.posterUrl
        || (Array.isArray(entry.shown_images) ? entry.shown_images[0] : null)
        || null;
      groups.set(key, { videoKey: key, videoUrl: url, answers: [] });
    }
    const g = groups.get(key);
    if (!g.videoUrl) {
      g.videoUrl = entry.answer?.videoUrl || entry.answer?.posterUrl || entry.shown_images?.[0] || null;
    }
    g.answers.push(entry);
  }

  return [...groups.values()]
    .map((g) => ({
      ...g,
      agg: aggregateSegmentTimeline(g.answers, bucketSize),
    }))
    .sort((a, b) => String(a.videoKey).localeCompare(String(b.videoKey)));
}

/** Per-video summary stats for export (unit = video). */
export function summarizeVideoMomentsByVideo(answers) {
  const byVideo = aggregateSegmentTimelineByVideo(answers);
  return byVideo.map(({ videoKey, videoUrl, answers: rows, agg }) => {
    const segCounts = rows.map((a) => (a.answer?.segments || []).length);
    const totalSegments = segCounts.reduce((s, n) => s + n, 0);
    const meanSegments = rows.length ? totalSegments / rows.length : 0;
    const segDurations = rows.flatMap(({ answer }) => (
      (answer?.segments || []).map((s) => Number(s.end) - Number(s.start))
    )).filter((n) => !Number.isNaN(n) && n >= 0);
    const meanSegDuration = segDurations.length
      ? segDurations.reduce((a, b) => a + b, 0) / segDurations.length
      : null;
    const durations = rows.map((a) => Number(a.answer?.duration)).filter((n) => !Number.isNaN(n) && n > 0);
    const meanVideoDuration = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
    return {
      videoKey,
      videoUrl,
      nResponses: rows.length,
      totalSegments,
      meanSegments,
      meanSegDuration,
      meanVideoDuration,
      peakTime: agg.peakTime,
      peakProportion: agg.peakProportion,
    };
  });
}

/**
 * Group continuous-rating answers by video, then aggregate each timeline.
 */
export function aggregateContinuousRatingByVideo(answers, bucketSize = 1) {
  const groups = new Map();
  for (const entry of answers || []) {
    const key = videoStimulusKey(entry.answer, entry.shown_images);
    if (!groups.has(key)) {
      groups.set(key, {
        videoKey: key,
        videoUrl: entry.answer?.videoUrl || entry.shown_images?.[0] || null,
        answers: [],
      });
    }
    const g = groups.get(key);
    if (!g.videoUrl) {
      g.videoUrl = entry.answer?.videoUrl || entry.shown_images?.[0] || null;
    }
    g.answers.push(entry);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      agg: aggregateContinuousRating(g.answers, bucketSize),
      means: g.answers.map((a) => Number(a.answer?.mean)).filter((n) => !Number.isNaN(n)),
    }))
    .sort((a, b) => String(a.videoKey).localeCompare(String(b.videoKey)));
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
