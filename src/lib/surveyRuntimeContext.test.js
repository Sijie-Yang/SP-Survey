import { Model } from 'survey-core';
import {
  choiceRuleToVisibleIf, pageRuleToVisibleIf, parseChoiceVisibleIf, parsePageRule,
  conditionFromUrl, withConditionWording,
  reverseCodedConditions,
  applyRuntimeVariables, captureUrlParams, chooseCondition, normalizeConditions, resolveRuntimeContext, runtimeMetadata,
} from './surveyRuntimeContext';
import { buildResponsesWideCsv } from './responsesWideExport';
import { normalizeBuilderQuestion } from './surveyStorage';

beforeEach(() => localStorage.clear());

test('projects without the new settings get no variables and no metadata', async () => {
  const ctx = await resolveRuntimeContext({}, { projectId: 'p', search: '?site=a' });
  expect(ctx).toEqual({ condition: null, urlParams: null });
  expect(runtimeMetadata(ctx)).toEqual({});
});

test('assignment is random every session and leans toward smaller groups', () => {
  const conds = normalizeConditions({ conditions: [{ id: 'a' }, { id: 'b', weight: 2 }, 'c'] });
  expect(conds.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  expect(chooseCondition(conds, null, () => 0.3)).toBe('b');
  const two = normalizeConditions({ conditions: ['more', 'less'] });
  expect(chooseCondition(two, { more: 5, less: 1 }, () => 0.1)).toBe('more');
  expect(chooseCondition(two, { more: 5, less: 1 }, () => 0.5)).toBe('less');
  const seen = new Set();
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 50; i += 1) seen.add(chooseCondition(two, { more: 0, less: 0 }, rand));
  expect([...seen].sort()).toEqual(['less', 'more']);
});

test('assignment persists per project and override wins', async () => {
  const config = { conditions: [{ id: 'more_safe' }, { id: 'less_safe' }] };
  const first = await resolveRuntimeContext(config, { projectId: 'p1', persist: true, fetchCounts: async () => ({ more_safe: 5, less_safe: 1 }), rand: () => 0.5 });
  expect(first.condition).toBe('less_safe');
  const again = await resolveRuntimeContext(config, { projectId: 'p1', persist: true, fetchCounts: async () => ({ more_safe: 0, less_safe: 9 }) });
  expect(again.condition).toBe('less_safe');
  const practice = await resolveRuntimeContext(config, { override: 'more_safe' });
  expect(practice.condition).toBe('more_safe');
  const failing = await resolveRuntimeContext(config, { fetchCounts: async () => { throw new Error('rpc missing'); }, rand: () => 0.9 });
  expect(failing.condition).toBe('less_safe');
});

test('only allow-listed URL parameters are captured, trimmed to 64 characters', () => {
  const long = 'x'.repeat(80);
  const out = captureUrlParams({ captureUrlParams: ['site', 'pid', 'bad name'] }, `?site=${long}&pid=7&token=secret&bad%20name=1`);
  expect(out).toEqual({ site: 'x'.repeat(64), pid: '7' });
});

test('SurveyJS sees {sp_condition} and {url_<name>} in visibleIf', () => {
  const model = new Model({ pages: [{ elements: [
    { type: 'text', name: 'a', visibleIf: "{sp_condition} = 'less_safe'" },
    { type: 'text', name: 'b', visibleIf: "{url_site} = 'boston'" },
  ] }] });
  applyRuntimeVariables(model, { condition: 'less_safe', urlParams: { site: 'boston' } });
  expect(model.getQuestionByName('a').isVisible).toBe(true);
  expect(model.getQuestionByName('b').isVisible).toBe(true);
  applyRuntimeVariables(model, { condition: 'more_safe', urlParams: { site: 'nyc' } });
  expect(model.getQuestionByName('a').isVisible).toBe(false);
});

test('wide export adds condition and url_* columns only when present', () => {
  const qs = [{ name: 'q', type: 'text' }];
  const plain = buildResponsesWideCsv([{ participant_id: 'p', responses: { q: 'x' }, survey_metadata: {} }], qs, null);
  expect(plain).not.toMatch(/condition|url_/);
  const csv = buildResponsesWideCsv([{ participant_id: 'p', responses: { q: 'x' }, survey_metadata: { condition: 'a', url_params: { site: 's1' } } }], qs, null);
  expect(csv.split('\n')[0]).toMatch(/condition,url_site/);
  expect(csv).toMatch(/,a,s1,/);
});

test('rating rateLabels map to native rateValues with numeric stored values', () => {
  const q = normalizeBuilderQuestion({ type: 'rating', name: 'r', rateMin: 1, rateMax: 3, rateLabels: ['Low', 'Mid', 'High'] });
  expect(q.rateValues).toEqual([{ value: 1, text: 'Low' }, { value: 2, text: 'Mid' }, { value: 3, text: 'High' }]);
  expect(normalizeBuilderQuestion({ type: 'rating', name: 'r', rateLabels: ['a'] }).rateValues).toBeUndefined();
});

test('conditionVariants reword a question per condition', () => {
  const json = { pages: [{ elements: [{ type: 'text', name: 'q', title: 'Looks safe?', conditionVariants: [{ condition: 'less', title: 'Looks less safe?', reverseCoded: true }] }] }] };
  const m = new Model(json);
  applyRuntimeVariables(m, { condition: 'less', urlParams: {} });
  expect(m.getQuestionByName('q').title).toBe('Looks less safe?');
  const other = new Model(json);
  applyRuntimeVariables(other, { condition: 'more', urlParams: {} });
  expect(other.getQuestionByName('q').title).toBe('Looks safe?');
  expect(reverseCodedConditions(json.pages[0].elements[0])).toEqual(['less']);
  expect(new Model(json).toJSON().pages[0].elements[0].conditionVariants).toEqual(json.pages[0].elements[0].conditionVariants);
});

test('link override and per-condition question JSON', () => {
  expect(conditionFromUrl('?sp_condition=less_safe&pid=1')).toBe('less_safe');
  expect(conditionFromUrl('?pid=1')).toBeNull();
  const q = { name: 'q', title: 'A', conditionVariants: [{ condition: 'b', title: 'B' }] };
  expect(withConditionWording(q, 'b').title).toBe('B');
  expect(withConditionWording(q, 'a')).toBe(q);
});

test('page display rules map to simple choices', () => {
  expect(parsePageRule('')).toEqual({ kind: 'always' });
  expect(parsePageRule('{url_site} notempty')).toEqual({ kind: 'with_param', param: 'site' });
  expect(parsePageRule('{url_site} empty')).toEqual({ kind: 'without_param', param: 'site' });
  expect(parsePageRule('{age} > 18')).toBeNull();
  expect(pageRuleToVisibleIf({ kind: 'with_param', param: 'site' })).toBe('{url_site} notempty');
  expect(pageRuleToVisibleIf({ kind: 'always' })).toBeUndefined();
});

test('question display rules follow one choice', () => {
  expect(parseChoiceVisibleIf('')).toEqual({ kind: 'always' });
  expect(parseChoiceVisibleIf("{resident_or_visitor} = 'resident'")).toEqual({
    kind: 'answer', question: 'resident_or_visitor', value: 'resident',
  });
  expect(parseChoiceVisibleIf('{city} = "knoxville"')).toEqual({
    kind: 'answer', question: 'city', value: 'knoxville',
  });
  expect(parseChoiceVisibleIf("{age} > 18")).toBeNull();
  expect(choiceRuleToVisibleIf({ kind: 'answer', question: 'city', value: 'knoxville' })).toBe("{city} = 'knoxville'");
  expect(choiceRuleToVisibleIf({ kind: 'always' })).toBeUndefined();
});
