// The "Balanced" sampling mode in the live participant page: one number from the
// server per participant, the images that number stands for, and the record kept.
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SurveyApp from './SurveyApp';
import { createBalancePlan } from './lib/balancedDraw';
import { balanceGroupsForSurvey, getImageKey } from './lib/surveyMediaInjection';
import { makePool } from './lib/__fixtures__/mediaPool';

const mockPool = makePool(Array.from({ length: 12 }, (_, i) => ({ name: `street_${String(i).padStart(2, '0')}.jpg`, folder: 'streets' })));
let mockSampling = 'balanced';
const mockSurvey = () => ({
  title: 'Street study',
  showProgressBar: 'off',
  pages: [{
    name: 'p1',
    elements: [
      { type: 'text', name: 'feel', title: 'How do you feel' },
      { type: 'imagepicker', name: 'safe', title: 'Which street looks safer', randomImageSelection: true, imageCount: 2, pairingMode: mockSampling },
    ],
  }],
});

jest.mock('./lib/projectManager', () => ({
  getParticipantProject: async (id) => ({ id, _surveyConfig: mockSurvey(), preloadedImages: mockPool }),
  resolveSurveySlug: async () => null,
}));
jest.mock('./lib/supabase', () => ({
  isSupabaseConfigured: () => false,
  saveSurveyResponse: jest.fn(async () => ({ success: true, data: { id: 'r1' }, storage: 'supabase' })),
}));
jest.mock('./lib/surveyPublicApi', () => ({
  claimBalanceNumber: jest.fn(async () => null),
  completeBalanceClaim: jest.fn(async () => true),
  countProjectResponses: async () => 0,
  fetchConditionCounts: async () => null,
}));

const { saveSurveyResponse } = jest.requireMock('./lib/supabase');
const publicApi = jest.requireMock('./lib/surveyPublicApi');

/** The two images participant `number` must get, worked out without the page. */
function expectedKeys(number) {
  const groups = balanceGroupsForSurvey(mockSurvey(), mockPool, {});
  return createBalancePlan(groups, { number, seed: 'streets' }).take('safe', 2).sort();
}

// Responses store the shown images as URLs; map them back to library keys.
const shownKeys = (saved) => (saved.displayed_images.safe || [])
  .map((url) => getImageKey(mockPool.find((img) => img.url === url)))
  .sort();

async function answerAndSubmit() {
  const box = await screen.findByRole('textbox', { name: 'How do you feel' });
  fireEvent.change(box, { target: { value: 'calm' } });
  fireEvent.blur(box);
  fireEvent.click(screen.getByRole('button', { name: /complete/i }));
  await waitFor(() => expect(saveSurveyResponse).toHaveBeenCalledTimes(1));
  return saveSurveyResponse.mock.calls[0][0];
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockSampling = 'balanced';
  saveSurveyResponse.mockReset().mockResolvedValue({ success: true, data: { id: 'r1' }, storage: 'supabase' });
  publicApi.claimBalanceNumber.mockReset().mockResolvedValue(null);
  publicApi.completeBalanceClaim.mockReset().mockResolvedValue(true);
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
  window.history.replaceState({}, '', '/survey?project=streets');
});

test('a balanced question: the participant gets the images of the number the server handed out, and the response records it', async () => {
  publicApi.claimBalanceNumber.mockResolvedValue({ n: 7, claimId: 'claim-7' });
  render(<SurveyApp />);
  const saved = await answerAndSubmit();
  expect(publicApi.claimBalanceNumber).toHaveBeenCalledTimes(1);
  expect(publicApi.claimBalanceNumber).toHaveBeenCalledWith('streets');
  expect(shownKeys(saved)).toEqual(expectedKeys(7));
  expect(saved.survey_metadata.balanced_draw).toEqual({ n: 7, claim: 'server', claim_id: 'claim-7' });
  await waitFor(() => expect(publicApi.completeBalanceClaim).toHaveBeenCalledWith('claim-7'));
});

test('a reload before finishing keeps the same number and the same images; after finishing the next visit asks for a new one', async () => {
  publicApi.claimBalanceNumber.mockResolvedValue({ n: 3, claimId: 'claim-3' });
  const { unmount: leave } = render(<SurveyApp />);
  await screen.findByRole('textbox', { name: 'How do you feel' });
  leave();

  publicApi.claimBalanceNumber.mockResolvedValue({ n: 4, claimId: 'claim-4' });
  const { unmount: finish } = render(<SurveyApp />);
  const saved = await answerAndSubmit();
  expect(publicApi.claimBalanceNumber).toHaveBeenCalledTimes(1);
  expect(shownKeys(saved)).toEqual(expectedKeys(3));
  expect(saved.survey_metadata.balanced_draw).toMatchObject({ n: 3, claim: 'server', claim_id: 'claim-3' });
  finish();

  render(<SurveyApp />);
  await screen.findByRole('textbox', { name: 'How do you feel' });
  expect(publicApi.claimBalanceNumber).toHaveBeenCalledTimes(2);
});

test('when the server cannot hand out a number the survey still runs, and the response says the draw was local', async () => {
  publicApi.claimBalanceNumber.mockResolvedValue(null);
  render(<SurveyApp />);
  const saved = await answerAndSubmit();
  const draw = saved.survey_metadata.balanced_draw;
  expect(draw.claim).toBe('local');
  expect(draw.claim_id).toBeNull();
  expect(shownKeys(saved)).toEqual(expectedKeys(draw.n));
  expect(publicApi.completeBalanceClaim).not.toHaveBeenCalled();
});

test('a survey with no balanced question never asks the server for a number', async () => {
  mockSampling = 'random';
  render(<SurveyApp />);
  const saved = await answerAndSubmit();
  expect(publicApi.claimBalanceNumber).not.toHaveBeenCalled();
  expect(saved.survey_metadata.balanced_draw).toBeUndefined();
  expect(shownKeys(saved)).toHaveLength(2);
});
