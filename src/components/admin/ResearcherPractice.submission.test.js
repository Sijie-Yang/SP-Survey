import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResearcherPractice from './ResearcherPractice';
import { RegionProvider } from '../../contexts/RegionContext';
import { saveSurveyResponse } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({ supabase: null, saveSurveyResponse: jest.fn() }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'researcher' } }) }));
jest.mock('../SurveyCustomComponents', () => ({ __esModule: true, default: jest.fn(),
  registerImageRatingWidget: jest.fn(), registerImageBooleanWidget: jest.fn(), registerAllExtendedWidgets: jest.fn() }));
jest.mock('../../lib/previewMediaLibrary', () => ({ resolveMediaPoolForPreview: async (pool) => pool }));
jest.mock('../../lib/surveyMediaInjection', () => ({ ...jest.requireActual('../../lib/surveyMediaInjection'), resolveSkillQuestions: async () => {}, syncInjectedMediaOntoSurveyModel: () => {} }));
jest.mock('./ResultsAnalysis', () => ({ buildQuestionCardProps: () => null, QuestionCard: () => null }));
jest.mock('./QuestionEditor', () => () => null);
jest.mock('survey-react-ui', () => ({ Survey: ({ model }) => <button disabled={model.mode === 'display'} onClick={() => { model.data = { q: 4 }; }}>Answer 4</button> }));

const config = { pages: [{ name: 'page', elements: [{ name: 'q', type: 'rating', title: 'Comfort', isRequired: true }] }] };
const project = { id: 'practice-project', preloadedImages: [] };
const mount = () => render(<RegionProvider><ResearcherPractice currentProject={project} surveyConfig={config} /></RegionProvider>);
const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeAll(() => { HTMLElement.prototype.scrollIntoView = jest.fn(); });
afterAll(() => { HTMLElement.prototype.scrollIntoView = originalScroll; });

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); jest.clearAllMocks();
  sessionStorage.setItem('researcher_practice_ui', JSON.stringify({ [project.id]: { selectedName: 'q' } }));
  // Match the database's required submission fields instead of accepting arbitrary requests.
  saveSurveyResponse.mockImplementation(async (payload) => {
    if (!payload.project_id || !payload.participant_id || !payload.survey_metadata?.completion_code
      || !payload.responses || Array.isArray(payload.responses)) {
      return { success: false, error: new Error('Invalid submission') };
    }
    return { success: true, data: { id: 'saved' } };
  });
});

test('free practice sends a valid completion key and gives each new attempt a different key', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Answer 4' }, { timeout: 5000 }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
  await waitFor(() => expect(saveSurveyResponse).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Answer 4' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Answer 4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
  await waitFor(() => expect(saveSurveyResponse).toHaveBeenCalledTimes(2));
  const [first, second] = saveSurveyResponse.mock.calls.map(([data]) => data);
  expect(first).toMatchObject({ project_id: project.id, survey_metadata: { practice_mode: true, practice_question: 'q' } });
  expect(first.survey_metadata.survey_revision).toMatch(/^(sha256:|contract-v1:)/);
  expect(first.survey_metadata.survey_response_contract.questions).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'q', type: 'rating' })]),
  );
  expect(first.survey_metadata.completion_code).toMatch(/^practice_/);
  expect(second.survey_metadata.completion_code).not.toBe(first.survey_metadata.completion_code);
  expect(screen.queryByText('Invalid submission')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Answer 4' }).disabled).toBe(false));
});

test('an uncertain failure retains exact answers and identity for retry', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  saveSurveyResponse.mockResolvedValueOnce({ success: false, error: new Error('Connection interrupted') });
  try {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Answer 4' }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
    const retry = await screen.findByRole('button', { name: 'Retry submission' });
    expect(screen.getByRole('button', { name: 'Answer 4' }).disabled).toBe(true);
    const first = JSON.parse(JSON.stringify(saveSurveyResponse.mock.calls[0][0]));
    fireEvent.click(retry);
    await waitFor(() => expect(saveSurveyResponse).toHaveBeenCalledTimes(2));
    expect(saveSurveyResponse.mock.calls[1][0]).toEqual(first);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Answer 4' }).disabled).toBe(false));
  } finally { log.mockRestore(); }
});

test('session attempts share participant identity but never the submission key', async () => {
  sessionStorage.setItem('researcher_practice_sessions', JSON.stringify({ [project.id]: {
    active: true, sessionId: 'session', participantId: 'session-participant', questionNames: ['q'],
    paceMode: 'block', repeats: 3, queueIndex: 0, attemptInQuestion: 1, roundIndex: 1, totalSaved: 0,
  } }));
  mount();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Answer 4' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Answer 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit & Next' }));
    await waitFor(() => expect(saveSurveyResponse).toHaveBeenCalledTimes(attempt));
  }
  const [first, second] = saveSurveyResponse.mock.calls.map(([data]) => data);
  expect(first.participant_id).toBe('session-participant');
  expect(second.participant_id).toBe(first.participant_id);
  expect(second.survey_metadata.completion_code).not.toBe(first.survey_metadata.completion_code);
  expect(second.survey_metadata.attempt_index).toBe(2);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Answer 4' }).disabled).toBe(false));
});
