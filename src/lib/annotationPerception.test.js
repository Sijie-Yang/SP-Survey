import {
  resolveMediaIdFromKey, aggregatePerceptionByMedia, listPerceptionScoreQuestions,
  perceptionFeatureValue, materializePerceptionRows, imagePerceptionCsv, adjustFdr,
  correlateFeaturesWithPerception, perceptionAnalysisSnapshot, pearsonPValue,
} from './imagePerceptionJoin';
const pool = [
  { media_id: 'a/id', name: 'same.jpg', url: 'https://r2.test/a/same.jpg' },
  { media_id: 'b/id', name: 'same.jpg', url: 'https://r2.test/b/same.jpg' },
];
const response = (answer, ids) => ({ id: 'r1', responses: { q: { answer, shown_media_ids: ids, shown_images: ids.map((id) => pool.find((m) => m.media_id === id)?.url) } } });

test('same-name images are resolved only by source identity', () => {
  expect(resolveMediaIdFromKey('same.jpg', pool)).toBeNull();
  expect(resolveMediaIdFromKey(pool[1].url, pool)).toBe('b/id');
  expect(resolveMediaIdFromKey('a/id', pool)).toBe('a/id');
});

test('annotations prefer recorded shown IDs and ranking preserves full URLs', () => {
  const annotation = response({ image: 'same.jpg', shapes: [{ tool: 'point', label: 'tree', points: [{ x: 0, y: 0 }] }] }, ['b/id']);
  expect(aggregatePerceptionByMedia([annotation], { name: 'q', type: 'imageannotation' }, pool)[0].mediaId).toBe('b/id');
  const ranking = response(['image_0', 'image_1'], ['a/id', 'b/id']);
  const scores = aggregatePerceptionByMedia([ranking], { name: 'q', type: 'imageranking' }, pool);
  expect(scores.map((r) => r.mediaId).sort()).toEqual(['a/id', 'b/id']);
});

test('group ratings are not replicated as independent per-image scores; media ratings are discoverable', () => {
  const question = { name: 'q', type: 'mediarating' };
  expect(listPerceptionScoreQuestions([question])).toHaveLength(1);
  expect(aggregatePerceptionByMedia([response(4, ['a/id', 'b/id'])], question, pool)).toEqual([]);
  expect(aggregatePerceptionByMedia([response(0, ['b/id'])], question, pool)[0].meanScore).toBe(0);
});

test('SAM zeros require known labels and v2; CSV and model inputs share the same values', () => {
  const row = { media_id: 'a', mean_score: 4, n_ratings: 1, sam_status: 'ready', sam_feature_version: '2', sam_label_dictionary: { tree: 'tree' }, seg_status: 'ready' };
  expect(perceptionFeatureValue(row, 'sam_count_tree')).toBe(0);
  expect(perceptionFeatureValue(row, 'sam_count_building')).toBeNull();
  expect(perceptionFeatureValue({ ...row, sam_feature_version: 'legacy' }, 'sam_count_tree')).toBeNull();
  const rows = [row, { ...row, media_id: 'b', sam_count_tree: 2, seg_ratio_sky: 0.2 }];
  expect(materializePerceptionRows(rows, 'sam')[0].sam_count_tree).toBe(0);
  expect(materializePerceptionRows(rows, 'sam')[1].seg_ratio_sky).toBeUndefined();
  expect(imagePerceptionCsv(rows, 'sam')).not.toContain('seg_ratio_sky');
});

test('FDR matches reference values and Spearman handles monotonic nonlinear relationships', () => {
  const adjusted = adjustFdr([0.001, 0.04, 0.03, 0.2]);
  expect(adjusted[0]).toBeCloseTo(0.004);
  expect(adjusted[1]).toBeCloseTo(0.05333333);
  expect(adjusted[2]).toBeCloseTo(0.05333333);
  const rows = [1, 2, 3, 4, 5].map((x) => ({ media_id: String(x), n_ratings: 1, mean_score: x * x, brightness: x }));
  const result = correlateFeaturesWithPerception(rows, 'all', 'spearman')[0];
  expect(result.r).toBeCloseTo(1);
  expect(result.p_adjusted).toBeDefined();
  const snapshot = perceptionAnalysisSnapshot({ rows, modelFilter: 'all', method: 'spearman', reviewFilter: 'all', responses: [{ id: 'r1', survey_metadata: { survey_revision: 'v1' } }], question: { name: 'q' }, projectId: 'p' });
  expect(snapshot.response_ids).toEqual(['r1']);
  expect(snapshot.questionnaire_revisions).toEqual(['v1']);
  expect(snapshot.rows).toHaveLength(5);
});

test('analysis snapshots exclude integration keys and HTML from question configuration', () => {
  const snapshot = perceptionAnalysisSnapshot({ rows: [], modelFilter: 'all', method: 'pearson', reviewFilter: 'all', responses: [], question: { name: 'q', type: 'imagerating', rateMax: 7, falApiKey: 'not-for-export', skillHtml: '<script>private</script>' }, projectId: 'p' });
  expect(snapshot.question.rateMax).toBe(7);
  expect(snapshot.question.falApiKey).toBeUndefined();
  expect(snapshot.question.skillHtml).toBeUndefined();
});


test('Pearson p-values match closed forms and published SciPy references', () => {
  // n=4 gives a uniform null distribution of r, hence two-sided p=1-|r|.
  for (const r of [0, 0.1, 0.4, 0.626, 0.973, 0.999]) {
    expect(pearsonPValue(r, 4)).toBeCloseTo(1 - r, 12);
    expect(pearsonPValue(-r, 4)).toBeCloseTo(1 - r, 12);
    expect(pearsonPValue(r, 3)).toBeCloseTo(2 * Math.acos(r) / Math.PI, 12);
  }
  // https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html
  expect(pearsonPValue(-0.828503883588428, 7)).toBeCloseTo(0.021280260007523286, 12);
  expect(pearsonPValue(-0.05444919272687482, 500)).toBeCloseTo(0.22422294836207743, 10);
  expect(pearsonPValue(0, 10000)).toBe(1);
  expect(pearsonPValue(0.9, 2)).toBeNull();
});

test('centered Pearson calculation is stable for large-offset features', () => {
  const rows = [1, 2, 3, 4, 5].map((x) => ({ media_id: String(x), n_ratings: 1, mean_score: x, brightness: 1e12 + x }));
  expect(correlateFeaturesWithPerception(rows)[0].r).toBeCloseTo(1, 12);
});
