import { escapeCsvCell } from './csvUtil';
import { responseRecordKey, responseWithinDateRange } from './responseIdentity';
import { summarizeQuality } from './quality';
import { buildResultsExportBundle } from './questionSummaryExport';
import { surveyResponseContract } from './surveyRevision';

test('CSV preserves numeric negatives and escapes formula-like participant text', () => {
  expect(escapeCsvCell(-3.5)).toBe('-3.5');
  expect(escapeCsvCell('-3.5')).toBe('-3.5');
  expect(escapeCsvCell('=1+1')).toBe("'=1+1");
  expect(escapeCsvCell(' +SUM(A1)')).toBe("' +SUM(A1)");
  expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
});
test('local date filter includes the last millisecond, excluding unknown timestamps', () => {
  expect(responseWithinDateRange({ created_at: '2026-09-10T23:59:59.999' }, '2026-09-10', '2026-09-10')).toBe(true);
  expect(responseWithinDateRange({ created_at: '2026-09-11T00:00:00' }, '', '2026-09-10')).toBe(false);
  expect(responseWithinDateRange({}, '2026-09-10', '')).toBe(false);
  expect(responseWithinDateRange({}, '', '')).toBe(true);
});
test('repeat participant submissions keep separate quality flags', () => {
  const config = { pages: [{ elements: [{ name: 'check', type: 'text', isAttentionCheck: true, expectedAnswer: 'yes' }] }] };
  const rows = [{ _filename: 'one.json', participant_id: 'repeat', responses: { check: 'no' } }, { _filename: 'two.json', participant_id: 'repeat', responses: { check: 'yes' } }];
  const quality = summarizeQuality(rows, config);
  expect(quality.perResponse[responseRecordKey(rows[0])]).toContain('failed_attention');
  expect(quality.perResponse[responseRecordKey(rows[1])]).not.toContain('failed_attention');
});
test('recorded question contract retains analysis settings without arbitrary skill secrets', () => {
  const config = { pages: [{ elements: [{ name: 'scale', type: 'slidergroup', scaleStep: 0.5, isAttentionCheck: true, expectedAnswer: 1 },
    { name: 'custom', type: 'skillquestion', skillConfig: { scaleMin: 0, scaleMax: 100, budget: 20, apiKey: 'secret', token: 'secret' } }] }] };
  const contract = surveyResponseContract(config);
  expect(contract.questions[0]).toMatchObject({ scaleStep: 0.5, isAttentionCheck: true });
  expect(contract.questions[1].skillConfig).toEqual({ scaleMin: 0, scaleMax: 100, budget: 20 });
  expect(JSON.stringify(contract)).not.toContain('secret');
});
test('analysis bundle includes exact selected raw submissions for lossless reanalysis', () => {
  const responses = [{ id: 'a', participant_id: 'p', responses: { q: '=1+1', missing: null } }];
  const q = { name: 'q', type: 'text' };
  const bundle = buildResultsExportBundle({ project: { id: 'test' }, surveyConfig: { pages: [{ elements: [q] }] }, questions: [q], filteredResponses: responses, dateFilteredResponses: responses });
  expect(JSON.parse(bundle.find((f) => f.path === 'responses_raw.json').content)).toEqual(responses);
});
test('full analysis pack carries the silicon agreement tables when given', () => {
  const q = { name: 'q', type: 'radiogroup', choices: ['a', 'b'] };
  const responses = [{ participant_id: 'p', responses: { q: 'a' } }];
  const silicon = [{ path: 'silicon_agreement.csv', content: 'question_name\n' }, { path: 'silicon_agreement_gaps.csv', content: 'question_name\n' }];
  const bundle = buildResultsExportBundle({ project: { id: 'test' }, surveyConfig: { pages: [{ elements: [q] }] }, questions: [q], filteredResponses: responses, dateFilteredResponses: responses, siliconAgreementFiles: silicon });
  expect(bundle.map((f) => f.path)).toEqual(expect.arrayContaining(['silicon_agreement.csv', 'silicon_agreement_gaps.csv']));
  expect(bundle[0].content).toMatch(/silicon_agreement\.csv/);
  const plain = buildResultsExportBundle({ project: { id: 'test' }, surveyConfig: { pages: [{ elements: [q] }] }, questions: [q], filteredResponses: responses, dateFilteredResponses: responses });
  expect(plain.some((f) => f.path.startsWith('silicon_'))).toBe(false);
});
