import { QUALTRICS_SAMPLE } from './__fixtures__/qualtricsSample';
import { htmlToText, isQsfFile, qsfToSurveyConfig } from './qsfImport';
import { validateSurveyConfig } from './designProtocol/validate';

const { surveyConfig, report } = qsfToSurveyConfig(QUALTRICS_SAMPLE);
const els = surveyConfig.pages.flatMap((p) => p.elements);
const byName = Object.fromEntries(els.map((e) => [e.name, e]));

test('produces a valid config with pages from blocks and page breaks, in flow order', () => {
  expect(validateSurveyConfig(surveyConfig).errors).toEqual([]);
  expect(surveyConfig.title).toBe('Street perception pilot');
  expect(surveyConfig.description).toBe('Pilot & test');
  expect(surveyConfig.pages.map((p) => p.elements.map((e) => e.name))).toEqual([
    ['intro', 'Q2'], ['walk_freq'], ['safety_matrix', 'feel', 'rank'], ['age', 'comments', 'nps', 'country', 'budget', 'contact_1', 'contact_2'],
  ]);
  expect(byName.old).toBeUndefined();
});

test('maps each common question type', () => {
  expect(byName.intro).toMatchObject({ type: 'expression', title: 'Welcome!\nThis takes 5 minutes.' });
  expect(byName.Q2).toMatchObject({ type: 'radiogroup', isRequired: true, choices: [{ value: '1', text: 'Yes' }, { value: '2', text: 'No' }] });
  expect(byName.walk_freq.type).toBe('checkbox');
  expect(byName.safety_matrix).toMatchObject({ type: 'matrix', rows: [{ value: '1', text: 'Safe' }, { value: '2', text: 'Green' }] });
  expect(byName.safety_matrix.columns.map((c) => c.value)).toEqual(['-1', '0', '1']);
  expect(byName.feel).toMatchObject({ type: 'slidergroup', scaleMin: 0, scaleMax: 10 });
  expect(byName.feel.dimensions[0]).toMatchObject({ id: 'c1', label: 'Calm', left: 'Not at all', right: 'Very' });
  expect(byName.rank.choices).toHaveLength(3);
  expect(byName.age.type).toBe('number');
  expect(byName.comments.type).toBe('comment');
  expect(byName.nps).toMatchObject({ type: 'rating', rateMin: 0, rateMax: 10 });
  expect(byName.country.type).toBe('dropdown');
  expect(byName.budget).toMatchObject({ type: 'pointallocation', budget: 100 });
  expect(byName.contact_1.title).toBe('Contact\nName');
});

test('reports what was not converted', () => {
  expect(report.converted).toBe(11);
  expect(report.skipped).toEqual([expect.objectContaining({ id: 'QID7', tag: 'heat', type: 'HeatMap/OnePoint', reason: expect.stringMatching(/heat map/) })]);
  expect(report.notes).toEqual(expect.arrayContaining([
    'choice_randomization', 'choice_text_entry', 'display_logic', 'embedded_data', 'images_in_text', 'piped_text', 'quotas', 'randomizer',
  ]));
});

test('helpers', () => {
  expect(htmlToText('<div>A&nbsp;&amp;&#160;B</div><ul><li>x</li></ul>')).toBe('A & B\n• x');
  expect(isQsfFile('survey.qsf', '')).toBe(true);
  expect(isQsfFile('x.json', JSON.stringify(QUALTRICS_SAMPLE))).toBe(true);
  expect(isQsfFile('x.json', '{"project":{}}')).toBe(false);
  expect(() => qsfToSurveyConfig({ project: {} })).toThrow(/not a Qualtrics/);
  // Duplicate export tags get unique names.
  const dup = qsfToSurveyConfig({ ...QUALTRICS_SAMPLE, SurveyElements: QUALTRICS_SAMPLE.SurveyElements.map((e) => (e.Payload?.QuestionID === 'QID11' ? { ...e, Payload: { ...e.Payload, DataExportTag: 'age' } } : e)) });
  const names = dup.surveyConfig.pages.flatMap((p) => p.elements.map((e) => e.name));
  expect(names).toContain('age_2');
});
