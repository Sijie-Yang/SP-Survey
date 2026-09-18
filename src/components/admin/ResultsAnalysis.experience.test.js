import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResultsAnalysis, { QuestionCard, buildQuestionCardProps } from './ResultsAnalysis';
import { RegionProvider } from '../../contexts/RegionContext';
import { saveProjectFull } from '../../lib/projectManager';

jest.mock('../../lib/supabase', () => ({ supabase: null }));
jest.mock('../../lib/projectManager', () => ({ saveProjectFull: jest.fn() }));
jest.mock('./ImagePerceptionPanel', () => () => null);

const q = { name: 'q', type: 'rating', title: 'Comfort' };
const config = { pages: [{ name: 'page', elements: [q] }] };
const responses = [
  { id: 'one', participant_id: 'p1', responses: { q: 1 } },
  { id: 'two', participant_id: 'p1', responses: { q: 5 } },
];
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); });

test('question card uses submission denominator for repeat participants', () => {
  render(<RegionProvider><QuestionCard {...buildQuestionCardProps(q, responses)} /></RegionProvider>);
  expect(screen.getByText(/2 \/ 2 submissions answered \(100%\) · 1 participants/)).toBeTruthy();
});

test('filter preference does not save the survey and submission details are available', async () => {
  const previousFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ responses }) });
  try {
    render(<RegionProvider><ResultsAnalysis currentProject={{ id: 'project', name: 'Project' }} surveyConfig={config} /></RegionProvider>);
    await screen.findByText(/2 \/ 2 submissions in analysis/);
    fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    fireEvent.click(screen.getByRole('switch', { name: 'Include researcher practice' }));
    expect(saveProjectFull).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('sp-analysis-prefs:project')).includePractice).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Data/i }));
    fireEvent.click(screen.getByRole('button', { name: /Response records/i }));
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Not recorded (historical response)', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  } finally { global.fetch = previousFetch; }
});
