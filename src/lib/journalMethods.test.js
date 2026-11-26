import { syntheticResponses, syntheticSurveyConfig } from './__fixtures__/syntheticResults';
import { britishSpelling, journalMethodsFiles, methodsFacts, renderJournalMethods } from './journalMethods';
import { PLATFORM_VERSION } from './platformCitation';

const config = syntheticSurveyConfig({ images: 8 });
const all = syntheticResponses(40, { config });
const facts = methodsFacts({ surveyConfig: config, responses: all.slice(0, 36), allResponses: all, excludeFlagged: true, stimuli: [{ source: 'a', times_shown: 10 }, { source: 'b', times_shown: 14 }] });

test('facts come from the survey and the data', () => {
  expect(facts.pairwise.map((p) => p.name)).toEqual(['safe', 'lively', 'beautiful']);
  expect(facts.ratings.map((r) => r.name)).toEqual(expect.arrayContaining(['comfort', 'greenery']));
  expect(facts.sliders[0].dims).toEqual(['Calm', 'Open']);
  expect(facts).toMatchObject({ nRecorded: 40, nRetained: 36, nExcluded: 4, nStimuli: 2, exposure: { min: 10, max: 14 } });
  expect(facts.conditions).toEqual(['Group A', 'Group B']);
});

test('EPB: SAGE Harvard citation, British spelling, unnumbered headings', () => {
  const { markdown } = renderJournalMethods(facts, 'epb');
  expect(markdown).toMatch(/^# Methods/);
  expect(markdown).toMatch(/with SP-Survey \(2026\), an open-source platform/);
  expect(markdown).toMatch(/SP-Survey \(2026\) Version .* \[Computer software\]\. Urban Analytics Lab/);
  expect(markdown).not.toMatch(/Yang|Environment and Planning B: Urban|under review/);
  expect(markdown).toMatch(/summarised/);
  expect(markdown).not.toMatch(/summarized/);
  expect(markdown).toMatch(/Herbrich R, Minka T and Graepel T \(2007\)/);
  expect(markdown).toContain(`version ${PLATFORM_VERSION}`);
  expect(markdown).not.toMatch(/generative AI/);
});

test('CEUS and LUP: Elsevier citations, numbered headings, required statements', () => {
  const ceus = renderJournalMethods(facts, 'ceus').markdown;
  expect(ceus).toMatch(/^# 2\. Methods/);
  expect(ceus).toMatch(/## 2\.1\. Survey instrument/);
  expect(ceus).toMatch(/with SP-Survey \(2026\)/);
  expect(ceus).toMatch(/SP-Survey \(Version .*\) \[Computer software\]\. \(2026\)\./);
  expect(ceus).toMatch(/Software and code availability/);
  expect(ceus).toMatch(/Declaration of generative AI use/);
  expect(ceus).not.toMatch(/## 2\.4\. Ethics/);
  const lup = renderJournalMethods(facts, 'lup', { doi: '10.5281/zenodo.123' }).markdown;
  expect(lup).toMatch(/## 2\.4\. Ethics/);
  expect(lup).toMatch(/informed consent/);
  expect(lup).toMatch(/https:\/\/doi\.org\/10\.5281\/zenodo\.123/);
  expect(lup).toMatch(/Further questions used single-choice, drop-down, Likert-grid and open-text formats/);
  expect(lup).toMatch(/Of these, 4 flagged submissions were excluded, leaving 36/);
  expect(lup).toMatch(/In three pairwise-choice tasks \("Which place looks safer\?", "Which place looks livelier\?" and "Which place looks more beautiful\?"\)/);
  expect(lup).toMatch(/Ten further items \("BFI 1", "BFI 2", "BFI 3" and 7 others\)/);
});

test('British spelling leaves quoted titles and URLs alone', () => {
  expect(britishSpelling('We analyzed the "color of streets" at https://x.org/color, by color.')).toBe('We analysed the "color of streets" at https://x.org/color, by colour.');
});

test('one file per journal', () => {
  expect(journalMethodsFiles(facts).map((f) => f.path)).toEqual(['methods_for_journals/EPB.md', 'methods_for_journals/CEUS.md', 'methods_for_journals/LUP.md']);
});
