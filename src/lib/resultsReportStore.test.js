import {
  createResultsReport, deleteResultsReport, readResultsReport, reportFromAnalysisResult,
  reportStorageKey, writeResultsReport,
} from './resultsReportStore';

beforeEach(() => localStorage.clear());

test.each([
  undefined,
  { success: false, status: 'cancelled', message: 'Partial output' },
  { success: false, error: 'Request failed' },
  { success: true, status: 'cancelled', message: 'Partial output' },
  { success: true, message: '  ' },
])('does not create a completed report from an unsuccessful result: %j', (result) => {
  expect(reportFromAnalysisResult(result)).toBeNull();
});

test('captures only the completed request output and its model/run provenance', () => {
  const report = reportFromAnalysisResult({
    success: true, message: 'New report', provider: 'provider', model: 'model', runId: 'run-2',
    messages: [{ role: 'assistant', content: 'Old unrelated answer' }],
  }, { scope: { projectId: 'p' } });
  expect(report).toMatchObject({ status: 'completed', narrative: 'New report', provider: 'provider', model: 'model', runId: 'run-2' });
});

test('empty or incomplete output preserves the previous report; deletion is project-specific', () => {
  const report = createResultsReport({ narrative: 'Completed report' });
  writeResultsReport('p1', report);
  writeResultsReport('p2', report);
  expect(writeResultsReport('p1', createResultsReport())).toBeNull();
  expect(writeResultsReport('p1', createResultsReport({ status: 'cancelled', narrative: 'Partial' }))).toBeNull();
  expect(readResultsReport('p1')).toEqual(report);
  deleteResultsReport('p1');
  expect(localStorage.getItem(reportStorageKey('p1'))).toBeNull();
  expect(readResultsReport('p2')).toEqual(report);
});
