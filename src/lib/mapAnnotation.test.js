import {
  resolveEvaluativeMapPair,
  resolveMapQuestionAnalysis,
  resolveStudyArea,
  applyMapTaskOrder,
  compareGeographicMaps,
  compositionTable,
  geographicEvaluativeMap,
  mapTaskOrderFromSeed,
  rectangleRing,
  ringSelfIntersects,
  rowMatchesDemographicFilters,
  validateMapAnswer,
  validateMapFeature,
} from './mapAnnotation';

const knoxville = {
  id: 'knoxville',
  revision: 1,
  cityId: 'knoxville',
  boundary: {
    type: 'Polygon',
    coordinates: [[[-84.05, 35.88], [-83.75, 35.88], [-83.75, 36.05], [-84.05, 36.05], [-84.05, 35.88]]],
  },
};

function area(id, ring) {
  return {
    schemaVersion: 1,
    studyAreaId: 'knoxville',
    studyAreaRevision: 1,
    cityId: 'knoxville',
    status: 'annotated',
    features: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { label: 'liked', tool: 'polygon', placeName: 'Downtown', boundaryDescription: 'Gay Street', note: 'signs' },
      }],
    },
  };
}

const block = rectangleRing([-83.95, 35.95], [-83.93, 35.97]);

test('a survey model keeps both preset cities on the map question', async () => {
  const { Model } = await import('survey-core');
  const { registerMapAnnotationWidget } = await import('../components/SurveyCustomComponents');
  registerMapAnnotationWidget();
  const template = require('../../public/project_templates/1990-nasar-evaluative.json');
  const model = new Model(template.config);
  const liked = model.getQuestionByName('liked_areas');
  expect(resolveStudyArea(liked, 'chattanooga').id).toBe('chattanooga-1990');
  expect(resolveStudyArea(liked, 'knoxville').id).toBe('knoxville-1990');
});

test('a line is measured by length and stays out of the area grid', () => {
  const line = {
    schemaVersion: 1,
    studyAreaId: 'knoxville',
    studyAreaRevision: 1,
    status: 'annotated',
    features: {
      type: 'FeatureCollection',
      features: [{
        id: 'road',
        geometry: { type: 'LineString', coordinates: [[-83.95, 35.96], [-83.94, 35.96]] },
        properties: { tool: 'line' },
      }],
    },
  };
  const none = { ...line, status: 'none', features: { type: 'FeatureCollection', features: [] } };
  expect(validateMapFeature(line.features.features[0], knoxville)).toEqual([]);
  const map = geographicEvaluativeMap([
    { id: 'p1', responses: { liked_areas: line, disliked_areas: none } },
  ], { likedQuestion: 'liked_areas', dislikedQuestion: 'disliked_areas', studyArea: knoxville });
  expect(map.ok).toBe(true);
  expect(map.cells).toEqual([]);
  expect(map.lines).toHaveLength(1);
  expect(map.lines[0].layer).toBe('liked');
  expect(map.lines[0].lengthMeters).toBeGreaterThan(800);
  expect(map.lines[0].lengthMeters).toBeLessThan(1000);
});

test('longitude stays first and a rectangle is stored as a closed polygon', () => {
  const ring = rectangleRing([-83.95, 35.95], [-83.90, 35.97]);
  expect(ring[0]).toEqual([-83.95, 35.95]);
  expect(ring[2]).toEqual([-83.90, 35.97]);
  expect(ring[0]).toEqual(ring[ring.length - 1]);
  const feature = {
    id: 'a',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { tool: 'rectangle' },
  };
  expect(validateMapFeature(feature, knoxville)).toEqual([]);
});

test('self-crossing polygons and image coordinates are rejected', () => {
  const bowtie = [[-83.95, 35.95], [-83.93, 35.97], [-83.93, 35.95], [-83.95, 35.97], [-83.95, 35.95]];
  expect(ringSelfIntersects(bowtie)).toBe(true);
  expect(validateMapAnswer({
    schemaVersion: 1,
    studyAreaId: 'knoxville',
    studyAreaRevision: 1,
    status: 'annotated',
    features: { type: 'FeatureCollection', features: [{ id: 'x', geometry: { type: 'Polygon', coordinates: [bowtie] } }] },
  }, { studyArea: knoxville }).ok).toBe(false);
  expect(validateMapAnswer({ shapes: [{ type: 'polygon', points: [{ x: 0.2, y: 0.4 }] }] }).errors.join(' '))
    .toMatch(/not geographic/);
});

test('disliked first places that page ahead of liked', () => {
  const survey = {
    spMapTaskOrder: { firstPage: 'page_liked', secondPage: 'page_disliked', order: 'disliked_first' },
    pages: [{ name: 'intro' }, { name: 'page_liked' }, { name: 'page_disliked' }, { name: 'demo' }],
  };
  expect(applyMapTaskOrder(survey, 'ignored').pages.map((page) => page.name))
    .toEqual(['intro', 'page_disliked', 'page_liked', 'demo']);
});

test('the same seed keeps liked and disliked order', () => {
  const seed = 'browser-7';
  expect(mapTaskOrderFromSeed(seed)).toBe(mapTaskOrderFromSeed(seed));
  const survey = {
    spMapTaskOrder: { firstPage: 'page_liked', secondPage: 'page_disliked' },
    pages: [{ name: 'intro' }, { name: 'page_liked' }, { name: 'page_disliked' }, { name: 'demo' }],
  };
  const order = mapTaskOrderFromSeed(seed);
  const next = applyMapTaskOrder(survey, seed);
  const names = next.pages.map((page) => page.name);
  if (order === 'liked_first') expect(names).toEqual(['intro', 'page_liked', 'page_disliked', 'demo']);
  else expect(names).toEqual(['intro', 'page_disliked', 'page_liked', 'demo']);
  expect(applyMapTaskOrder(survey, seed).spMapTaskOrder.order).toBe(order);
});

test('overlapping marks from one person count once, and none is not the same as missing', () => {
  const both = area('a', block);
  const second = area('b', rectangleRing([-83.94, 35.96], [-83.92, 35.98]));
  const overlapping = {
    ...both,
    features: { type: 'FeatureCollection', features: [both.features.features[0], second.features.features[0]] },
  };
  const rows = [
    { id: 'p1', responses: { liked_areas: overlapping, disliked_areas: { ...both, status: 'none', features: { type: 'FeatureCollection', features: [] } } } },
    { id: 'p2', responses: { liked_areas: { ...both, status: 'none', features: { type: 'FeatureCollection', features: [] } }, disliked_areas: both } },
    { id: 'p3', responses: { liked_areas: both } },
    { id: 'p4', responses: { liked_areas: { ...both, status: 'unfamiliar', features: { type: 'FeatureCollection', features: [] } }, disliked_areas: { ...both, status: 'unfamiliar', features: { type: 'FeatureCollection', features: [] } } } },
  ];
  const map = geographicEvaluativeMap(rows, {
    likedQuestion: 'liked_areas',
    dislikedQuestion: 'disliked_areas',
    studyArea: knoxville,
    cellMeters: 500,
  });
  expect(map.ok).toBe(true);
  expect(map.pairedN).toBe(2);
  expect(map.missing).toBe(1);
  expect(map.unfamiliar).toBe(1);
  const hottest = map.cells.reduce((best, cell) => (cell.likedCount > (best?.likedCount || 0) ? cell : best), null);
  expect(hottest.likedCount).toBe(1);
  expect(hottest.likedShare).toBeCloseTo(0.5);
});

test('different study-area revisions are not painted on this grid', () => {
  const old = area('a', block);
  old.studyAreaRevision = 2;
  const map = geographicEvaluativeMap([
    { id: 'p', responses: { liked_areas: old, disliked_areas: { ...area('d', block), status: 'none', features: { type: 'FeatureCollection', features: [] }, studyAreaRevision: 2 } } },
  ], { likedQuestion: 'liked_areas', dislikedQuestion: 'disliked_areas', studyArea: knoxville, cellMeters: 500 });
  expect(map.pairedN).toBe(1);
  expect(map.cells).toEqual([]);
});

test('demographic filters combine with AND and can select missing values', () => {
  const rows = [
    { id: 'a', responses: { resident_or_visitor: 'resident', age_band: '21_39' } },
    { id: 'b', responses: { resident_or_visitor: 'visitor', age_band: '21_39' } },
    { id: 'c', responses: { resident_or_visitor: 'resident' } },
  ];
  const filters = [
    { question: 'resident_or_visitor', op: 'in', values: ['resident'] },
    { question: 'age_band', op: 'in', values: ['21_39'] },
  ];
  expect(rows.filter((row) => rowMatchesDemographicFilters(row, filters)).map((row) => row.id)).toEqual(['a']);
  expect(rows.filter((row) => rowMatchesDemographicFilters(row, [{ question: 'age_band', op: 'missing' }])).map((row) => row.id)).toEqual(['c']);
});

test('group maps keep separate sample sizes', () => {
  const liked = area('a', block);
  const none = { ...liked, status: 'none', features: { type: 'FeatureCollection', features: [] } };
  const spec = { likedQuestion: 'liked_areas', dislikedQuestion: 'disliked_areas', studyArea: knoxville, cellMeters: 500 };
  const residents = geographicEvaluativeMap([
    { id: 'r', responses: { liked_areas: liked, disliked_areas: none } },
  ], spec);
  const visitors = geographicEvaluativeMap([
    { id: 'v1', responses: { liked_areas: none, disliked_areas: liked } },
    { id: 'v2', responses: { liked_areas: none, disliked_areas: none } },
  ], spec);
  const diff = compareGeographicMaps(residents, visitors);
  expect(diff.ok).toBe(true);
  expect(diff.leftN).toBe(1);
  expect(diff.rightN).toBe(2);
});

test('the same pair name joins one positive question with one negative question', () => {
  const questions = [
    { type: 'mapannotation', name: 'impress', mapLabel: 'Impressed', mapPolarity: 'positive', mapPair: 'impression' },
    { type: 'mapannotation', name: 'flat', mapLabel: 'Not impressed', mapPolarity: 'negative', mapPair: 'impression' },
    { type: 'mapannotation', name: 'safe', mapLabel: 'Safe', mapPolarity: 'positive', mapPair: 'safety' },
    { type: 'mapannotation', name: 'unsafe', mapLabel: 'Unsafe', mapPolarity: 'negative', mapPair: 'safety' },
  ];
  const impression = resolveMapQuestionAnalysis(questions[0], questions, {});
  expect(impression.mode).toBe('paired');
  expect(impression.pairId).toBe('impression');
  expect(impression.negative.name).toBe('flat');
  expect(impression.positiveName).toBe('Impressed');
  const safety = resolveMapQuestionAnalysis(questions[3], questions, {});
  expect(safety.positive.name).toBe('safe');
  expect(safety.negative.name).toBe('unsafe');
  expect(safety.negativeName).toBe('Unsafe');
});

test('legacy liked and disliked labels still pair when polarity is absent', () => {
  const pair = resolveEvaluativeMapPair([
    { type: 'mapannotation', name: 'liked_areas', mapLabel: 'liked' },
    { type: 'mapannotation', name: 'disliked_areas', mapLabel: 'disliked' },
  ], { likedQuestion: 'liked_areas', dislikedQuestion: 'disliked_areas' });
  expect(pair.positive.name).toBe('liked_areas');
  expect(pair.negative.name).toBe('disliked_areas');
  expect(pair.positiveName).toBe('Liked');
  expect(pair.negativeName).toBe('Disliked');
});

test('a map with no partner scores overlap strength', () => {
  const question = { type: 'mapannotation', name: 'noticed', mapLabel: 'Places I noticed', mapPolarity: 'single' };
  expect(resolveMapQuestionAnalysis(question, [question], {}).mode).toBe('intensity');
  const none = { ...area('n', block), status: 'none', features: { type: 'FeatureCollection', features: [] } };
  const map = geographicEvaluativeMap([
    { id: 'p1', responses: { noticed: area('a', block) } },
    { id: 'p2', responses: { noticed: area('b', block) } },
    { id: 'p3', responses: { noticed: none } },
    { id: 'p4', responses: {} },
  ], { likedQuestion: 'noticed', studyArea: knoxville, cellMeters: 500, mode: 'intensity' });
  const hottest = map.cells.reduce((best, cell) => (cell.likedCount > (best?.likedCount || 0) ? cell : best), null);
  expect(map.denominator).toBe(3);
  expect(map.missing).toBe(1);
  expect(hottest.likedCount).toBe(2);
  expect(hottest.likedShare).toBeCloseTo(2 / 3);
  expect(hottest.dislikedCount).toBe(0);
  expect(hottest.net).toBeCloseTo(2 / 3);
});

test('composition keeps a missing rate separate from a no-response choice', () => {
  const table = compositionTable([
    { responses: { income: 'under_10000' } },
    { responses: { income: 'no_response' } },
    { responses: {} },
  ], 'income', [
    { value: 'under_10000', text: 'Under $10,000' },
    { value: 'no_response', text: 'No response' },
  ]);
  expect(table.missing).toBe(1);
  expect(table.items.find((item) => item.value === 'no_response').count).toBe(1);
  expect(table.total).toBe(3);
});
