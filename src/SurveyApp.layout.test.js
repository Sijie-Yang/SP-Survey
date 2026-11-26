import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SurveyApp from './SurveyApp';

const mockConfig = {
  title: 'Layout restart study', showProgressBar: 'off',
  pages: [{ name: 'about', elements: [{ type: 'text', name: 'rater_id', title: 'Rater ID' }] }],
  viewportLayout: { desktop: { contentWidth: 1078, questionWidth: 1060, questions: { rater_id: { questionWidth: 648 } } } },
};
jest.mock('./lib/projectManager', () => ({
  getParticipantProject: async () => ({ id: 'layout_restart', _surveyConfig: mockConfig, preloadedImages: [] }),
}));
jest.mock('./lib/supabase', () => ({ isSupabaseConfigured: () => false, saveSurveyResponse: jest.fn() }));
jest.mock('./lib/surveyPublicApi', () => ({ claimBalanceNumber: async () => null, completeBalanceClaim: async () => false, countProjectResponses: async () => 0, fetchConditionCounts: async () => null }));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/survey?project=layout_restart');
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
});
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

function seedDraft() {
  const snapshot = { ...mockConfig, viewportLayout: { desktop: { questions: { rater_id: { questionWidth: 800 } } } } };
  localStorage.setItem('survey_draft_layout_restart_existing', JSON.stringify({
    participantId: 'existing', surveyData: { rater_id: 'Previous answer' }, currentPageNo: 0,
    finalSurveyJson: snapshot, savedAt: Date.now(),
  }));
}

test('Start fresh loads the latest layout as well as the new model after a saved-session prompt', async () => {
  seedDraft();
  render(<SurveyApp />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Start fresh' }));
  await screen.findByRole('textbox', { name: 'Rater ID' });
  await waitFor(() => expect(document.querySelector('[data-sp-viewport-layout]')).toHaveAttribute('data-sp-content-width', '1078'));
  expect(document.querySelector('[data-sp-layout-question]').style.getPropertyValue('--sp-question-width')).toBe('648px');
  expect(screen.getByRole('textbox', { name: 'Rater ID' })).toHaveValue('');
});

test('Resume keeps the original session layout and answers rather than starting a new response', async () => {
  seedDraft();
  render(<SurveyApp />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Resume', exact: true }));
  const input = await screen.findByRole('textbox', { name: 'Rater ID' });
  expect(input).toHaveValue('Previous answer');
  await waitFor(() => expect(document.querySelector('[data-sp-layout-question]').style.getPropertyValue('--sp-question-width')).toBe('800px'));
});
