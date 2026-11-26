import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ResultsAnalysis, { QuestionCard, buildQuestionCardProps } from './ResultsAnalysis';
import { RegionProvider } from '../../contexts/RegionContext';
import { createResultsReport, readResultsReport, reportStorageKey, writeResultsReport } from '../../lib/resultsReportStore';
import { saveProjectFull } from '../../lib/projectManager';
import { fetchAdminResponsePage } from '../../lib/adminResults';
import { getSkillById } from '../../lib/skillManager';

jest.mock('../../lib/supabase', () => ({supabase: null}));
jest.mock('../../lib/skillManager', () => ({ getSkillById: jest.fn() }));
jest.mock('../../lib/projectManager', () => ({saveProjectFull: jest.fn()}));
jest.mock('./ImagePerceptionPanel', () => () => null);
jest.mock('../../lib/adminResults', () => ({
  fetchAdminResponsePage: jest.fn(),
  fetchOwnerResponsePage: jest.fn(),
  createResponseLoadSession: () => ({ contracts: new Map(), mode: 'auto' }),
}));

const q = {name: 'q', type: 'rating', title: 'Comfort'};
const config = {pages: [{name: 'page', elements: [q]}]};
const responses = [
  {id: 'one', participant_id: 'p1', responses: {q: 1}},
  {id: 'two', participant_id: 'p1', responses: {q: 5}},
];
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); });

test('platform admin reads the selected project through the admin API without delete controls', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'other-owner-project', name: 'Other project' }} surveyConfig={config} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  // readAllResponsePages passes the in-flight AbortSignal so a newer load can cancel this page.
  expect(fetchAdminResponsePage).toHaveBeenCalledWith('other-owner-project', 0, null, expect.any(Object), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.queryByRole('tab', { name: /^Data$/i })).toBeNull();
  expect(screen.getByRole('tab', { name: /^Overview$/i }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: /Response records/i }));
  expect(screen.getAllByRole('button', {name: 'View'})).toHaveLength(2);
  expect(screen.queryByRole('button', {name: 'Delete this response'})).toBeNull();
  expect(saveProjectFull).not.toHaveBeenCalled();
});

test('platform admin can generate an AI analysis for a custom question and sees the saved one', async () => {
  const customConfig = { pages: [{ name: 'p1', elements: [{ type: 'custom', name: 'q', title: 'Custom' }] }] };
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'other-owner-project', metadata: { resultsAiAnalyses: {} } }} surveyConfig={customConfig} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  fireEvent.click(screen.getByRole('tab', { name: /^Questions$/i }));
  fireEvent.click(await screen.findByRole('button', { name: 'Expand analysis: q' }));
  expect(await screen.findByTestId('ai-analysis-generate')).toBeTruthy();
});

test('a custom task whose records rate several images on the same items gets a platform table before any model', async () => {
  const task = { type: 'skillquestion', name: 'task', title: 'Rural scenes', skillId: 'skill_rural', skillRevision: 2 };
  const taskConfig = { pages: [{ name: 'p1', elements: [task] }] };
  const scene = (id, a1) => ({ imageId: id, imageName: `${id}__1a6d.jpg`, ratings: { A1: a1, M1: 4, S3: 3 } });
  const rows = [
    { id: 'a', participant_id: 'p1', responses: { task: { scenes: [scene('P027B', 1), scene('P034B', 5)], complete: true } } },
    { id: 'b', participant_id: 'p2', responses: { task: { scenes: [scene('P027B', 4), scene('P034B', 5)], complete: true } } },
  ];
  getSkillById.mockResolvedValue({ sourceHtml: '<script>SPSkill.setAnswer({ scenes })</script>' });
  fetchAdminResponsePage.mockResolvedValueOnce(rows).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'other-owner-project', metadata: { resultsAiAnalyses: {} } }} surveyConfig={taskConfig} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  fireEvent.click(screen.getByRole('tab', { name: /^Questions$/i }));
  fireEvent.click(await screen.findByRole('button', { name: 'Expand analysis: task' }));
  const table = within(await screen.findByTestId('ai-analysis-platform'));
  expect(table.getByText('A1')).toBeTruthy();
  const p027 = table.getByRole('row', { name: /P027B__1a6d\.jpg/ });
  // mean of A1 over the two raters, then n
  expect(within(p027).getByText('2.500')).toBeTruthy();
  expect(within(p027).getByText('2')).toBeTruthy();
  expect(screen.getByTestId('ai-analysis-generate')).toBeTruthy();
  await waitFor(() => expect(getSkillById).toHaveBeenCalledWith('skill_rural', 2));
});

test('unreadable admin rows are skipped so the rest of the project still loads', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce([
    ...responses,
    { id: 'bad', _unreadable: true, _unreadableReason: 'oversized_or_timeout', responses: {} },
  ]).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'other-owner-project' }} surveyConfig={config} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  expect(screen.getByText(/too large or unreadable/i)).toBeTruthy();
  expect(screen.queryByText(/Failed to load responses/)).toBeNull();
});

test('admin permission errors are shown instead of falling back to local responses', async () => {
  const denied = new Error('仅平台管理员可以查看此项目的答卷。');
  denied.requestId = 'req-admin-forbidden';
  denied.stage = 'admin';
  fetchAdminResponsePage.mockRejectedValue(denied);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'restricted-project' }} surveyConfig={config} adminMode /></RegionProvider>);
  expect(await screen.findByText(/仅平台管理员可以查看此项目的答卷/)).toBeTruthy();
  expect(screen.getByText(/req-admin-forbidden/)).toBeTruthy();
  expect(screen.queryByText(/2 \/ 2 submissions in analysis/)).toBeNull();
  expect(screen.getAllByRole('heading', { name: '–' }).length).toBeGreaterThan(0);
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
  await screen.findByText(/2 \/ 2 submissions in analysis/);
});

test('collapsed question cards do not mount their analysis until expanded', async () => {
  const picker = { name: 'safe', type: 'imagepicker', title: 'Safer?' };
  const rows = [
    { id: 'a', participant_id: 'p1', responses: { safe: { answer: 'https://m.example/x.jpg', shown_images: ['https://m.example/x.jpg', 'https://m.example/y.jpg'] } } },
    { id: 'b', participant_id: 'p2', responses: { safe: { answer: 'https://m.example/y.jpg', shown_images: ['https://m.example/x.jpg', 'https://m.example/y.jpg'] } } },
  ];
  render(<RegionProvider><QuestionCard {...buildQuestionCardProps(picker, rows)} /></RegionProvider>);
  expect(screen.getByText(/2 \/ 2 submissions answered/)).toBeTruthy();
  expect(screen.queryByText(/Paper methods/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand analysis: safe' }));
  expect(await screen.findByText(/TrueSkill \(pairwise/)).toBeTruthy();
  expect(screen.queryByText(/Paper methods/)).toBeNull();
  expect(screen.getByText('Coverage and reliability')).toBeTruthy();
});

test('question card uses submission denominator for repeat participants', () => {
  render(<RegionProvider><QuestionCard {...buildQuestionCardProps(q, responses)} /></RegionProvider>);
  expect(screen.getByText(/2 \/ 2 submissions answered \(100%\) · 1 participants/)).toBeTruthy();
});

test('filter preference does not save the survey and submission details are available', async () => {
  const previousFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ok: true, json: async () => ({responses})});
  try {
    render(<RegionProvider><ResultsAnalysis currentProject={{id: 'project', name: 'Project'}} surveyConfig={config} /></RegionProvider>);
    await screen.findByText(/2 \/ 2 submissions in analysis/);
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    fireEvent.click(screen.getByRole('switch', {name: 'Include researcher practice'}));
    expect(saveProjectFull).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('sp-analysis-prefs:project')).includePractice).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull());
    expect(screen.queryByRole('tab', { name: /^Data$/i })).toBeNull();
  expect(screen.getByRole('tab', { name: /^Overview$/i }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Response records/i }));
    fireEvent.click(screen.getAllByRole('button', {name: 'View'})[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Not recorded (historical response)', {exact: false})).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  } finally { global.fetch = previousFetch; }
});


test('records and quality have direct tabs and do not require expanding a section', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'p' }} surveyConfig={config} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Questions', 'Response records', 'Data Quality']);
  expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Response records' }));
  expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('tab', { name: 'Data Quality' }));
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
});

test.each([['Complete report', 'completed', 'Latest analysis'], ['', 'completed', 'Incomplete analysis']])(
  'saved report %s can be opened and deleted without deleting responses', async (narrative, status, title) => {
    fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
    // Include the empty completed report produced by older versions.
    localStorage.setItem(reportStorageKey('p'), JSON.stringify(createResultsReport({ narrative, status })));
    render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'p' }} surveyConfig={config} adminMode /></RegionProvider>);
    await screen.findByText(/2 \/ 2 submissions in analysis/);
    fireEvent.click(screen.getByRole('button', { name: 'View report' }));
    const dialog = await screen.findByRole('dialog', { name: title });
    expect(within(dialog).getByText(narrative || 'This analysis did not produce a complete report. Run the analysis again.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete report' }));
    await waitFor(() => expect(readResultsReport('p')).toBeNull());
    expect(screen.queryByRole('button', { name: 'View report' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Response records' }));
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(2);
  },
);

test('an empty or cancelled analysis cannot replace a saved report', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  const previous = createResultsReport({ narrative: 'Previous completed report' });
  writeResultsReport('p', previous);
  let save;
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'p' }} surveyConfig={config} adminMode
    onAnalyzeCurrent={({ onSaved }) => { save = onSaved; }} /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  fireEvent.click(within(screen.getByRole('group', { name: 'Results Analysis' })).getByRole('button', { name: 'Analyze current results' }));
  act(() => { save({ status: 'cancelled', narrative: 'Partial output' }); save({ narrative: '' }); });
  expect(readResultsReport('p').id).toBe(previous.id);
});

test('a page imported as it is shows its questions greyed out and unanalysed', () => {
  render(<RegionProvider><QuestionCard question={q} answers={[1, 5]} totalResponses={2} questionNumber={1}
    allResponses={responses} surveyConfig={{ ...config, spSite: { html: '<html></html>', convertedFrom: 'survey.html' } }} defaultExpanded /></RegionProvider>);
  expect(screen.getByTestId('custom-record-analysis').textContent).toMatch(/imported as it is/);
  expect(screen.getByText('Analyse yourself')).toBeTruthy();
});

test('a page built to SP-Scheme keeps the platform analysis', () => {
  render(<RegionProvider><QuestionCard question={q} answers={[1, 5]} totalResponses={2} questionNumber={1}
    allResponses={responses} surveyConfig={{ ...config, spSite: { html: '<html></html>' } }} defaultExpanded /></RegionProvider>);
  expect(screen.queryByTestId('custom-record-analysis')).toBeNull();
  expect(screen.queryByText('Analyse yourself')).toBeNull();
});

test('the export menu offers the answers table, the analysis pack, figures and the dataset package', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'p' }} surveyConfig={config} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  fireEvent.click(screen.getByRole('button', { name: /^Export/ }));
  expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Answers table (CSV)', 'Full analysis pack (ZIP)', 'All figures (SVG + PNG, ZIP)', 'Citable dataset package (ZIP)…']);
});

test('a page imported as it is exports one ZIP of its answers, or a dataset package', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'p' }} surveyConfig={{ ...config, spSite: { html: '<html></html>', convertedFrom: 'survey.html' } }} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  fireEvent.click(screen.getByRole('button', { name: /^Export/ }));
  expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['All answers (ZIP)', 'Citable dataset package (ZIP)…']);
});

test('a custom question on a page built to SP-Scheme is greyed and marked analyse yourself', () => {
  const custom = { name: 'c', type: 'custom', title: 'Custom' };
  render(<RegionProvider><QuestionCard question={custom} answers={[{ a: 1 }]} totalResponses={1} questionNumber={1}
    allResponses={[{ id: 'one', participant_id: 'p1', responses: { c: { a: 1 } } }]} surveyConfig={{ pages: [{ name: 'p', elements: [custom] }], spSite: { html: '<html></html>' } }} defaultExpanded /></RegionProvider>);
  expect(screen.getByTestId('custom-record-analysis')).toBeTruthy();
  expect(screen.getByText('Analyse yourself')).toBeTruthy();
});

test('an advanced custom task is greyed and marked analyse yourself, a built-in interactive question is named', () => {
  const task = { name: 'k', type: 'skillquestion', skillId: 'skill_abc', title: 'My task' };
  const rows = [{ id: 'one', participant_id: 'p1', responses: { k: { answer: { v: 1 } } } }];
  const { unmount } = render(<RegionProvider><QuestionCard question={task} answers={[{ answer: { v: 1 } }]} totalResponses={1} questionNumber={1}
    allResponses={rows} surveyConfig={{ pages: [{ name: 'p', elements: [task] }] }} defaultExpanded /></RegionProvider>);
  expect(screen.getByText('Advanced custom task')).toBeTruthy();
  expect(screen.getByText('Analyse yourself')).toBeTruthy();
  expect(screen.getByTestId('custom-record-analysis').textContent).toMatch(/advanced custom task/);
  unmount();
  const preset = { ...task, skillId: 'preset_image_preference_forced' };
  render(<RegionProvider><QuestionCard question={preset} answers={[]} totalResponses={1} questionNumber={1}
    allResponses={rows} surveyConfig={{ pages: [{ name: 'p', elements: [preset] }] }} /></RegionProvider>);
  expect(screen.getByText(/^Interactive · /)).toBeTruthy();
  expect(screen.queryByText('Analyse yourself')).toBeNull();
});

test('without AI handlers (Studio) the analysis and explain buttons are not shown', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'p' }} surveyConfig={config} adminMode /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  expect(screen.queryByRole('button', { name: 'Analyze current results' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /^Questions$/i }));
  await screen.findByRole('button', { name: 'Expand analysis: q' });
  expect(screen.queryByRole('button', { name: 'Explain this question' })).toBeNull();
});

test('with the AI handlers (classic editor) both buttons are there', async () => {
  fetchAdminResponsePage.mockResolvedValueOnce(responses).mockResolvedValue([]);
  const onExplainQuestion = jest.fn();
  render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'p' }} surveyConfig={config} adminMode
    onAnalyzeCurrent={() => {}} onExplainQuestion={onExplainQuestion} /></RegionProvider>);
  await screen.findByText(/2 \/ 2 submissions in analysis/);
  expect(screen.getByRole('button', { name: 'Analyze current results' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /^Questions$/i }));
  const expand = await screen.findByRole('button', { name: 'Expand analysis: q' });
  if (expand.getAttribute('aria-expanded') !== 'true') fireEvent.click(expand);
  fireEvent.click(await screen.findByRole('button', { name: 'Explain this question' }));
  expect(onExplainQuestion).toHaveBeenCalledTimes(1);
});
