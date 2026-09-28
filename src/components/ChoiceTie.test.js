import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import { registerImagePickerTrialSupport, registerMediaPickerWidget, registerMediaPairingProps, registerSkillQuestionWidget } from './SurveyCustomComponents';
import { MediaPickerContent } from './MediaWidgets';
import ForcedChoiceWithTie from './ForcedChoiceWithTie';
import { NO_PREFERENCE } from '../lib/choiceTie';
import { getTrialsAnswer } from '../lib/trialNavigation';

beforeAll(() => { window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };  registerMediaPairingProps(); registerImagePickerTrialSupport(); registerMediaPickerWidget(); registerSkillQuestionWidget(); });
const choices = [{ value: 'image_0', imageLink: '/a.jpg', text: 'A' }, { value: 'image_1', imageLink: '/b.jpg', text: 'B' }];
function surveyModel(extra = {}) {
  return new Model({ locale: 'zh-cn', elements: [{ type: 'imagepicker', name: 'pair', title: 'Pair', isRequired: true, allowTie: true, choices, ...extra }] });
}
test('image choice records a valid exclusive tie, survives cleanup, and can be changed to A', () => {
  const survey = surveyModel({ tieLabel: '一样舒适' });
  const q = survey.getQuestionByName('pair');
  render(<Survey model={survey} />);
  expect(screen.getAllByRole('radio').filter((el) => el.tagName === 'INPUT')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '一样舒适' }));
  expect(q.value).toBe(NO_PREFERENCE);
  act(() => q.clearIncorrectValues());
  expect(q.value).toBe(NO_PREFERENCE);
  expect(q.validate()).toBe(true);
  expect(q.displayValue).toBe('一样舒适');
  expect(screen.getByRole('button', { name: '一样舒适' })).toHaveAttribute('aria-pressed', 'true');
  act(() => { q.value = 'image_0'; });
  expect(q.value).toBe('image_0');
  expect(screen.getByRole('button', { name: '一样舒适' })).toHaveAttribute('aria-pressed', 'false');
  const restored = new Model(survey.toJSON());
  restored.data = { pair: NO_PREFERENCE };
  restored.clearIncorrectValues();
  expect(restored.getQuestionByName('pair').value).toBe(NO_PREFERENCE);
  expect(restored.getQuestionByName('pair').tieLabel).toBe('一样舒适');
});
test('two-round ties count as completed and advance exactly like a choice', () => {
  jest.useFakeTimers();
  const survey = surveyModel({ trialCount: 2, tieLabel: '一样', trialMediaSets: [[{ url: '/a.jpg' }, { url: '/b.jpg' }], [{ url: '/c.jpg' }, { url: '/d.jpg' }]] });
  const q = survey.getQuestionByName('pair');
  render(<Survey model={survey} />);
  act(() => jest.advanceTimersByTime(60));
  fireEvent.click(screen.getByRole('button', { name: '一样' }));
  act(() => jest.advanceTimersByTime(600));
  act(() => jest.advanceTimersByTime(60));
  fireEvent.click(screen.getByRole('button', { name: '一样' }));
  expect(getTrialsAnswer(q).trials.map((t) => t.value)).toEqual([NO_PREFERENCE, NO_PREFERENCE]);
  expect(q.isEmpty()).toBe(false);
  jest.useRealTimers();
});
test('media tie is localized, opt-in, exclusive and restricted to two single-select options', () => {
  const onChange = jest.fn();
  const props = { mediaItems: [{ url: '/a.mp4', type: 'video' }, { url: '/b.mp4', type: 'video' }], onChange, language: 'zh' };
  const { rerender } = render(<MediaPickerContent {...props} />);
  expect(screen.queryByText('两者差不多')).not.toBeInTheDocument();
  rerender(<MediaPickerContent {...props} allowTie />);
  fireEvent.click(screen.getByRole('button', { name: '两者差不多' }));
  expect(onChange).toHaveBeenCalledWith(NO_PREFERENCE);
  rerender(<MediaPickerContent {...props} allowTie multiSelect />);
  expect(screen.queryByText('两者差不多')).not.toBeInTheDocument();
  rerender(<MediaPickerContent {...props} allowTie mediaItems={[...props.mediaItems, { url: '/c.mp4' }]} />);
  expect(screen.queryByText('两者差不多')).not.toBeInTheDocument();
});
test('built-in A/B tie carries both identities, has no winning URL, and can be revised', () => {
  const survey = new Model({ elements: [{ type: 'skillquestion', name: 'q', allowTie: true }] });
  const question = survey.getQuestionByName('q');
  const images = [{ url: '/a.jpg' }, { url: '/b.jpg' }];
  render(<ForcedChoiceWithTie question={question} config={{}} images={images} language="en" />);
  fireEvent.click(screen.getByRole('button', { name: 'About the same' }));
  expect(question.value).toEqual({ choice: 'tie', chosenIndex: -1, imageA: '/a.jpg', imageB: '/b.jpg' });
  expect(question.isEmpty()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Select · B' }));
  expect(question.value).toMatchObject({ choice: 'B', chosenIndex: 1, chosenUrl: '/b.jpg' });
});
