import React from 'react';
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Survey } from 'survey-react-ui';
import { createQuestionPreviewModel } from './QuestionPreviewPage';
import { buildSingleQuestionSurvey } from '../../lib/singleQuestionSurvey';
import { NO_PREFERENCE } from '../../lib/choiceTie';
import { getTrialsAnswer, persistTrialsAnswer } from '../../lib/trialNavigation';

test('isolated runtime preserves media, language and optional ties, and resets stale answers', () => {
  const { surveyJson } = buildSingleQuestionSurvey({ question: { type: 'imagepicker', name: 'q', imageCount: 2, allowTie: true, tieLabel: '一样', trialCount: 2, isRequired: true }, projectImages: [{ url: '/a.jpg' }, { url: '/b.jpg' }] });
  const payload = { surveyJson, appearance: { locale: 'zh' } };
  const model = createQuestionPreviewModel(payload);
  const q = model.getQuestionByName('q');
  expect(model.locale).toBe('zh-cn');
  expect(q.choices.map((c) => c.imageLink)).toEqual(['/a.jpg', '/b.jpg']);
  q.value = NO_PREFERENCE;
  expect(q.value).toBe(NO_PREFERENCE);
  expect(q.tieLabel).toBe('一样');
  persistTrialsAnswer(q, { trials: [{ value: NO_PREFERENCE }] });
  const fresh = createQuestionPreviewModel(payload);
  expect(fresh.getQuestionByName('q').value).toBeUndefined();
  expect(getTrialsAnswer(fresh.getQuestionByName('q'))).toBeFalsy();
  model.dispose(); fresh.dispose();
});

test.each(['imagepicker', 'mediapicker'])('%s preview changes images on Next round and restores them on Back', (type) => {
  jest.useFakeTimers();
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const { surveyJson, shownImagesByTrial } = buildSingleQuestionSurvey({
    question: { type, name: 'random_pair', title: 'Choose', imageCount: 2, trialCount: 2 },
    projectImages: ['a', 'b', 'c', 'd'].map(name => ({ url: `/${name}.jpg`, name, type: 'image' })),
    randomMedia: true,
  });
  const model = createQuestionPreviewModel({ surveyJson, appearance: { locale: 'en' } });
  try {
    render(<Survey model={model} />);
    act(() => jest.advanceTimersByTime(60));
    const visibleUrls = () => screen.getAllByRole('img').filter(img => img.tagName === 'IMG').map(img => img.getAttribute('src'));
    expect(visibleUrls()).toEqual(shownImagesByTrial[0]);
    if (type === 'imagepicker') fireEvent.click(screen.getAllByRole('radio').find(el => el.tagName === 'INPUT'));
    else fireEvent.click(screen.getAllByRole('button', { name: /^Select · / })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Next round' }));
    act(() => jest.advanceTimersByTime(60));
    expect(visibleUrls()).toEqual(shownImagesByTrial[1]);
    expect(visibleUrls().some(url => shownImagesByTrial[0].includes(url))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    act(() => jest.advanceTimersByTime(60));
    expect(visibleUrls()).toEqual(shownImagesByTrial[0]);
    expect(getTrialsAnswer(model.getQuestionByName('random_pair')).trials[0].value).toBeTruthy();
  } finally {
    cleanup(); model.dispose(); jest.clearAllTimers(); jest.useRealTimers();
  }
});

test.each([['zh', '本次试答已完成'], ['en', 'Preview complete']])('completed %s previews show a restart hint and a new model clears answers', (locale, title) => {
  const { surveyJson } = buildSingleQuestionSurvey({ question: { type: 'text', name: 'answer', title: 'Try answering' } });
  const payload = { surveyJson, appearance: { locale } };
  const model = createQuestionPreviewModel(payload);
  const view = render(<Survey model={model} />);
  act(() => { model.setValue('answer', 'preview only'); model.completeLastPage(); });
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(model.state).toBe('completed');
  const restarted = createQuestionPreviewModel(payload);
  view.rerender(<Survey model={restarted} />);
  expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(restarted.state).toBe('running');
  view.unmount(); model.dispose(); restarted.dispose();
});
