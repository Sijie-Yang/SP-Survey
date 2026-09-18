import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Model } from 'survey-core';
import TrialShell, { nextIncompletePageQuestion } from './TrialShell';
import { clearTrialsAnswerStore, getTrialsAnswer } from '../lib/trialNavigation';

jest.mock('../lib/surveyMediaInjection', () => ({
  applyMediaToElement: jest.fn(),
  getRememberedInjectedMedia: () => null,
  rememberInjectedMedia: jest.fn(),
  resolveQuestionMediaItems: () => [],
}));
jest.mock('../lib/questionImageChoices', () => ({ resolveQuestionImageChoices: () => [] }));

function Input({ question }) {
  return <button onClick={() => { question.value = 'a'; }}>Choose A</button>;
}

function setup({ name = 'choice', count = 2, preview = 'no', mode = 'edit', locale = 'en' } = {}) {
  const survey = new Model({
    locale, mode, showPreviewBeforeComplete: preview,
    elements: [{ type: 'imagepicker', name, choices: ['a', 'b'] }],
  });
  const question = survey.getQuestionByName(name);
  question.trialCount = count;
  const view = render(<div className="sd-root-modern"><TrialShell question={question} Inner={Input} /></div>);
  act(() => jest.advanceTimersByTime(60));
  return { survey, question, ...view };
}

beforeEach(() => { jest.useFakeTimers(); clearTrialsAnswerStore(); });
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

test('updates counts and auto-advances once after a choice', () => {
  const { question } = setup();
  fireEvent.click(screen.getByText('Choose A'));
  expect(screen.getByText('Completed 1 / 2. 1 remaining.')).toBeTruthy();
  act(() => jest.advanceTimersByTime(500));
  expect(screen.getByText('You will do this 2 times. This is 2 of 2.')).toBeTruthy();
  act(() => jest.advanceTimersByTime(60));
  fireEvent.click(screen.getByText('Choose A'));
  expect(screen.getByText('All 2 rounds answered.')).toBeTruthy();
  expect(getTrialsAnswer(question).trials.map(t => t.value)).toEqual(['a', 'a']);
});

test('cancels pending advancement when an answer is cleared', () => {
  const { question } = setup();
  fireEvent.click(screen.getByText('Choose A'));
  act(() => { question.clearValue(); jest.advanceTimersByTime(600); });
  expect(screen.getByText('You will do this 2 times. This is 1 of 2.')).toBeTruthy();
  expect(screen.getByText('Completed 0 / 2. 2 remaining.')).toBeTruthy();
});

test('manual navigation cancels an old timer even when returning to the same round', () => {
  setup({ count: 3 });
  fireEvent.click(screen.getByText('Choose A'));
  fireEvent.click(screen.getByText('Next round'));
  fireEvent.click(screen.getByText('Back'));
  act(() => jest.advanceTimersByTime(600));
  expect(screen.getByText('You will do this 3 times. This is 1 of 3.')).toBeTruthy();
});

test('blocks final submission and preview with unfinished optional trials', () => {
  const { survey } = setup({ preview: 'showAllQuestions' });
  fireEvent.click(screen.getByText('Choose A'));
  act(() => { survey.completeLastPage(); });
  expect(survey.state).not.toBe('completed');
  act(() => { survey.showPreview(); });
  expect(survey.state).not.toBe('preview');
});

test('green final action honors answer preview and uses survey language', () => {
  const { survey } = setup({ preview: 'showAllQuestions', locale: 'zh-cn' });
  fireEvent.click(screen.getByText('Choose A'));
  act(() => jest.advanceTimersByTime(560));
  act(() => jest.advanceTimersByTime(60));
  fireEvent.click(screen.getByText('Choose A'));
  fireEvent.click(screen.getByText('检查答案'));
  expect(survey.state).toBe('preview');
});

test('navigation hiding is scoped to each mounted survey and cleans up', () => {
  const first = setup();
  const second = setup({ name: 'other', mode: 'display' });
  expect(first.container.firstChild.classList.contains('sp-trials-incomplete')).toBe(true);
  expect(second.container.firstChild.classList.contains('sp-trials-incomplete')).toBe(false);
  const root = first.container.firstChild;
  first.unmount();
  expect(root.classList.contains('sp-trials-incomplete')).toBe(false);
});

test('allows submission after every round is answered', () => {
  const { survey, container } = setup();
  fireEvent.click(screen.getByText('Choose A'));
  act(() => jest.advanceTimersByTime(560));
  act(() => jest.advanceTimersByTime(60));
  fireEvent.click(screen.getByText('Choose A'));
  expect(container.firstChild.classList.contains('sp-trials-incomplete')).toBe(false);
  fireEvent.click(screen.getByText('Finish survey'));
  expect(survey.state).toBe('completed');
});

test('completed trial question locates remaining required work on the same page', () => {
  const {survey, question} = setup();
  const other = survey.currentPage.addNewQuestion('text', 'remaining');
  other.isRequired = true;
  expect(nextIncompletePageQuestion(survey, question)).toBe(other);
  act(() => { other.value = 'answered'; });
  expect(nextIncompletePageQuestion(survey, question)).toBeUndefined();
});
