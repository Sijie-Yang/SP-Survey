import { recordedRevisionSelection, recordedSurveyConfig } from './recordedSurvey';
import { surveyResponseContract } from './surveyRevision';
const current = { pages: [{ elements: [{ name: 'q', type: 'rating', rateMax: 100 }] }] };
const old = { survey_metadata: { survey_revision: 'v1', survey_response_contract: { questions: [{ name: 'q', type: 'rating', rateMax: 5 }] } } };
test('mixed versions are separated and use recorded scale settings', () => {
  const rows = [old, { survey_metadata: { survey_revision: 'v2' } }];
  expect(recordedRevisionSelection(rows)).toBe('v1');
  expect(recordedSurveyConfig(rows, current).pages[0].elements[0].rateMax).toBe(5);
  expect(recordedRevisionSelection(rows, 'v2')).toBe('v2');
});
test('snapshot copies nested settings and records resolved skill revisions without executable HTML or injected media', () => {
  const config = { pages: [{ elements: [{ name: 's', type: 'skillquestion', skillId: 's1', skillConfig: { budget: 10 } }] }] };
  const resolved = { pages: [{ elements: [{ name: 's', skillRevision: 3, skillHtml: '<script>private</script>', skillResultSchema: [{ key: 'v', type: 'allocation', options: ['a'] }], skillConfig: { budget: 10, injectedImages: ['secret'], token: 'secret' } }] }] };
  const snapshot = surveyResponseContract(config, resolved);
  resolved.pages[0].elements[0].skillResultSchema[0].options.push('b');
  expect(snapshot.questions[0].skillRevision).toBe(3);
  expect(snapshot.questions[0].skillResultSchema[0].options).toEqual(['a']);
  expect(JSON.stringify(snapshot)).not.toMatch(/secret|script/);
});
