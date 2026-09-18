import { NO_PREFERENCE } from './choiceTie';
import { summarizeChoiceOutcomes } from './choiceOutcomes';
import { answerToSelectedKeys, extractPairwiseMatches, computeQuestionTrueSkill, matchesFromForcedChoiceAnswer } from './trueskill';
import { buildQuestionLongTable, buildQuestionSummaryRows } from './questionSummaryExport';
import { enrichSurveyResponses } from './enrichSurveyResponses';
import { surveyResponseContract } from './surveyRevision';

const shown = ['https://media.test/a.jpg', 'https://media.test/b.jpg'];
const question = { name: 'q', type: 'imagepicker', allowTie: true, tieLabel: '一样', imageCount: 2 };
const answers = ['image_0', NO_PREFERENCE, 'image_1'];
const responses = answers.map((answer, i) => ({ participant_id: `p${i}`, responses: { q: { answer, shown_images: shown } } }));

test('explicit ties remain valid answers through enrichment and are never treated as a winning image', () => {
  const enriched = enrichSurveyResponses({ responses: { q: NO_PREFERENCE }, displayedImages: { q: shown }, questionTypeMap: { q: 'imagepicker' } });
  expect(enriched.responses?.q?.answer ?? enriched.enrichedResponses?.q?.answer).toBe(NO_PREFERENCE);
  expect(answerToSelectedKeys(NO_PREFERENCE, shown)).toEqual([]);
  expect(extractPairwiseMatches(responses, 'q')).toHaveLength(2);
  expect(computeQuestionTrueSkill(responses, 'q').rankings.map((r) => r.imageKey)).not.toContain(NO_PREFERENCE);
  expect(matchesFromForcedChoiceAnswer({ choice: 'tie', chosenIndex: -1, chosenUrl: shown[0] }, shown)).toEqual([]);
});
test('long export labels A/B/tie and summary keeps ties in its answer denominator', () => {
  const { headers, rows } = buildQuestionLongTable(question, responses);
  expect(headers).toContain('outcome');
  expect(rows.map((r) => r.outcome)).toEqual(['A', 'tie', 'B']);
  expect(rows[1].value).toBe('tie');
  expect(rows[1].shown_images).toContain('a.jpg');
  const summary = buildQuestionSummaryRows(question, responses);
  const tie = summary.find((r) => r.unit_key === 'tie' && r.metric === 'outcome_count');
  expect(tie).toMatchObject({ value: 1, n: 3 });
  expect(summary.find((r) => r.unit_key === 'tie' && r.metric === 'mu')).toBeUndefined();
});
test('all-tie multi-trial responses produce a summary without inventing a TrueSkill ranking', () => {
  const rows = [{ responses: { q: { trials: [{ answer: NO_PREFERENCE, shown_images: shown }, { answer: NO_PREFERENCE, shown_images: shown }] } } }];
  expect(buildQuestionLongTable(question, rows).rows).toHaveLength(2);
  const summary = buildQuestionSummaryRows(question, rows);
  expect(summary.find((r) => r.unit_key === 'tie' && r.metric === 'outcome_rate')).toMatchObject({ value: 1, n: 2 });
  expect(summary.filter((r) => r.metric === 'mu')).toEqual([]);
});
test('forced A/B tie is exported explicitly and historical ties remain visible with the switch disabled', () => {
  const q = { ...question, type: 'skillquestion', skillId: 'preset_image_preference_forced', allowTie: false };
  const data = [{ responses: { q: { answer: { choice: 'tie', chosenIndex: -1, imageA: shown[0], imageB: shown[1] }, shown_images: shown } } }];
  expect(buildQuestionLongTable(q, data).rows[0]).toMatchObject({ value: 'tie', outcome: 'tie' });
  expect(buildQuestionSummaryRows(q, data).find((r) => r.metric === 'outcome_count' && r.unit_key === 'tie').value).toBe(1);
});
test('saved response contracts retain the tie setting and label', () => {
  expect(surveyResponseContract({ pages: [{ elements: [question] }] }).questions[0]).toMatchObject({ allowTie: true, tieLabel: '一样' });
});
test('binary outcome summaries exclude unanswered trials and multi-option choices', () => {
  expect(summarizeChoiceOutcomes([
    { answer: null, shown_images: shown }, { answer: NO_PREFERENCE, shown_images: shown },
    { answer: 'image_0', shown_images: [...shown, '/c.jpg'] },
  ])).toEqual({ A: 0, B: 0, tie: 1, total: 1 });
});
