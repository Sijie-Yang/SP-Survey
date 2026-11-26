import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';
import { flattenQuestions } from './quality';
import {
  CONTRAST_HEADERS, defaultBaseline, groupVariants, holm, pairedStats, questionVariantAnalysis,
  surveyVariantAnalysis, variantExportFiles,
} from './variantAnalysis';

const BASE = 'https://media.example.org/study';
const rating = (name, urls) => ({ name, title: name, type: 'imagerating', trialCount: 6, rateMin: 1, rateMax: 7, selectedImageUrls: urls });

/** Each participant rates every image once; `score(url)` is the true rating. */
function ratingRows(urls, score, n = 20) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    participant_id: `p${i}`,
    created_at: '2026-10-01T00:00:00Z',
    responses: { q: { trials: urls.map((u, t) => ({ trial_index: t, value: score(u, i), shown_images: [u] })) } },
    survey_metadata: {},
  }));
}

describe('grouping', () => {
  const u = (path) => ({ key: `${BASE}/${path}`, label: path.split('/').pop(), value: 1 });
  test('file suffix: scene12__trees.jpg', () => {
    const g = groupVariants(['s1__base.jpg', 's1__trees.jpg', 's2__base.jpg', 's2__trees.jpg', 's2__benches.jpg'].map(u));
    expect(g.grouping).toBe('file_suffix');
    expect(g.variants).toEqual(['base', 'benches', 'trees']);
    expect(g.scenes.get('s2').size).toBe(3);
  });
  test('folders as versions: before/scene.jpg', () => {
    const g = groupVariants(['before/a.jpg', 'after/a.jpg', 'before/b.jpg', 'after/b.jpg', 'before/c.jpg', 'after/c.jpg'].map(u));
    expect(g.grouping).toBe('folder_is_variant');
    expect(g.variants).toEqual(['after', 'before']);
    expect(defaultBaseline(g.variants, g.sceneCounts)).toBe('before');
  });
  test('folders as scenes: car-1/before.jpg (Lopes template layout)', () => {
    const g = groupVariants(['car-1/before.jpg', 'car-1/after.jpg', 'bus-1/before.jpg', 'bus-1/after.jpg', 'active-1/before.jpg', 'active-1/after.jpg'].map(u));
    expect(g.grouping).toBe('file_is_variant');
    expect([...g.scenes.keys()].sort()).toEqual(['active-1', 'bus-1', 'car-1']);
  });
  test('ordinary image sets are not mistaken for versions', () => {
    const urls = syntheticSurveyConfig({ images: 24 }).pages[1].elements[0].selectedImageUrls;
    expect(groupVariants(urls.map((key) => ({ key, label: key, value: 1 })))).toBeNull();
    expect(groupVariants(['s1__a.jpg', 's1__b.jpg', 's2__a.jpg'].map(u))).toBeNull();
  });
});

describe('statistics', () => {
  test('paired t, CI and d_z match a hand calculation', () => {
    const st = pairedStats([1, 2, 3, 4, 5]);
    expect(st.mean).toBe(3);
    expect(st.sd).toBeCloseTo(1.5811, 4);
    expect(st.t).toBeCloseTo(4.2426, 4);
    expect(st.p).toBeCloseTo(0.01324, 4);
    expect(st.ci_low).toBeCloseTo(1.0368, 3);
    expect(st.ci_high).toBeCloseTo(4.9632, 3);
    expect(st.dz).toBeCloseTo(1.8974, 4);
    expect(st.n_higher).toBe(5);
    expect(pairedStats([2]).ci_low).toBeNull();
  });
  test('Holm adjustment is monotone and keeps nulls', () => {
    expect(holm([0.01, 0.04, null, 0.03])).toEqual([0.03, 0.06, null, 0.06]);
  });
});

describe('analysis', () => {
  const scenes = ['s01', 's02', 's03', 's04', 's05', 's06'];
  const urls = scenes.flatMap((s) => ['base', 'trees', 'cars'].map((v) => `${BASE}/${s}__${v}.jpg`));
  const truth = (url, i) => {
    const s = Number(url.match(/s(\d+)__/)[1]);
    const lift = url.includes('__trees') ? 2 : 0;
    return Math.min(7, 2 + (s % 3) + lift + (i % 2));
  };
  const rows = ratingRows(urls, truth);
  const q = rating('q', urls);

  test('a real effect is found, a null version is not', () => {
    const [block] = questionVariantAnalysis(q, rows);
    expect(block.metric).toBe('mean');
    expect(block.baseline).toBe('base');
    const trees = block.contrasts.find((c) => c.variant === 'trees');
    const cars = block.contrasts.find((c) => c.variant === 'cars');
    expect(trees.n_scenes).toBe(6);
    expect(trees.mean_diff).toBeCloseTo(2);
    expect(trees.n_higher).toBe(6);
    expect(cars.mean_diff).toBeCloseTo(0);
    expect(cars.p).toBe(1);
    expect(block.pairs.filter((p) => p.variant === 'trees')).toHaveLength(6);
  });

  test('the baseline can be chosen', () => {
    const [block] = questionVariantAnalysis(q, rows, { baselines: { '': 'trees' } });
    expect(block.baseline).toBe('trees');
    expect(block.contrasts.find((c) => c.variant === 'base').mean_diff).toBeCloseTo(-2);
  });

  test('survey level skips questions without versions and exports stable CSVs', () => {
    const config = syntheticSurveyConfig({ images: 8 });
    expect(surveyVariantAnalysis(flattenQuestions(config), syntheticResponses(30, { config }))).toEqual([]);
    const analysis = surveyVariantAnalysis([q], rows);
    const files = variantExportFiles(analysis);
    expect(files.map((f) => f.path)).toEqual(['variant_contrasts.csv', 'variant_pairs.csv']);
    expect(files[0].content.split('\n')[0]).toBe(CONTRAST_HEADERS.join(','));
    expect(variantExportFiles([])).toEqual([]);
  });
});
