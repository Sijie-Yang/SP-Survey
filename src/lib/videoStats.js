/** Video skill timeline aggregation. */

import { videoStimulusKey } from './skillMediaUtils.js';

function validSegments(answer) {
  return (Array.isArray(answer?.segments) ? answer.segments : []).filter((s) => (
    Number.isFinite(s?.start) && Number.isFinite(s?.end) && s.start >= 0 && s.end > s.start
    && (!Number.isFinite(answer.duration) || s.end <= answer.duration)
  ));
}

export function aggregateSegmentTimeline(answers, bucketSize = 1) {
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) throw new Error('bucketSize must be positive');
  const duration = Math.max(0, ...answers.map(({ answer }) => (
    Number.isFinite(answer?.duration) && answer.duration > 0 ? answer.duration : 0
  )), ...answers.flatMap(({ answer }) => validSegments(answer).map((s) => s.end)));
  // Bound memory for malformed historical durations.
  const step = Math.max(bucketSize, duration / 100000);
  const counts = Array(Math.ceil(duration / step)).fill(0);
  let totalSegments = 0;
  for (const { answer } of answers) {
    const covered = new Set();
    const segments = validSegments(answer);
    totalSegments += segments.length;
    for (const seg of segments) {
      for (let b = Math.floor(seg.start / step); b < Math.ceil(seg.end / step); b += 1) covered.add(b);
    }
    covered.forEach((b) => { counts[b] += 1; });
  }
  const n = answers.length;
  const timeline = counts.map((count, i) => ({ t: i * step, count, proportion: n ? count / n : 0 }));
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
    const segCounts = rows.map((a) => validSegments(a.answer).length);
    const totalSegments = segCounts.reduce((s, n) => s + n, 0);
    const meanSegments = rows.length ? totalSegments / rows.length : 0;
    const segDurations = rows.flatMap(({ answer }) => (
      validSegments(answer).map((s) => s.end - s.start)
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
      means: g.answers.map((a) => aggregateContinuousRating([a], bucketSize).globalMean).filter(Number.isFinite),
    }))
    .sort((a, b) => String(a.videoKey).localeCompare(String(b.videoKey)));
}

/** Equal weight per response, after averaging its samples within each time bucket. */
export function aggregateContinuousRating(answers, bucketSize = 1) {
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) throw new Error('bucketSize must be positive');
  const bucketVals = new Map();
  const responseMeans = [];
  let sampleCount = 0;
  for (const { answer } of answers) {
    const own = new Map();
    for (const { t, v } of (Array.isArray(answer?.samples) ? answer.samples : [])) {
      if (!Number.isFinite(t) || t < 0 || !Number.isFinite(v)) continue;
      const b = Math.floor(t / bucketSize);
      if (!own.has(b)) own.set(b, []);
      own.get(b).push(v);
      sampleCount += 1;
    }
    const means = [];
    own.forEach((vals, b) => {
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      means.push(mean);
      if (!bucketVals.has(b)) bucketVals.set(b, []);
      bucketVals.get(b).push(mean);
    });
    if (means.length) responseMeans.push(means.reduce((s, v) => s + v, 0) / means.length);
  }
  const timeline = [...bucketVals.keys()].sort((a, b) => a - b).map((b) => {
    const vals = bucketVals.get(b);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return { t: b * bucketSize, mean,
      sd: Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length), n: vals.length };
  });
  return { timeline, globalMean: responseMeans.length
    ? responseMeans.reduce((s, v) => s + v, 0) / responseMeans.length : null,
  sampleCount, responseCount: responseMeans.length };
}

export function exportTimelineCsv(prefix, timeline, columns) {
  const headers = columns.join(',');
  const rows = timeline.map((row) => columns.map((c) => {
    const v = row[c];
    return typeof v === 'number' ? v.toFixed(4) : v;
  }).join(','));
  return [headers, ...rows].join('\n');
}
