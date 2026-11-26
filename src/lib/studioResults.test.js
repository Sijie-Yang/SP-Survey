import { studioExportFiles, studioExportRows } from './studioResults';

jest.mock('./supabase', () => ({ supabase: null }));

const rows = [
  { id: 'r1', participant_id: 'a', responses: { q1: 3 }, survey_metadata: {} },
  { id: 'r2', participant_id: 'b', responses: { q1: 4 }, survey_metadata: { practice_mode: true } },
  { id: 'r3', participant_id: 'c', responses: { q1: 5 }, source: 'silicon', survey_metadata: {} },
  { id: 'r4', participant_id: 'd', responses: { q1: 1 }, survey_metadata: { silicon_run_id: 'run1' } },
];
const classic = { pages: [{ name: 'p', elements: [{ type: 'rating', name: 'q1', title: 'How safe?' }] }] };

test('the download leaves out silicon runs, and practice runs unless the survey includes them', () => {
  expect(studioExportRows(rows, classic).map((r) => r.id)).toEqual(['r1']);
  expect(studioExportRows(rows, { ...classic, includeResearcherPractice: true }).map((r) => r.id)).toEqual(['r1', 'r2']);
});

test('a classic survey downloads the wide table and the raw records', () => {
  const files = studioExportFiles({ project: { id: 'p1', name: 'Study' }, config: classic, responses: rows });
  expect(files.map((f) => f.path)).toEqual(['responses_wide.csv', 'responses_raw.json']);
  expect(files[0].content).toContain('q1');
  expect(JSON.parse(files[1].content)).toHaveLength(1);
});

test('a page imported as it is downloads the same files as its Results page', () => {
  const config = { pages: [], spSite: { html: '<p>x</p>', id: 's', convertedFrom: 'index.html' } };
  const files = studioExportFiles({ project: { id: 'p1', name: 'Study' }, config, responses: rows });
  expect(files.map((f) => f.path)).toEqual(['README.txt', 'responses_wide.csv', 'responses_raw.json', 'references.bib', 'CITATION.cff']);
});
