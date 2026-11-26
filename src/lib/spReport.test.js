import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';
import { flattenQuestions } from './quality';
import { buildExportSpReport, buildResultsExportBundle, collectShownStimuli } from './questionSummaryExport';
import { SP_REPORT_ITEMS, buildSpReport, spReportLines } from './spReport';

const config = syntheticSurveyConfig({ images: 6 });
const questions = flattenQuestions(config);
const responses = syntheticResponses(30, { config });
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

test('ten items in a fixed order', () => {
  expect(SP_REPORT_ITEMS.map((i) => i.id)).toEqual(['stimuli', 'sampling', 'paradigm', 'exposure', 'quality', 'aggregation', 'demographics', 'consent', 'synthetic', 'availability']);
});

test('fills what the data can tell, leaves the rest to the authors', () => {
  const r = byId(buildExportSpReport({ surveyConfig: config, questions, filteredResponses: responses, dateFilteredResponses: responses, excludeFlagged: true }));
  expect(r.stimuli.status).toBe('partial');
  expect(r.stimuli.text).toMatch(/6 distinct stimuli were shown, served from media\.example\.org \(6\)/);
  expect(r.sampling.text).toMatch(/^30 submissions from \d+ participants, collected 2026-09-0\d to 2026-09-0\d/);
  expect(r.paradigm.status).toBe('filled');
  expect(r.paradigm.text).toMatch(/pairwise \/ multiple image choice \(safe, lively, beautiful\)/);
  expect(r.paradigm.text).toMatch(/per-image rating scale \(comfort, greenery\)/);
  expect(r.exposure.text).toMatch(/^Across all questions, each stimulus was shown \d+–\d+ times \(median [\d.]+\);/);
  expect(r.paradigm.text).not.toMatch(/\(consent\)/);
  expect(r.paradigm.text).toMatch(/personality_1, personality_2, personality_3 and 7 more/);
  expect(r.aggregation.text).toMatch(/TrueSkill/);
  expect(r.aggregation.text).toMatch(/mean, SD and 95% CI/);
  expect(r.demographics.text).toMatch(/gender/);
  expect(r.demographics.text).toMatch(/age/);
  expect(r.consent.text).toMatch(/consent/);
  expect(r.synthetic.text).toMatch(/no silicon samples are included/);
  expect(r.availability.status).toBe('todo');
});

test('exclusions, silicon comparison and DOI are reported', () => {
  const r = byId(buildSpReport({
    surveyConfig: config, responses: responses.slice(0, 25), allResponses: responses, excludeFlagged: true,
    stimuli: collectShownStimuli(questions, responses, config), siliconCompared: true, doi: '10.5281/zenodo.1',
  }));
  expect(r.quality.text).toMatch(/excluded \(5 of 30\)/);
  expect(r.synthetic.text).toMatch(/silicon_agreement\.csv/);
  expect(r.availability).toMatchObject({ status: 'filled', text: expect.stringMatching(/doi\.org\/10\.5281\/zenodo\.1/) });
});

test('a survey with no stimuli and no demographics', () => {
  const plain = { pages: [{ elements: [{ name: 'q', type: 'radiogroup', title: 'Pick', choices: ['a', 'b'] }] }] };
  const r = byId(buildSpReport({ surveyConfig: plain, responses: [{ participant_id: 'p', responses: { q: 'a' } }] }));
  expect(r.stimuli.status).toBe('todo');
  expect(r.exposure.text).toMatch(/Not applicable/);
  expect(r.demographics.text).toBe('No demographic questions were asked.');
  expect(r.consent.text).toMatch(/No consent question/);
});

test('the analysis pack carries the checklist, CITATION.cff and references.bib', () => {
  const files = buildResultsExportBundle({ project: { id: 'p', name: 'P' }, surveyConfig: config, questions, filteredResponses: responses, dateFilteredResponses: responses });
  const get = (p) => files.find((f) => f.path === p)?.content || '';
  expect(get('README.txt')).toMatch(/How to cite SP-Survey:/);
  expect(get('README.txt')).toMatch(/Reporting checklist \(SP-Report v1, https:\/\/sp-survey\.org\/docs\/sp-report\)/);
  expect(get('methods.txt')).toMatch(/\[x\] 3\. Task paradigm:/);
  expect(get('methods.txt')).toMatch(/using SP-Survey \(2026; version /);
  expect(get('CITATION.cff')).toMatch(/cff-version: 1\.2\.0/);
  expect(get('references.bib')).toMatch(/@software\{spsurvey_software,/);
  expect(get('references.bib')).not.toMatch(/@article\{yang2026spsurvey,/);
  expect(spReportLines(buildSpReport({ surveyConfig: config, responses }))).toHaveLength(13);
});
