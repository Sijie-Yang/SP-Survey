import { buildSiteResultsExportFiles } from './questionSummaryExport';

test('an SP-Scheme export holds only the answers table and the raw records', () => {
  const files = buildSiteResultsExportFiles({ project: { id: 'p' }, filteredResponses: [{ id: 'a', responses: { __sp_requests: [{ url: '/api/x' }] } }], wideCsv: 'id\na\n' });
  expect(files.map((f) => f.path)).toEqual(['README.txt', 'responses_wide.csv', 'responses_raw.json', 'references.bib', 'CITATION.cff']);
  expect(JSON.parse(files[2].content)[0].responses.__sp_requests[0].url).toBe('/api/x');
  expect(files[0].content).toMatch(/has not analysed anything/);
});

test('an SP-Scheme export carries the AI analyses generated on the Results page', () => {
  const files = buildSiteResultsExportFiles({
    project: { id: 'p' },
    filteredResponses: [],
    wideCsv: 'participant_id\n',
    aiAnalysisFiles: [{ path: 'questions/q__ai__1_pairwise.csv', content: 'x' }, { path: 'questions/q__ai__analyze.js', content: 'y' }],
  });
  expect(files.map((f) => f.path)).toEqual(['README.txt', 'responses_wide.csv', 'responses_raw.json', 'references.bib', 'CITATION.cff', 'questions/q__ai__1_pairwise.csv', 'questions/q__ai__analyze.js']);
  expect(files[0].content).toMatch(/AI-written analyses/);
});
