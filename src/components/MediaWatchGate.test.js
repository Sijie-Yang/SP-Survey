import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MediaWatchGate from './MediaWatchGate';
import { ShapeNoteField, withShapeNote } from './ImageAnnotationWidget';
import { SurveyJsRatingControl } from './ImageRatingWidget';
import { clearMediaWatchLog, getMediaWatchLog } from '../lib/mediaWatch';

const fakeQuestion = (extra = {}) => ({ name: 'clip', survey: { mode: 'edit', onCurrentPageChanging: { add() {}, remove() {} } }, ...extra });

beforeEach(() => { clearMediaWatchLog(); jest.useRealTimers(); });

test('inactive unless the question opts in', () => {
  const { container } = render(<MediaWatchGate question={fakeQuestion()}><button type="button">Answer</button></MediaWatchGate>);
  expect(container.querySelector('[data-watch-locked]')).toBeNull();
});

test('requireMediaEnded locks answers until the video ends and logs the watch', () => {
  const { container, unmount } = render(
    <MediaWatchGate question={fakeQuestion({ requireMediaEnded: true })} trialIndex={2}>
      <video src="https://example.org/a.mp4" />
      <button type="button">Answer</button>
    </MediaWatchGate>,
  );
  expect(container.querySelector('[data-watch-locked="true"]')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toMatch(/end/);
  act(() => { fireEvent(container.querySelector('video'), new Event('ended')); });
  expect(container.querySelector('[data-watch-locked="false"]')).toBeTruthy();
  unmount();
  const log = getMediaWatchLog().clip;
  expect(log[0].trial_index).toBe(2);
  expect(log[0].media[0]).toMatchObject({ url: 'https://example.org/a.mp4', ended: true });
});

test('minWatchSeconds unlocks after the delay; display mode never locks', () => {
  jest.useFakeTimers();
  const { container } = render(<MediaWatchGate question={fakeQuestion({ minWatchSeconds: 2 })}><span>x</span></MediaWatchGate>);
  expect(container.querySelector('[data-watch-locked="true"]')).toBeTruthy();
  act(() => { jest.advanceTimersByTime(2600); });
  expect(container.querySelector('[data-watch-locked="false"]')).toBeTruthy();
  const display = render(<MediaWatchGate question={{ ...fakeQuestion({ minWatchSeconds: 5 }), survey: { mode: 'display' } }}><span>y</span></MediaWatchGate>);
  expect(display.container.querySelector('[data-watch-locked]')).toBeNull();
});

test('annotation notes are stored on the shape and optional', () => {
  const shapes = [{ id: 's1', tool: 'point', points: [{ x: 0.5, y: 0.5 }], label: 'liked' }];
  const withNote = withShapeNote(shapes, 's1', '  shady trees  ');
  expect(withNote[0]).toEqual({ ...shapes[0], note: 'shady trees' });
  expect(withShapeNote(withNote, 's1', 'shady trees')).toBe(withNote);
  expect(withShapeNote(withNote, 's1', '')[0]).toEqual(shapes[0]);
  expect(withShapeNote(shapes, 'missing', 'x')).toBe(shapes);
  const onCommit = jest.fn();
  render(<ShapeNoteField prompt="Why do you like this place?" initial="" onCommit={onCommit} />);
  const input = screen.getByTestId('annotation-note');
  fireEvent.change(input, { target: { value: 'quiet' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith('quiet');
  expect(screen.getByLabelText('Why do you like this place?')).toBeTruthy();
});

test('rateLabels render one label per scale point and store the number', () => {
  const onChange = jest.fn();
  render(<SurveyJsRatingControl rateMin={1} rateMax={3} rateLabels={['Low', 'Mid', 'High']} onChange={onChange} />);
  fireEvent.click(screen.getByText('Mid'));
  expect(onChange).toHaveBeenCalledWith(2);
});
