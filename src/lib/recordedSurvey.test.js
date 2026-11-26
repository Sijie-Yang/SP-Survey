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
test('map study areas are part of the recorded question contract', () => {
  const studyAreas = [{ id: 'knoxville-1990', cityId: 'knoxville', boundary: { type: 'Polygon', coordinates: [[[-84, 35], [-83, 35], [-83, 36], [-84, 35]]] } }];
  const snapshot = surveyResponseContract({ pages: [{ elements: [{ name: 'liked_areas', type: 'mapannotation', cityQuestion: 'city', studyAreas, description: 'draw' }] }] });
  expect(snapshot.questions[0].studyAreas).toEqual(studyAreas);
  expect(snapshot.questions[0].cityQuestion).toBe('city');
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

test('recorded contracts without conditionVariants borrow them from the current question', () => {
  const variants = [{ condition: 'less', title: 'Less?', reverseCoded: true }];
  const responses = [{ survey_metadata: { survey_revision: 'r1', survey_response_contract: { questions: [{ name: 'q', type: 'imagepicker', title: 'More?' }] } } }];
  const current = { pages: [{ elements: [{ name: 'q', type: 'imagepicker', title: 'More?', conditionVariants: variants }] }] };
  expect(recordedSurveyConfig(responses, current).pages[0].elements[0].conditionVariants).toEqual(variants);
});

test('map contracts without a study area use the area configured on the question', () => {
  const studyAreas = [{ id: 'knoxville-1990', revision: 1, cityId: 'knoxville', boundary: { type: 'Polygon', coordinates: [[[-84, 35], [-83, 35], [-83, 36], [-84, 35]]] } }];
  const responses = [{ survey_metadata: { survey_revision: 'r1', survey_response_contract: { questions: [{ name: 'liked_areas', type: 'mapannotation', title: 'Liked' }] } } }];
  const current = { pages: [{ elements: [{ name: 'liked_areas', type: 'mapannotation', title: 'Liked', cityQuestion: 'city', studyAreas }] }] };
  const question = recordedSurveyConfig(responses, current).pages[0].elements[0];
  expect(question.studyAreas).toEqual(studyAreas);
  expect(question.cityQuestion).toBe('city');
});

test('a study area already stored on the response is not replaced', () => {
  const recorded = [{ id: 'old-area', boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }];
  const currentAreas = [{ id: 'new-area', boundary: { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] } }];
  const responses = [{ survey_metadata: { survey_revision: 'r1', survey_response_contract: { questions: [{ name: 'liked_areas', type: 'mapannotation', studyAreas: recorded }] } } }];
  const current = { pages: [{ elements: [{ name: 'liked_areas', type: 'mapannotation', studyAreas: currentAreas }] }] };
  expect(recordedSurveyConfig(responses, current).pages[0].elements[0].studyAreas).toEqual(recorded);
});
