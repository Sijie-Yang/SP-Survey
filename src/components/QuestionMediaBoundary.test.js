import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import QuestionMediaBoundary, { questionMediaFailed } from './QuestionMediaBoundary';

const event = () => { const handlers = new Set(); return { add: (f) => handlers.add(f), remove: (f) => handlers.delete(f), fire: (v) => handlers.forEach((f) => f(null, v)) }; };
function fixture() {
  const survey = { locale: 'zh-cn', currentPage: {}, onValidateQuestion: event(), onCurrentPageChanging: event(), onCompleting: event() };
  return { survey, page: survey.currentPage };
}
test('failed stimulus blocks forward/submit until retry loads the same URL; back remains available', () => {
  const question = fixture();
  const url = '/sample.jpg?signature=example';
  const { unmount } = render(<QuestionMediaBoundary question={question}><img src={url} alt="Stimulus" /></QuestionMediaBoundary>);
  const img = screen.getByAltText('Stimulus');
  fireEvent.error(img);
  expect(questionMediaFailed(question)).toBe(true);
  const next = { allow: true }; question.survey.onCurrentPageChanging.fire(next); expect(next.allow).toBe(false);
  const back = { allow: true, isPrevPage: true }; question.survey.onCurrentPageChanging.fire(back); expect(back.allow).toBe(true);
  const complete = { allow: true }; question.survey.onCompleting.fire(complete); expect(complete.allow).toBe(false);
  const validation = { question }; question.survey.onValidateQuestion.fire(validation); expect(validation.error).toContain('媒体加载失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(img.getAttribute('src')).toBe(url);
  expect(questionMediaFailed(question)).toBe(true);
  Object.defineProperty(img, 'naturalWidth', { value: 100 });
  fireEvent.load(img);
  expect(questionMediaFailed(question)).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  const ready = { allow: true }; question.survey.onCompleting.fire(ready); expect(ready.allow).toBe(true);
  unmount(); expect(questionMediaFailed(question)).toBe(false);
});
test('audio retries without replacing stimulus, and changing a trial removes stale failures', async () => {
  const question = fixture();
  const { container, rerender } = render(<QuestionMediaBoundary question={question}><audio src="/a.mp3" controls /></QuestionMediaBoundary>);
  const audio = container.querySelector('audio'); audio.load = jest.fn();
  fireEvent.error(audio);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(audio.load).toHaveBeenCalledTimes(1);
  await act(async () => rerender(<QuestionMediaBoundary question={question}><img src="/b.jpg" alt="New stimulus" /></QuestionMediaBoundary>));
  expect(questionMediaFailed(question)).toBe(false);
});
