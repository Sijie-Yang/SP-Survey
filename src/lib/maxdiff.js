/** Best-Worst Scaling (MaxDiff) scoring. */

import { minMaxScale } from './stats';

function filenameKey(val) {
  if (!val || typeof val !== 'string') return String(val ?? '');
  return val.split('?')[0].split('/').pop();
}

/**
 * Compute BWS scores from MaxDiff answers.
 * answer shape: { bestIndex, worstIndex, bestUrl?, worstUrl?, complete? }
 * shown_images or config mediaCount determines option set per trial.
 */
export function computeMaxDiffScores(answers, mediaCount = 4) {
  const stats = {}; // key -> { best, worst, appearances }

  answers.forEach(({ answer, shown_images: shown }) => {
    if (!answer || typeof answer !== 'object') return;
    const { bestIndex, worstIndex } = answer;
    if (bestIndex == null && worstIndex == null) return;

    const resolvedShown = shown?.length ? shown : (answer.shownUrls || []);
    const n = resolvedShown.length || mediaCount;
    const entries = resolvedShown.length
      ? resolvedShown.map((img) => {
        const s = typeof img === 'string' ? img : img?.url || img?.name || '';
        return { key: filenameKey(s), url: s };
      })
      : Array.from({ length: n }, (_, i) => ({ key: `option_${i}`, url: null }));

    entries.forEach(({ key, url }, idx) => {
      if (!stats[key]) stats[key] = { best: 0, worst: 0, appearances: 0, url };
      if (url && !stats[key].url) stats[key].url = url;
      stats[key].appearances += 1;
      if (idx === bestIndex) stats[key].best += 1;
      if (idx === worstIndex) stats[key].worst += 1;
    });
  });

  const rankings = Object.entries(stats).map(([imageKey, s]) => {
    const bws = s.appearances > 0 ? (s.best - s.worst) / s.appearances : 0;
    return { imageKey, imageUrl: s.url || imageKey, ...s, bws };
  }).sort((a, b) => b.bws - a.bws);

  const bwsValues = rankings.map((r) => r.bws);
  const scaled = minMaxScale(bwsValues, 5);
  return rankings.map((r, i) => ({
    ...r,
    rank: i + 1,
    scoreStd5: scaled[i],
  }));
}

export function exportMaxDiffCsv(questionName, rankings) {
  const headers = ['rank', 'image', 'bws_score', 'score_std5', 'best_count', 'worst_count', 'appearances'];
  const rows = rankings.map((r) => [
    r.rank, r.imageKey, r.bws.toFixed(4), (r.scoreStd5 ?? 0).toFixed(4),
    r.best, r.worst, r.appearances,
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
