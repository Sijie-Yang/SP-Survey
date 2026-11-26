import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';
import { flattenQuestions } from './quality';
import {
  AGREEMENT_HEADERS, CALIBRATION_HEADERS, agreementCsv, calibrationCsv, linearCalibration, agreementExportFiles, averageRanks, jsDivergence, kendallTauB,
  pearson, questionAgreement, siliconAgreement, siliconGroups, spearman,
} from './siliconAgreement';

const config = syntheticSurveyConfig({ images: 8 });
const questions = flattenQuestions(config);
const human = syntheticResponses(60, { config, seed: 7 });
const asSilicon = (rows, persona = 'p1') => rows.map((r) => ({
  ...r,
  source: 'silicon',
  persona_id: persona,
  survey_metadata: { ...(r.survey_metadata || {}), silicon_run_id: 'run-1', persona_name: persona.toUpperCase() },
}));
const q = (name) => questions.find((x) => x.name === name);
const metric = (rows, m) => rows.find((r) => r.metric === m)?.value;

describe('statistics', () => {
  test('pearson, spearman and kendall match textbook values', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1);
    expect(kendallTauB([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1);
    expect(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    // One swapped pair of 4: (5 - 1) / 6.
    expect(kendallTauB([1, 2, 3, 4], [1, 3, 2, 4])).toBeCloseTo(4 / 6);
  });

  test('Jensen–Shannon divergence is 0 for identical and 1 for disjoint answers', () => {
    expect(jsDivergence({ a: 2, b: 2 }, { a: 5, b: 5 })).toBeCloseTo(0);
    expect(jsDivergence({ a: 1 }, { b: 1 })).toBeCloseTo(1);
    expect(jsDivergence({}, { a: 1 })).toBeNull();
  });
});

describe('agreement', () => {
  test('identical answers agree perfectly on every comparison', () => {
    const { rows } = siliconAgreement(questions, human, asSilicon(human), { siliconRunId: 'run-1' });
    const pairwise = rows.filter((r) => r.question_name === 'safe');
    expect(metric(pairwise, 'kendall_tau_b')).toBeCloseTo(1);
    expect(pairwise[0].n_units).toBe(8);
    const means = rows.filter((r) => r.question_name === 'comfort');
    expect(metric(means, 'pearson_r')).toBeCloseTo(1);
    expect(metric(means, 'mean_abs_diff')).toBeCloseTo(0);
    const choice = rows.filter((r) => r.question_name === 'gender');
    expect(metric(choice, 'js_divergence')).toBeCloseTo(0);
    expect(metric(choice, 'top_choice_match')).toBe(1);
    const scale = rows.filter((r) => r.question_name === 'personality_1');
    expect(metric(scale, 'mean_diff')).toBeCloseTo(0);
    expect(rows.every((r) => r.silicon_run_id === 'run-1' && r.silicon_group === 'all')).toBe(true);
    // Free text is never compared.
    expect(rows.some((r) => r.question_name === 'comment')).toBe(false);
  });

  test('unrelated answers agree less, and the biggest gaps are listed', () => {
    const other = asSilicon(syntheticResponses(60, { config, seed: 99 }));
    const { rows, gaps } = siliconAgreement(questions, human, other);
    const tau = metric(rows.filter((r) => r.question_name === 'safe'), 'kendall_tau_b');
    expect(tau).toBeLessThan(1);
    expect(gaps).toHaveLength(5);
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i - 1].rank_gap).toBeGreaterThanOrEqual(gaps[i].rank_gap);
    expect(gaps[0].unit_label).toMatch(/img_\d{4}\.jpg/);
  });

  test('sliders compare per dimension; images on other hosts match by file name', () => {
    const moved = asSilicon(human).map((r) => JSON.parse(JSON.stringify(r).replace(/https:\/\/media\.example\.org/g, 'https://preview.example.net')));
    const { rows } = questionAgreement(q('feel'), human, moved);
    const dims = [...new Set(rows.map((r) => r.attribute_key))];
    expect(dims).toEqual(['calm', 'open']);
    expect(metric(rows, 'spearman_rho')).toBeCloseTo(1);
  });

  test('too few shared items gives an empty value, not a fake correlation', () => {
    const small = syntheticSurveyConfig({ images: 2 });
    const few = syntheticResponses(20, { config: small });
    const comfort = flattenQuestions(small).find((x) => x.name === 'comfort');
    const { rows } = questionAgreement(comfort, few, asSilicon(few));
    const corr = rows.filter((x) => x.metric === 'pearson_r');
    expect(corr).toHaveLength(1);
    expect(corr[0].n_units).toBeLessThan(3);
    expect(corr[0].value).toBeNull();
    expect(metric(rows, 'mean_abs_diff')).toBeCloseTo(0);
  });

  test('persona groups and CSV export use stable column names', () => {
    const silicon = [...asSilicon(human.slice(0, 30), 'p1'), ...asSilicon(human.slice(30), 'p2')];
    const groups = siliconGroups(silicon);
    expect(groups.map((g) => g.id)).toEqual(['all', 'persona:p1', 'persona:p2']);
    expect(groups[1].label).toBe('P1');
    const result = siliconAgreement(questions, human, groups[1].rows, { siliconGroup: groups[1].id });
    const csv = agreementCsv(result.rows);
    expect(csv.split('\n')[0]).toBe(AGREEMENT_HEADERS.join(','));
    expect(csv).toMatch(/persona:p1/);
    const files = agreementExportFiles(result);
    expect(files.map((f) => f.path)).toEqual(['silicon_agreement.csv', 'silicon_agreement_gaps.csv', 'silicon_calibration.csv']);
    expect(calibrationCsv(result.calibration).split('\n')[0]).toBe(CALIBRATION_HEADERS.join(','));
    expect(agreementExportFiles({ rows: [] })).toEqual([]);
  });
});

describe('calibration', () => {
  test('recovers a known linear map and reports leave-one-out error', () => {
    const human = [1, 2, 3, 4, 5];
    const silicon = human.map((h) => 2 * h + 1);
    const cal = linearCalibration(silicon, human);
    expect(cal.slope).toBeCloseTo(0.5);
    expect(cal.intercept).toBeCloseTo(-0.5);
    expect(cal.r2).toBeCloseTo(1);
    expect(cal.loo_rmse).toBeCloseTo(0);
    expect(cal.predicted).toEqual(human.map((h) => expect.closeTo(h)));
    // Noise: LOO error is larger than in-sample error.
    const noisy = linearCalibration([1, 2, 3, 4, 5, 6], [1.2, 1.8, 3.4, 3.7, 5.3, 5.9]);
    expect(noisy.r2).toBeGreaterThan(0.9);
    expect(noisy.loo_rmse).toBeGreaterThan(noisy.rmse);
  });

  test('no fit without enough items or without silicon spread', () => {
    expect(linearCalibration([1, 2], [1, 2])).toBeNull();
    expect(linearCalibration([3, 3, 3, 3], [1, 2, 3, 4])).toBeNull();
    expect(linearCalibration([1, 2, 3], [1, 2, 3]).loo_rmse).toBeNull();
  });

  test('identical answers calibrate to the identity, per item and in the summary', () => {
    const result = siliconAgreement(questions, human, asSilicon(human));
    const means = result.rows.filter((r) => r.question_name === 'comfort');
    expect(metric(means, 'calib_slope')).toBeCloseTo(1);
    expect(metric(means, 'calib_intercept')).toBeCloseTo(0);
    expect(metric(means, 'calib_r2')).toBeCloseTo(1);
    const items = result.calibration.filter((r) => r.question_name === 'comfort');
    expect(items.length).toBeGreaterThan(2);
    items.forEach((r) => expect(r.residual).toBeCloseTo(0));
    const line = result.summary.find((r) => r.question_name === 'comfort');
    expect(line.calibration.slope).toBeCloseTo(1);
  });
});
