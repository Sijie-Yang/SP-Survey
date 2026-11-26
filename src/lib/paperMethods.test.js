import {
  annotationBaseImage,
  pairwiseOutcomes, qScores, trueSkillScores, scaleScores, comparisonCounts, coverageSummary,
  splitHalfReliability, cohensKappa, weightedKappa, choiceRetestKappa, stimulusObservations,
  perStimulusStats, welchTTest, welchAnova, bfiTraitScore, responseGroups, participantGroupMap,
  pairwiseGroupComparison, pairChoiceShares, imageChoiceShares, thresholdLabels, longFormatRows,
  iccTwoWay, fleissKappa, raterAgreement, madScreen, robustStimulusStats, aggregateByParam,
  evaluativeMap, annotationNotes, samePositionParticipants, spearman,
} from './paperMethods';
import { computeQuestionTrueSkill } from './trueskill';
import { reverseCodingFor } from './analysisRecommendation';
import { fQuantile, normalQuantile, tTwoSidedP } from './statDistributions';
import { NO_PREFERENCE } from './choiceTie';

const pick = (participant, a, b, answer, extra = {}) => ({
  participant_id: participant,
  responses: { q: { answer, shown_images: [a, b] }, ...extra.responses },
  survey_metadata: extra.meta || {},
});

describe('statDistributions', () => {
  test('normal and F quantiles match tables', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.95996, 4);
    expect(fQuantile(0.975, 5, 10)).toBeCloseTo(4.236, 2);
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
  });
});

describe('Q-score (A1)', () => {
  test('acceptance fixture: A>B, A>C, B>C gives 7.5 / 5.0 / 2.5', () => {
    const rows = [pick('p1', 'A', 'B', 'A'), pick('p1', 'A', 'C', 'A'), pick('p1', 'B', 'C', 'B')];
    const q = Object.fromEntries(qScores(pairwiseOutcomes(rows, 'q'), { minComparisons: 1 }).map((r) => [r.imageKey, r.qScore]));
    expect(q.A).toBeCloseTo(7.5, 6);
    expect(q.B).toBeCloseTo(5.0, 6);
    expect(q.C).toBeCloseTo(2.5, 6);
  });

  test('ties enter the denominator only and minimum comparisons flag images', () => {
    const rows = [pick('p1', 'A', 'B', 'A'), pick('p2', 'A', 'C', NO_PREFERENCE)];
    const res = qScores(pairwiseOutcomes(rows, 'q'), { minComparisons: 2 });
    const a = res.find((r) => r.imageKey === 'A');
    expect(a.W).toBeCloseTo(0.5);
    expect(a.ties).toBe(1);
    expect(res.find((r) => r.imageKey === 'B').sufficient).toBe(false);
    expect(res.find((r) => r.imageKey === 'B').qScore).toBeNull();
  });

  test('legacy <name>_equal boolean turns the trial into a tie', () => {
    const rows = [pick('p1', 'A', 'B', 'A', { responses: { q_equal: true } })];
    const [o] = pairwiseOutcomes(rows, 'q');
    expect(o.tie).toBe(true);
  });
});

describe('TrueSkill options (A2, A3)', () => {
  const rows = [
    pick('p1', 'A', 'B', 'A'), pick('p2', 'B', 'C', 'B'), pick('p3', 'A', 'C', 'A'),
    pick('p4', 'C', 'B', NO_PREFERENCE), pick('p5', 'A', 'B', 'B'),
  ];

  test('exclude with one run reproduces the existing TrueSkill', () => {
    const base = computeQuestionTrueSkill(rows, 'q');
    const ours = trueSkillScores(pairwiseOutcomes(rows, 'q'));
    base.rankings.forEach((r) => {
      expect(ours.rows.find((x) => x.imageKey === r.imageKey).mu).toBeCloseTo(r.mu, 10);
    });
    expect(ours.observedTies.ties).toBe(1);
  });

  test('draw handling moves tied players together and is seed-deterministic', () => {
    const outs = pairwiseOutcomes(rows, 'q');
    const drawn = trueSkillScores(outs, { tieHandling: 'draw' });
    expect(drawn.tieHandling).toBe('draw');
    const a = trueSkillScores(outs, { runs: 20, seed: 7 });
    const b = trueSkillScores(outs, { runs: 20, seed: 7 });
    expect(a.rows).toEqual(b.rows);
    expect(a.rows[0].muSd).toBeGreaterThanOrEqual(0);
  });

  test('a single tie between new players leaves μ equal and lowers σ', () => {
    const res = trueSkillScores(pairwiseOutcomes([pick('p', 'X', 'Y', NO_PREFERENCE)], 'q'), { tieHandling: 'draw', drawProbability: 0.2 });
    const [x, y] = res.rows;
    expect(x.mu).toBeCloseTo(y.mu, 8);
    expect(x.sigma).toBeLessThan(25 / 3);
  });
});

describe('scaling and coverage (A4, A5)', () => {
  test('min–max scaling to the chosen range', () => {
    const scaled = scaleScores([{ v: 1 }, { v: 3 }, { v: 5 }], 'v', '0-1');
    expect(scaled.map((r) => r.scaled)).toEqual([0, 0.5, 1]);
  });

  test('coverage summary counts images below threshold', () => {
    const outs = pairwiseOutcomes([pick('p', 'A', 'B', 'A'), pick('p', 'A', 'C', 'C')], 'q');
    const cov = coverageSummary(comparisonCounts(outs), 2);
    expect(cov).toMatchObject({ images: 3, min: 1, max: 2, below: 2 });
  });

  test('split-half reliability is deterministic and bounded', () => {
    const rows = [];
    for (let p = 0; p < 12; p += 1) {
      rows.push(pick(`p${p}`, 'A', 'B', 'A'), pick(`p${p}`, 'B', 'C', 'B'), pick(`p${p}`, 'A', 'C', 'A'));
    }
    const outs = pairwiseOutcomes(rows, 'q');
    const r1 = splitHalfReliability(outs, { method: 'share', splits: 20, seed: 3 });
    const r2 = splitHalfReliability(outs, { method: 'share', splits: 20, seed: 3 });
    expect(r1).toEqual(r2);
    expect(r1.mean).toBeCloseTo(1, 6);
  });

  test('kappa helpers', () => {
    expect(cohensKappa([['a', 'a'], ['b', 'b'], ['a', 'b'], ['b', 'a']])).toBeCloseTo(0, 6);
    expect(cohensKappa([['a', 'a'], ['b', 'b']])).toBeCloseTo(1, 6);
    expect(weightedKappa([[1, 1], [2, 2], [3, 3], [4, 4]])).toBeCloseTo(1, 6);
    const retest = choiceRetestKappa(pairwiseOutcomes([pick('p', 'A', 'B', 'A'), pick('p', 'B', 'A', 'A')], 'q'));
    expect(retest.pairs).toBe(1);
  });
});

describe('ratings (A6, A10, A11, A13)', () => {
  const rating = { name: 'r', type: 'imagerating' };
  const rateRow = (p, img, value, site) => ({
    participant_id: p,
    responses: { r: { answer: value, shown_images: [img] } },
    survey_metadata: site ? { url_params: { site } } : {},
  });

  test('per-stimulus statistics', () => {
    const obs = stimulusObservations([rateRow('a', 'X', 4), rateRow('b', 'X', 2), rateRow('c', 'Y', 5)], rating);
    const stats = perStimulusStats(obs);
    expect(stats.find((s) => s.stimulus === 'X')).toMatchObject({ n: 2, mean: 3 });
  });

  test('matrix columns with text labels map to their position', () => {
    const q = { name: 'm', type: 'imagematrix', rows: ['play'], columns: ['very unplayable', 'unplayable', 'neither', 'playable', 'very playable'] };
    const row = { participant_id: 'a', responses: { m: { answer: { play: 'playable' }, shown_images: ['X'] } } };
    expect(stimulusObservations([row], q, { row: 'play' })[0].value).toBe(4);
  });

  test('ICC matches Shrout & Fleiss (1979): ICC(2,1)=0.29, ICC(2,k)=0.62', () => {
    const data = [[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]];
    const icc = iccTwoWay(data);
    expect(icc.icc1).toBeCloseTo(0.29, 2);
    expect(icc.iccK).toBeCloseTo(0.62, 2);
    expect(icc.icc1Low).toBeLessThan(icc.icc1);
    expect(icc.icc1High).toBeGreaterThan(icc.icc1);
  });

  test('rater agreement from observations and Fleiss kappa', () => {
    const rows = [rateRow('r1', 'X', 4), rateRow('r2', 'X', 4), rateRow('r1', 'Y', 1), rateRow('r2', 'Y', 2), rateRow('r1', 'Z', 3), rateRow('r2', 'Z', 3)];
    const agree = raterAgreement(stimulusObservations(rows, rating));
    expect(agree.raters).toBe(2);
    expect(agree.stimuli).toBe(3);
    expect(agree.icc.icc1).toBeGreaterThan(0.8);
    expect(fleissKappa([['a', 'a'], ['b', 'b'], ['a', 'a']])).toBeCloseTo(1, 6);
  });

  test('MAD screening removes an obvious outlier', () => {
    const s = madScreen([7, 7, 8, 6, 7, 8, 7, 0]);
    expect(s.removed).toEqual([0]);
    const robust = robustStimulusStats([7, 7, 8, 6, 7, 8, 7, 0].map((value) => ({ stimulus: 'X', value })));
    expect(robust[0]).toMatchObject({ nBefore: 8, nAfter: 7, median: 7 });
  });

  test('aggregation by URL parameter', () => {
    const obs = stimulusObservations([rateRow('a', 'X', 40, 'S01'), rateRow('b', 'X', 60, 'S01'), rateRow('c', 'Y', 10, 'S02')], rating);
    const agg = aggregateByParam(obs, 'site');
    expect(agg[0]).toMatchObject({ value: 'S01', n: 2, mean: 50 });
    expect(agg[1].low).toBeNull();
  });
});

describe('groups and conditions (A7, A12)', () => {
  test('Welch t-test and two-group Welch ANOVA agree', () => {
    const a = [1, 2, 3, 4, 5]; const b = [2, 4, 6, 8, 10];
    const t = welchTTest(a, b);
    expect(t.t).toBeCloseTo(-1.8974, 3);
    expect(t.df).toBeCloseTo(5.882, 2);
    const f = welchAnova([a, b]);
    expect(f.F).toBeCloseTo(t.t ** 2, 6);
    expect(f.p).toBeCloseTo(t.p, 4);
  });

  test('BFI-10 trait scoring with reverse items', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ name: `bfi${i + 1}`, choices: ['1', '2', '3', '4', '5'] }));
    const row = { responses: { bfi1: '1', bfi6: '5' } };
    expect(bfiTraitScore(row, 'extraversion', items)).toBe(5);
  });

  test('reverse-coded condition pools with the direct wording', () => {
    const rows = [
      pick('s1', 'A', 'B', 'A', { meta: { condition: 'safe' } }),
      { participant_id: 'l1', responses: { q2: { answer: 'B', shown_images: ['A', 'B'] } }, survey_metadata: { condition: 'less_safe' } },
    ];
    const outs = [...pairwiseOutcomes(rows, 'q'), ...pairwiseOutcomes(rows, 'q2', { reverseCoded: true })];
    expect(outs.every((o) => o.winner === 'A')).toBe(true);
    const groups = participantGroupMap(rows, responseGroups(rows, { type: 'condition' }));
    const cmp = pairwiseGroupComparison(outs, groups, { method: 'share' });
    expect(cmp.boards.map((b) => b.group)).toEqual(['less_safe', 'safe']);
  });

  test('spearman with ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
  });
});

describe('choice shares, export, labels (A8, A14, A16)', () => {
  const rows = [pick('p1', 'A', 'B', 'A'), pick('p2', 'A', 'B', 'A'), pick('p3', 'B', 'A', NO_PREFERENCE), pick('p4', 'A', 'C', 'A')];

  test('pair shares with Wilson CI and image shares', () => {
    const pairs = pairChoiceShares(pairwiseOutcomes(rows, 'q'));
    const ab = pairs.find((p) => p.first === 'A' && p.second === 'B');
    expect(ab).toMatchObject({ firstChosen: 2, secondChosen: 0, ties: 1, n: 3, share: 1 });
    const shares = imageChoiceShares(rows, 'q');
    expect(shares.find((s) => s.imageKey === 'A')).toMatchObject({ shown: 4, chosen: 3 });
    expect(imageChoiceShares(rows, 'q', { reverseCoded: true }).find((s) => s.imageKey === 'A').chosen).toBe(0);
  });

  test('threshold labels', () => {
    const labels = thresholdLabels(imageChoiceShares(rows, 'q'), 3);
    expect(labels.find((l) => l.imageKey === 'A').label).toBe(1);
    expect(labels.find((l) => l.imageKey === 'B').label).toBe(0);
  });

  test('long-format export carries covariates and URL parameters', () => {
    const config = { pages: [{ elements: [{ name: 'gender', type: 'radiogroup' }, { name: 'q', type: 'imagepicker' }] }] };
    const data = [{ participant_id: 'p1', responses: { gender: 'F', q: { answer: 'B', shown_images: ['A', 'B'] } }, survey_metadata: { url_params: { site: 'S1' } } }];
    const [row] = longFormatRows(data, config, 'q');
    expect(row).toMatchObject({ participant_id: 'p1', outcome: 'B', chosen_position: 'right', gender: 'F', url_site: 'S1' });
  });

  test('same-position responders are flagged', () => {
    const data = Array.from({ length: 5 }, (_, i) => pick('p', `L${i}`, `R${i}`, `L${i}`));
    expect(samePositionParticipants(pairwiseOutcomes(data, 'q'), 5)).toEqual(['p']);
  });
});

describe('evaluative map and notes (A15, S5)', () => {
  test('liked minus disliked density on a grid', () => {
    const shape = (x, y, label, note) => ({ tool: 'point', label, note, points: [{ x, y }] });
    const rows = [
      { participant_id: 'a', responses: { liked: { answer: { shapes: [shape(0.1, 0.1, 'Liked', 'trees')] }, shown_images: ['map'] }, disliked: { answer: { shapes: [shape(0.9, 0.9, 'Disliked')] }, shown_images: ['map'] } } },
      { participant_id: 'b', responses: { liked: { answer: { shapes: [shape(0.1, 0.1, 'Liked')] }, shown_images: ['map'] } } },
    ];
    const map = evaluativeMap(rows, 'liked', 'disliked', { grid: 10 });
    expect(map.cells.find((c) => c.row === 1 && c.col === 1)).toMatchObject({ liked: 1, disliked: 0, diff: 1 });
    expect(map.cells.find((c) => c.row === 9 && c.col === 9).diff).toBe(-1);
    expect(annotationNotes(rows, 'liked')).toEqual([{ participant_id: 'a', label: 'Liked', note: 'trees' }]);
  });
});

test('annotationBaseImage picks the most shown map', () => {
  const row = (url) => ({ responses: { liked: { answer: { shapes: [] }, shown_images: [url] } } });
  expect(annotationBaseImage([row('a.png'), row('b.png'), row('b.png')], 'liked')).toBe('b.png');
  expect(annotationBaseImage([], 'liked')).toBe('');
});

test('per-condition reverse coding flips only that condition', () => {
  const row = (condition) => ({ survey_metadata: { condition }, responses: { q: { answer: 'a', shown_images: ['a', 'b'] } } });
  const rev = reverseCodingFor({}, { name: 'q', conditionVariants: [{ condition: 'less', reverseCoded: true }] });
  const out = pairwiseOutcomes([row('more'), row('less')], 'q', { reverseCoded: rev });
  expect(out.map((o) => o.winner)).toEqual(['a', 'b']);
  expect(out.map((o) => o.chosenPosition)).toEqual([0, 0]);
});
