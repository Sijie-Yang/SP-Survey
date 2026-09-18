import { buildQuestionLongTable, buildQuestionSummaryRows, buildManifest } from './questionSummaryExport';
import { buildResponsesWideCsv } from './responsesWideExport';
import { adaptSkillFieldValue, skillFieldNativeQuestion } from './skillNativeAdapter.mjs';
import { buildIrrMatrix, computeQuestionIrr } from './reliability';
import { resolveMediaAnswerKey, stimulusUnitKey } from './mediaIdentity';
import { enrichSurveyResponses } from './enrichSurveyResponses';

const a = 'https://media.test/day/001.jpg';
const b = 'https://media.test/night/001.jpg';
const row = (payload, id = 'p1') => ({ id, participant_id: id, responses: { q: payload } });

test.each(['imageranking', 'mediaranking'])('%s summary includes every trial, matching the long table', (type) => {
  const q = { name: 'q', type, trialCount: 2 };
  const rows = [row({ trials: [
    { answer: ['image_0', 'image_1'], shown_images: [a, b] },
    { answer: ['image_1', 'image_0'], shown_images: [a, b] },
  ] })];
  expect(buildQuestionLongTable(q, rows).rows).toHaveLength(2);
  const means = buildQuestionSummaryRows(q, rows).filter(r => r.metric === 'avg_rank');
  expect(means).toHaveLength(2);
  expect(means.map(r => r.value)).toEqual([1.5, 1.5]);
  expect(means.map(r => r.n)).toEqual([2, 2]);
});

test.each([
  ['imagematrix', { rows: ['comfort'], columns: ['1', '5'] }, { comfort: '5' }],
  ['imageslidergroup', { dimensions: [{ id: 'comfort' }] }, { comfort: 5 }],
  ['imagepointallocation', { choices: ['comfort'], budget: 100 }, { comfort: 100 }],
  ['imagerating', {}, 5],
  ['imageboolean', {}, true],
  ['imagecheckbox', {choices: ['safe']}, ['safe']],
])('%s shared answer is assigned to the full group exactly once', (type, config, answer) => {
  const summary = buildQuestionSummaryRows({ name: 'q', type, ...config }, [row({ answer, shown_images: [a, b] })]);
  const units = summary.filter(r => r.unit_key !== 'overall');
  expect(units.some(r => r.unit_key === stimulusUnitKey([a, b]))).toBe(true);
  expect(units.some(r => r.unit_key === a || r.unit_key === b)).toBe(false);
});

test('per-trial context overrides legacy metadata; fallback remains explicit', () => {
  const q = {name: 'q', type: 'imagerating'};
  const rows = [row({shown_media_set: 'legacy', shown_media_categories: ['old'], trials: [
    {answer: 4, shown_images: [a], shown_media_set: 'day', shown_media_categories: ['urban']},
    {answer: 5, shown_images: [b]},
  ]})];
  const long = buildQuestionLongTable(q, rows).rows;
  expect(long[0]).toMatchObject({shown_media_set: 'day', shown_media_categories: 'urban', media_metadata_scope: 'trial'});
  expect(long[1]).toMatchObject({shown_media_set: 'legacy', shown_media_categories: 'old', media_metadata_scope: 'question_fallback'});
});

test('explicit empty trial context does not inherit another trial’s media set', () => {
  const long = buildQuestionLongTable({name: 'q', type: 'imagerating'}, [row({shown_media_set: 'old', trials: [
    {answer: 4, shown_images: [a], shown_media_set: null, shown_media_categories: [], trial_index: 4},
  ]})]);
  expect(long.rows[0]).toMatchObject({shown_media_set: '', shown_media_categories: '', trial_index: 4, media_metadata_scope: 'trial'});
});

test('trial enrichment retains original per-trial metadata and values', () => {
  const {enrichedResponses} = enrichSurveyResponses({responses: {q: {trials: [{answer: false, shown_images: [a], shown_media_set: 'day', shown_media_categories: ['urban']}]}}});
  expect(enrichedResponses.q.trials[0]).toMatchObject({answer: false, shown_media_set: 'day', shown_media_categories: ['urban']});
});

test('text tags and text ranking preserve slash and question-mark characters', () => {
  const q = {name: 'q', type: 'imagecheckbox', choices: ['safe/quiet?', 'safe']};
  const rows = [row({answer: ['safe/quiet?'], shown_images: [a]})];
  expect(buildResponsesWideCsv(rows, [q])).toContain('safe/quiet?');
  expect(buildQuestionLongTable(q, rows).rows[0].value).toBe('safe/quiet?');
  expect(buildQuestionSummaryRows(q, rows).find(r => r.attribute_key === 'safe/quiet?')).toBeTruthy();
  expect(buildResponsesWideCsv([row(['safe/quiet?'])], [{...q, type: 'ranking'}])).toContain('safe/quiet?');
});

test('spatial adapter preserves labels and path timing', () => {
  const point = adaptSkillFieldValue({name: 'q'}, {key: 'v', type: 'points'}, {v: [{x: .1, y: .2, label: 'tree'}]});
  expect(point.answer.shapes[0].label).toBe('tree');
  const path = adaptSkillFieldValue({name: 'q'}, {key: 'v', type: 'path'}, {v: [{x: .1, y: .2, t: 123}]});
  expect(path.answer.shapes[0].points[0].t).toBe(123);
});

test('timeRanges labels appear in long export', () => {
  const q = {name: 'q', type: 'skillquestion', skillResultSchema: [{key: 'v', type: 'timeRanges'}]};
  const long = buildQuestionLongTable(q, [row({answer: {v: [{start: 1, end: 2, label: 'traffic'}], videoUrl: a}})]);
  expect(long.rows[0]).toMatchObject({start: 1, end: 2, label: 'traffic'});
});

test('numeric media skills do not acquire an invented rating range', () => {
  expect(skillFieldNativeQuestion({name: 'q', imageCount: 1}, {key: 'v', type: 'number'}))
    .toMatchObject({numericMeasure: true, rateMin: undefined, rateMax: undefined});
});

test('same filename from different sources stays separate; ambiguous legacy names are not guessed', () => {
  const summary = buildQuestionSummaryRows({name: 'q', type: 'imagerating'}, [row({answer: 1, shown_images: [a]}), row({answer: 5, shown_images: [b]}, 'p2')]);
  expect(summary.filter(r => r.metric === 'mean').map(r => [r.unit_key, r.value])).toEqual([[a, 1], [b, 5]]);
  expect(resolveMediaAnswerKey('001.jpg', [a, b])).toBe('');
  expect(resolveMediaAnswerKey('001.jpg', [a])).toBe(a);
});

test('media identity retains resource query parameters but ignores expiring signatures', () => {
  expect(resolveMediaAnswerKey('https://media.test/image?id=1&X-Amz-Signature=secret')).toBe('https://media.test/image?id=1');
  expect(resolveMediaAnswerKey('https://media.test/image?id=2')).not.toBe(resolveMediaAnswerKey('https://media.test/image?id=1'));
});

test('reliability averages repeat observations and calculates slider dimensions', () => {
  const rows = [row({trials: [{answer: 1, shown_images: [a]}, {answer: 5, shown_images: [a]}]})];
  expect(buildIrrMatrix(rows, 'q', {interval: true}).unitMap.get(a)).toEqual({p1: 3});
  const sliders = ['p1', 'p2'].map(id => row({trials: [
    {answer: {comfort: 1}, shown_images: [a]}, {answer: {comfort: 5}, shown_images: [b]},
  ]}, id));
  expect(computeQuestionIrr(sliders, {name: 'q', type: 'imageslidergroup', dimensions: [{id: 'comfort'}]}).dimensions[0].alpha).toBe(1);
});

test('different submissions from the same participant count separately in exported n_responses', () => {
  const q = {name: 'q', type: 'rating'};
  const rows = [row(1), {...row(5), id: 'submission-2'}];
  expect(buildQuestionSummaryRows(q, rows).find(r => r.metric === 'mean')).toMatchObject({n_responses: 2, value: 3});
});

test('repeated choices use stimulus exposures as percentage denominator, never participant count', () => {
  const summary = buildQuestionSummaryRows({name: 'q', type: 'imagepicker'}, [row({trials: [
    {answer: a, shown_images: [a, b]}, {answer: a, shown_images: [a, b]},
  ]})]);
  expect(summary.find(r => r.metric === 'pct' && r.unit_key === a)).toMatchObject({value: 1, n: 2, n_responses: 1});
  expect(summary.find(r => r.metric === 'pct' && r.unit_key === b)).toMatchObject({value: 0, n: 2});
});

test('manifest includes the original response revision and contract', () => {
  const contract = {questions: [{name: 'q', type: 'rating'}]};
  const response = {...row(1), survey_metadata: {survey_revision: 'rev1', survey_response_contract: contract}};
  expect(buildManifest({responses: [response]})).toMatchObject({survey_revisions: ['rev1'], response_contracts: {rev1: contract}});
});
