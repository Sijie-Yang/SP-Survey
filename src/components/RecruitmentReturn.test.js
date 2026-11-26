import React from 'react';
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import RecruitmentReturn from './RecruitmentReturn';

afterEach(() => jest.useRealTimers());

test('counts down 3 seconds, then sends the participant back', () => {
  jest.useFakeTimers();
  const redirect = jest.fn();
  render(<RecruitmentReturn outcome="complete" platform="prolific" code="C1ABC"
    returnUrl="https://app.prolific.com/submissions/complete?cc=C1ABC" redirect={redirect} />);
  expect(screen.getByText('Returning you to Prolific in 3 s…')).toBeInTheDocument();
  const tick = () => act(() => { jest.advanceTimersByTime(1000); });
  tick(); tick();
  expect(screen.getByText('Returning you to Prolific in 1 s…')).toBeInTheDocument();
  expect(redirect).not.toHaveBeenCalled();
  tick();
  expect(redirect).toHaveBeenCalledWith('https://app.prolific.com/submissions/complete?cc=C1ABC');
});

test('already completed: offers the way back but does not move on by itself', () => {
  jest.useFakeTimers();
  const redirect = jest.fn();
  render(<RecruitmentReturn outcome="already_done" platform="prolific" code="C1ABC"
    returnUrl="https://app.prolific.com/submissions/complete?cc=C1ABC" redirect={redirect} />);
  for (let i = 0; i < 10; i += 1) act(() => { jest.advanceTimersByTime(1000); });
  expect(redirect).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Return to Prolific now' })).toBeInTheDocument();
});

test('Chinese survey, no return link: shows a plain closing line', () => {
  render(<RecruitmentReturn outcome="quota_full" platform="other" locale={{ locale: 'zh-cn' }} />);
  expect(screen.getByText('这份问卷的名额已满。')).toBeInTheDocument();
  expect(screen.getByText('可以关闭本页了。')).toBeInTheDocument();
});
