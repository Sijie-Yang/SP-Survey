import { computeTrueSkillRatings } from './trueskill';
import { krippendorffAlpha } from './reliability';
import { kendallW } from './rankingStats';
import { aggregateSegmentTimeline, aggregateContinuousRating } from './videoStats';
import { prepareAblationFold, runPerceptionAblation } from './perceptionAblation';
import { allocationStatus } from './allocationStats';
import { buildQuestionSummaryRows, buildManifest } from './questionSummaryExport';

const row = (id, media, answer) => ({ id, participant_id: id, responses: { q: { answer, shown_images: [media] } } });

test('TrueSkill matches the equal-prior decisive 1v1 reference update', () => {
  const ratings = computeTrueSkillRatings([{ winner: 'a', loser: 'b' }]);
  expect(ratings.get('a').mu).toBeCloseTo(29.20547, 4);
  expect(ratings.get('a').sigma).toBeCloseTo(7.19482, 4);
  expect(ratings.get('b').mu).toBeCloseTo(20.79453, 4);
});

test('an upset moves ratings more than another expected win; long runs remain finite', () => {
  const games = Array.from({ length: 30 }, () => ({ winner: 'a', loser: 'b' }));
  const before = computeTrueSkillRatings(games).get('a').mu;
  const expected = computeTrueSkillRatings([...games, games[0]]).get('a').mu - before;
  const upset = before - computeTrueSkillRatings([...games, { winner: 'b', loser: 'a' }]).get('a').mu;
  expect(expected).toBeGreaterThan(0);
  expect(upset).toBeGreaterThan(expected);
  expect(Number.isFinite(upset)).toBe(true);
  expect(computeTrueSkillRatings([{ winner: 'a', loser: 'a' }]).size).toBe(0);
});

test('alpha weights coincidence counts with unequal coder coverage', () => {
  const rows = [row('p1', 'a', 0), row('p2', 'a', 1), row('p1', 'b', 0), row('p2', 'b', 0), row('p3', 'b', 0)];
  // Do = 2/5; De = 2/5 -> alpha = 0. Pair pooling incorrectly gives .375.
  expect(krippendorffAlpha(rows, 'q', { level: 'nominal' })).toBeCloseTo(0, 12);
  expect(krippendorffAlpha(rows.map((r) => row(r.id, r.responses.q.shown_images[0], 0)), 'q')).toBeNull();
});

test('Kendall W declines incomplete, duplicate or different item sets', () => {
  expect(kendallW([['a', 'b'], ['a', 'b']], ['a', 'b'])).toBe(1);
  expect(kendallW([['a', 'b'], ['b', 'a']], ['a', 'b'])).toBe(0);
  expect(kendallW([['a', 'b'], ['c', 'd']], ['a', 'b', 'c', 'd'])).toBeNull();
  expect(kendallW([['a', 'a'], ['a', 'b']], ['a', 'b'])).toBeNull();
});

test('overlapping segments count once and exclude their exact end boundary', () => {
  const a = aggregateSegmentTimeline([{ answer: { duration: 5, segments: [{ start: 1, end: 3 }, { start: 2, end: 3 }] } }]);
  expect(a.peakProportion).toBe(1);
  expect(a.timeline.map((b) => b.count)).toEqual([0, 1, 1, 0, 0]);
});

test('sampling density does not weight a response more; UI and export agree', () => {
  const a = { samples: [{ t: 0, v: 0 }] };
  const b = { samples: [{ t: 0, v: 100 }, { t: .1, v: 100 }, { t: .2, v: 100 }] };
  const agg = aggregateContinuousRating([{ answer: a }, { answer: b }]);
  expect(agg.globalMean).toBe(50);
  expect(agg.timeline[0]).toMatchObject({ mean: 50, n: 2 });
  expect(agg.sampleCount).toBe(4);
  const summary = buildQuestionSummaryRows({ name: 'q', type: 'skillquestion', skillId: 'preset_video_continuous_rating' }, [row('p1', 'a.mp4', a), row('p2', 'a.mp4', b)]);
  expect(summary.find((r) => r.metric === 'equal_response_mean').value).toBe(50);
});

test('partial allocation is valid; negative, unknown and excess points are not', () => {
  const question = { name: 'q', type: 'pointallocation', budget: 100, choices: ['a', 'b'] };
  expect(allocationStatus({ a: 20, b: 0 }, question)).toMatchObject({ valid: true, full: false });
  for (const value of [{ a: -1 }, { c: 50 }, { a: 101 }, { a: Infinity }]) expect(allocationStatus(value, question).valid).toBe(false);
  const summary = buildQuestionSummaryRows(question, [row('p1', 'a', { a: 20 })]);
  expect(summary.find((r) => r.metric === 'budget_compliance_rate').value).toBe(1);
  expect(summary.find((r) => r.metric === 'budget_full_use_rate').value).toBe(0);
});

test('held-out values cannot affect fitted imputation, scaling or VIF selection', async () => {
  const train = [[1, 4], [2, 1], [3, NaN], [4, 3], [5, 2]];
  const a = await prepareAblationFold(train, [[6, 3]], ['a', 'b']);
  const b = await prepareAblationFold(train, [[1e9, -1e9]], ['a', 'b']);
  expect(a.means).toEqual(b.means);
  expect(a.sds).toEqual(b.sds);
  expect(a.medians).toEqual(b.medians);
  expect(a.featureNames).toEqual(b.featureNames);
  expect(a.Xtrain).toEqual(b.Xtrain);
  expect(a.Xtest).not.toEqual(b.Xtest);
});

test('holdout and CV each retain training-only preprocessing metadata', async () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ media_id: `${i}`, mean_score: i % 5, n_ratings: 1, a: i, b: (i * 7) % 13 }));
  for (const folds of [1, 3]) {
    const result = await runPerceptionAblation({ rows, folds, models: ['ridge'] });
    expect(result.preprocessingScope).toBe('training fold only');
    expect(result.preprocessing).toHaveLength(folds);
    expect(result.results[0].failed).toBe(false);
  }
  expect(buildManifest({ responses: [] }).analysis_algorithm_version).toBe('2026-09-10.1');
});


test('extreme holdout fractions never fall back to testing on the training data', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ media_id: `${i}`, mean_score: i % 5, n_ratings: 1, a: i, b: (i * 7) % 13 }));
  const result = await runPerceptionAblation({ rows, testFraction: 0.99, models: ['ridge'] });
  expect(result.nTrain + result.nTest).toBe(12);
  expect(result.nTest).toBe(6);
  expect(result.nTrain).toBe(6);
});
