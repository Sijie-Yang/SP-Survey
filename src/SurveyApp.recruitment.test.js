import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SurveyApp from './SurveyApp';

let mockConfig = {};
jest.mock('./lib/projectManager', () => ({
  getParticipantProject: async (id) => ({
    id,
    _surveyConfig: {
      title: 'Park study',
      showProgressBar: 'off',
      pages: [{ name: 'p1', elements: [{ type: 'text', name: 'feel', title: 'How do you feel' }] }],
      ...mockConfig,
    },
    preloadedImages: [],
  }),
  resolveSurveySlug: async () => null,
}));
jest.mock('./lib/supabase', () => ({
  isSupabaseConfigured: () => false,
  saveSurveyResponse: jest.fn(async (data) => ({ success: true, data: { id: 'r1' }, storage: 'supabase' })),
}));
jest.mock('./lib/surveyPublicApi', () => ({
  claimBalanceNumber: async () => null,
  completeBalanceClaim: async () => false,
  countProjectResponses: jest.fn(async () => 0),
  fetchConditionCounts: async () => null,
  recruitmentParticipantDone: jest.fn(async () => false),
}));

const { saveSurveyResponse } = jest.requireMock('./lib/supabase');
const publicApi = jest.requireMock('./lib/surveyPublicApi');
const PROLIFIC = { recruitment: { platform: 'prolific', completionCode: 'C1ABC', quotaFullCode: 'FULL1' } };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  saveSurveyResponse.mockReset().mockResolvedValue({ success: true, data: { id: 'r1' }, storage: 'supabase' });
  publicApi.recruitmentParticipantDone.mockReset().mockResolvedValue(false);
  publicApi.countProjectResponses.mockReset().mockResolvedValue(0);
  mockConfig = {};
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
});

async function answerAndSubmit() {
  const box = await screen.findByRole('textbox', { name: 'How do you feel' });
  fireEvent.change(box, { target: { value: 'calm' } });
  fireEvent.blur(box);
  fireEvent.click(screen.getByRole('button', { name: /complete/i }));
  await waitFor(() => expect(saveSurveyResponse).toHaveBeenCalledTimes(1));
  return saveSurveyResponse.mock.calls[0][0];
}

test('Prolific participant: answers are saved with the platform id, then sent back with the code', async () => {
  mockConfig = PROLIFIC;
  window.history.replaceState({}, '', '/survey?project=park&PROLIFIC_PID=5f1a&STUDY_ID=st9&SESSION_ID=se3');
  render(<SurveyApp />);
  const saved = await answerAndSubmit();
  expect(saved.survey_metadata.recruitment).toEqual({ platform: 'prolific', id: '5f1a', study: 'st9', session: 'se3', outcome: 'complete' });
  expect(publicApi.recruitmentParticipantDone).toHaveBeenCalledWith('park', 'prolific', '5f1a');
  const back = await screen.findByRole('link', { name: /Return to Prolific now/ });
  expect(back).toHaveAttribute('href', 'https://app.prolific.com/submissions/complete?cc=C1ABC');
  expect(screen.getByTestId('recruitment-code')).toHaveTextContent('C1ABC');
  expect(screen.getByText(/Returning you to Prolific in/)).toBeInTheDocument();
});

test('the same Prolific id opening the link again is not asked to answer again', async () => {
  mockConfig = PROLIFIC;
  publicApi.recruitmentParticipantDone.mockResolvedValue(true);
  window.history.replaceState({}, '', '/survey?project=park&PROLIFIC_PID=5f1a');
  render(<SurveyApp />);
  expect(await screen.findByText('You have already completed this survey.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText(/Returning you/)).not.toBeInTheDocument();
});

test('a reload in the same browser after finishing shows the done page without the server', async () => {
  mockConfig = PROLIFIC;
  window.history.replaceState({}, '', '/survey?project=park&PROLIFIC_PID=7a7a');
  const first = render(<SurveyApp />);
  await answerAndSubmit();
  first.unmount();
  publicApi.recruitmentParticipantDone.mockClear();
  render(<SurveyApp />);
  expect(await screen.findByText('You have already completed this survey.')).toBeInTheDocument();
  expect(publicApi.recruitmentParticipantDone).not.toHaveBeenCalled();
});

test('places full: a Prolific participant is sent back with the quota code', async () => {
  mockConfig = { ...PROLIFIC, responseQuota: 2 };
  publicApi.countProjectResponses.mockResolvedValue(2);
  window.history.replaceState({}, '', '/survey?project=park&PROLIFIC_PID=late1');
  render(<SurveyApp />);
  expect(await screen.findByText('This survey has reached its number of participants.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Return to Prolific now/ })).toHaveAttribute('href', 'https://app.prolific.com/submissions/complete?cc=FULL1');
});

test('the plain link (researcher testing) keeps the normal thank-you page and records no platform id', async () => {
  mockConfig = PROLIFIC;
  window.history.replaceState({}, '', '/survey?project=park');
  render(<SurveyApp />);
  const saved = await answerAndSubmit();
  expect(saved.survey_metadata.recruitment).toBeUndefined();
  expect(publicApi.recruitmentParticipantDone).not.toHaveBeenCalled();
  expect(await screen.findByText('Thank you!')).toBeInTheDocument();
  expect(screen.queryByTestId('recruitment-return')).not.toBeInTheDocument();
});

test('other platform with {id}: the participant goes back to the pasted link', async () => {
  mockConfig = { recruitment: { platform: 'other', idParam: 'uid', returnUrl: 'https://panel.example.cn/done?u={id}' } };
  window.history.replaceState({}, '', '/survey?project=park&uid=u77');
  render(<SurveyApp />);
  const saved = await answerAndSubmit();
  expect(saved.survey_metadata.recruitment).toEqual({ platform: 'other', id: 'u77', outcome: 'complete' });
  expect(await screen.findByRole('link', { name: /Return to the recruitment platform now/ })).toHaveAttribute('href', 'https://panel.example.cn/done?u=u77');
});
