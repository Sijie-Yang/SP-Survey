import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AdminIntroduction from './AdminIntroduction';
import { RegionProvider, i18n } from '../../contexts/RegionContext';
import { adminI18n } from '../../contexts/adminI18n';
import { loadGuidePrefs, markGuideProgress } from '../../lib/adminGuide';

jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'researcher' } }) }));
jest.mock('../../lib/supabase', () => ({ supabase: null }));
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });

const emptyProject = { id: 'p-new', preloadedImages: [], publishedVersion: 0 };
const liveProject = { id: 'p-live', preloadedImages: [{ url: '/a.jpg' }], publishedVersion: 3 };
const liveConfig = { pages: [{ elements: [{ type: 'rating', name: 'q1' }, { type: 'html', name: 'h' }] }] };

function setup(props = {}) {
  const handlers = {
    onGoToTab: jest.fn(),
    onOpenAssistant: jest.fn(),
    onOpenProjects: jest.fn(),
    onOpenPreview: jest.fn(),
    onOpenSilicon: jest.fn(),
  };
  render(
    <RegionProvider>
      <AdminIntroduction currentProject={emptyProject} surveyConfig={{ pages: [] }} siliconEnabled {...handlers} {...props} />
    </RegionProvider>,
  );
  return handlers;
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.setItem('sp-admin-guide:v1:researcher', JSON.stringify({ tourDone: true }));
});
afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
});

test('guide strings exist in both languages', () => {
  const guideKeys = Object.keys(adminI18n.en).filter((key) => key.startsWith('guide'));
  expect(guideKeys.length).toBeGreaterThan(50);
  guideKeys.forEach((key) => expect(adminI18n.zh[key]).toBeTruthy());
});

test('new project has one actionable checklist and optional workflow help', () => {
  // Self-hosted wording (Host tab) overrides the platform strings.
  const en = i18n.en;
  const handlers = setup();
  expect(screen.queryByText(en.guideQuickTitle)).not.toBeInTheDocument();
  expect(screen.getByText(en.guideChecklistTitle)).toBeInTheDocument();
  expect(screen.getByText('0 of 6 done')).toBeInTheDocument();
  expect(screen.queryByTestId('guide-step-media')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: en.guideStepsTitle }));
  expect(screen.getByText(en.guideMediaEmpty)).toBeInTheDocument();
  expect(screen.getByText(en.guideBuilderEmpty)).toBeInTheDocument();
  expect(screen.getByText(en.guideShareEmpty)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: en.resultsClose }));
  act(() => { jest.advanceTimersByTime(300); });
  fireEvent.click(screen.getByRole('button', { name: en.guideCheckQuestions }));
  expect(handlers.onGoToTab).toHaveBeenLastCalledWith(2);
  fireEvent.click(screen.getByRole('button', { name: en.guideCheckPreview }));
  expect(handlers.onOpenPreview).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: en.guideStepsTitle }));
  fireEvent.click(within(screen.getByTestId('guide-step-share')).getByRole('button', { name: `Open ${en.tabHost}` }));
  expect(handlers.onGoToTab).toHaveBeenCalledWith(3);
  act(() => { jest.advanceTimersByTime(300); });
  fireEvent.click(screen.getByRole('button', { name: en.guideStepsTitle }));
  fireEvent.click(within(screen.getByTestId('guide-step-share')).getByRole('button', { name: `Open ${en.tabShare}` }));
  expect(handlers.onGoToTab).toHaveBeenCalledWith(4);
  act(() => { jest.advanceTimersByTime(300); });
  fireEvent.click(screen.getByRole('button', { name: en.guideStepsTitle }));
  const mediaStep = within(screen.getByTestId('guide-step-media'));
  expect(mediaStep.getByText(/paste Google Street View URLs/)).toBeInTheDocument();
  fireEvent.click(mediaStep.getByRole('button', { name: 'Street-level imagery' }));
  expect(handlers.onGoToTab).toHaveBeenLastCalledWith(1);
  act(() => { jest.advanceTimersByTime(300); });
  fireEvent.click(screen.getByRole('button', { name: en.guideStepsTitle }));
  fireEvent.click(screen.getByRole('button', { name: `Open ${en.tabSilicon}` }));
  expect(handlers.onOpenSilicon).toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(300); });
  fireEvent.click(screen.getByRole('button', { name: en.guideAiTitle }));
  for (const mode of [en.aiSidebarModeAgent, en.aiSidebarModeGenerate, en.aiSidebarModeAdjust, en.aiSidebarModeQuestion]) {
    expect(screen.getByText(mode)).toBeInTheDocument();
  }
});

test('existing project tracks progress in the same checklist', () => {
  setup({ currentProject: liveProject, surveyConfig: liveConfig });
  expect(screen.queryByText(adminI18n.en.guideQuickTitle)).not.toBeInTheDocument();
  expect(screen.getByTestId('guide-check-media')).toHaveAttribute('data-done', 'true');
  expect(screen.getByTestId('guide-check-questions')).toHaveAttribute('data-done', 'true');
  expect(screen.getByTestId('guide-check-published')).toHaveAttribute('data-done', 'true');
  expect(screen.getByTestId('guide-check-shared')).toHaveAttribute('data-done', 'false');
  expect(screen.getByText(/Version 3 is live/)).toBeInTheDocument();

  act(() => markGuideProgress('p-live', 'shared'));
  expect(screen.getByTestId('guide-check-shared')).toHaveAttribute('data-done', 'true');
});

test('dismissals are remembered per user and restart brings the guide back', () => {
  const en = adminI18n.en;
  setup();
  fireEvent.click(screen.getByRole('button', { name: `${en.guideHide}: ${en.guideChecklistTitle}` }));
  expect(screen.queryByText(en.guideChecklistTitle)).not.toBeInTheDocument();
  expect(loadGuidePrefs('researcher').checklistHidden).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: en.guideRestart }));
  expect(screen.getByText(en.guideChecklistTitle)).toBeInTheDocument();
  expect(loadGuidePrefs('researcher').checklistHidden).toBeUndefined();
});

test('renders in Chinese and auto-starts the one-time tour for a first visit', () => {
  localStorage.setItem('sp-survey-language', 'zh');
  localStorage.removeItem('sp-admin-guide:v1:researcher');
  const zh = adminI18n.zh;
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 10, left: 10, width: 120, height: 32, right: 130, bottom: 42, x: 10, y: 10, toJSON: () => {},
  });
  setup();
  expect(screen.getByText(zh.guideTitle)).toBeInTheDocument();
  expect(screen.queryByText(zh.guideQuickTitle)).not.toBeInTheDocument();
  expect(screen.getByText(zh.guideChecklistTitle)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: zh.guideStepsTitle }));
  expect(within(screen.getByTestId('guide-step-media')).getByRole('button', { name: '街景影像' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: zh.resultsClose }));
  act(() => { jest.advanceTimersByTime(800); });
  expect(screen.getByRole('dialog', { name: zh.guideTourLabel })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: zh.guideTourSkip }));
  expect(loadGuidePrefs('researcher').tourDone).toBe(true);
});

describe('Review mode in the AI Assistant card', () => {
  afterEach(() => {
    delete process.env.REACT_APP_SUPABASE_URL;
  });

  // The platform-only Review cases (REACT_APP_SUPABASE_URL set) live in SP-Survey-Platform.
  test('stays hidden in the self-hosted build path', () => {
    localStorage.setItem('sp-review-settings:researcher', JSON.stringify({ enabled: true }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: adminI18n.en.guideAiTitle }));
    expect(screen.queryByText(adminI18n.en.guideAiReview)).not.toBeInTheDocument();
  });
});
