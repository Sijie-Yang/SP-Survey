import { buildAblationMatrix, groupedFoldIndices, runPerceptionAblation } from './perceptionAblation';

test('imputation never invents entire feature rows, while measured zero stays usable', () => {
  const rows = [
    { media_id: 'zero', mean_score: 0, n_ratings: 1, light: 0, contrast: 1 },
    { media_id: 'partial', mean_score: 2, n_ratings: 1, light: 1 },
    { media_id: 'missing', mean_score: 3, n_ratings: 1 },
    { media_id: 'invalid', mean_score: Infinity, n_ratings: 1, light: 4 },
  ];
  for (const options of [{ impute: true }, { deferImpute: true }]) {
    const built = buildAblationMatrix(rows, 'all', options);
    expect(built.mediaIds).toEqual(['zero', 'partial']);
    expect(built.droppedIncomplete).toBe(1);
  }
  expect(buildAblationMatrix(rows, 'all', { impute: false }).mediaIds).toEqual(['zero']);
});
test('folder groups never cross validation folds', () => {
  const groups = ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd'];
  const folds = groupedFoldIndices(groups, 2, () => 0.4);
  expect(folds.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  const first = new Set(folds[0].map((i) => groups[i]));
  expect(folds[1].some((i) => first.has(groups[i]))).toBe(false);
  expect(() => groupedFoldIndices(['a', 'a'], 2, Math.random)).toThrow('distinct folders');
});

test('model run exports exact disjoint image splits and seed', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ media_id: `id${i}`, media_folder: `scene${Math.floor(i / 5)}`, mean_score: i / 20, n_ratings: 3, light: i % 3, greenery: (i * 7) % 11 }));
  const result = await runPerceptionAblation({ rows, models: ['ridge'], groupByFolder: true, seed: 13 });
  expect(result.seed).toBe(13);
  const split = result.splits[0];
  expect(split.train_media_ids.some((id) => split.test_media_ids.includes(id))).toBe(false);
  expect(split.train_media_ids.length + split.test_media_ids.length).toBe(20);
  const lookup = new Map(rows.map((r) => [r.media_id, r.media_folder]));
  const trainGroups = new Set(split.train_media_ids.map((id) => lookup.get(id)));
  expect(split.test_media_ids.some((id) => trainGroups.has(lookup.get(id)))).toBe(false);
});
