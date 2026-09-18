/** Ranking statistics: Borda scores and Kendall's W. */

import { average } from './stats.js';

/**
 * Borda score from rank positions (1 = best).
 * score = (nItems - rank + 1) averaged across responses.
 */
export function computeBordaScores(rankingsByItem, nItems) {
  const scores = {};
  for (const [item, ranks] of Object.entries(rankingsByItem)) {
    const bordaVals = ranks.map((rank) => nItems - rank + 1);
    scores[item] = {
      borda: average(bordaVals),
      avgRank: average(ranks),
      n: ranks.length,
    };
  }
  return scores;
}

/**
 * Kendall's W (coefficient of concordance) for rank data.
 * rankings: array of arrays, each inner = ordered item ids (best first).
 */
export function kendallW(rankings, items) {
  const m = rankings.length; // judges
  const n = items.length; // items
  if (m < 2 || n < 2 || new Set(items).size !== n) return null;
  const itemSet = new Set(items);
  if (rankings.some((r) => !Array.isArray(r) || r.length !== n
    || new Set(r).size !== n || r.some((item) => !itemSet.has(item)))) return null;

  const rankSums = {};
  items.forEach((item) => { rankSums[item] = 0; });

  for (const ranking of rankings) {
    ranking.forEach((item, idx) => {
      if (rankSums[item] !== undefined) rankSums[item] += idx + 1;
    });
  }

  const sums = Object.values(rankSums);
  const meanSum = sums.reduce((a, b) => a + b, 0) / n;
  const ss = sums.reduce((s, ri) => s + (ri - meanSum) ** 2, 0);
  const w = (12 * ss) / (m ** 2 * (n ** 3 - n));
  return Number.isFinite(w) ? w : null;
}

export function interpretKendallW(w) {
  if (w == null) return 'Requires at least two complete rankings of the same items, without ties';
  if (w >= 0.7) return 'Strong agreement among participants (W ≥ 0.70)';
  if (w >= 0.5) return 'Moderate agreement (W ≥ 0.50)';
  if (w >= 0.3) return 'Fair agreement — interpret with caution';
  return 'Weak agreement — rankings vary substantially';
}
