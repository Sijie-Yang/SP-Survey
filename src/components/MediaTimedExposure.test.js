import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MediaTimedExposure } from './MediaWidgets';

beforeEach(() => jest.useFakeTimers('modern'));
afterEach(() => jest.useRealTimers());
test('loading time is excluded and a new stimulus resets the viewing session', () => {
  const { container, rerender } = render(<MediaTimedExposure url="/slow.jpg" exposureSeconds={2} language="zh" />);
  expect(screen.getByRole('button', { name: '准备好了，开始展示' })).toBeDisabled();
  act(() => jest.advanceTimersByTime(10000));
  expect(screen.queryByText(/展示结束/)).toBeNull();
  fireEvent.load(container.querySelector('img'));
  fireEvent.click(screen.getByRole('button', { name: '准备好了，开始展示' }));
  act(() => jest.advanceTimersByTime(2100));
  expect(screen.getByText(/展示结束/)).toBeTruthy();
  rerender(<MediaTimedExposure url="/next.jpg" exposureSeconds={2} language="zh" />);
  expect(screen.getByRole('button', { name: '准备好了，开始展示' })).toBeDisabled();
});
test('failed media can be retried without consuming the viewing window', () => {
  const { container } = render(<MediaTimedExposure url="/retry.jpg" exposureSeconds={2} />);
  const old = container.querySelector('img');
  fireEvent.error(old);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect(container.querySelector('img')).not.toBe(old);
  fireEvent.load(container.querySelector('img'));
  expect(screen.getByRole('button', { name: "I'm ready — show it" })).toBeEnabled();
});
