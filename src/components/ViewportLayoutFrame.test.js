import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Survey } from 'survey-react-ui';
import { Model } from 'survey-core';
import ViewportLayoutFrame from './ViewportLayoutFrame';

beforeEach(() => {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280, writable: true });
});

test('participant rendering applies saved question overrides and clears them when switching device', async () => {
  const model = new Model({ pages: [{ name: 'p', elements: [{ type: 'text', name: 'q' }] }] });
  const originalWidth = model.width;
  const config = { viewportLayout: { desktop: { contentWidth: 1000, questionWidth: 800, mediaMaxHeight: 400, questions: { q: { questionWidth: 560, mediaMaxHeight: 220, mediaWidth: 70 } } }, mobile: { contentWidth: 320, questionWidth: 280, mediaMaxHeight: 160 } } };
  const { container, unmount, rerender } = render(<ViewportLayoutFrame config={config} surveyModel={model}><Survey model={model} /></ViewportLayoutFrame>);
  const root = () => model.getQuestionByName('q').react.rootRef.current;
  await waitFor(() => expect(root().style.getPropertyValue('--sp-question-width')).toBe('560px'));
  expect(root()).toHaveAttribute('data-sp-layout-question');
  expect(root()).toHaveAttribute('data-sp-media-max-height', '220');
  expect(root().style.getPropertyValue('--sp-media-width')).toBe('70%');
  expect(container.querySelector('[data-sp-resize]')).toBeNull();
  act(() => { window.innerWidth = 390; window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(root().style.getPropertyValue('--sp-question-width')).toBe('280px'));
  expect(root()).toHaveAttribute('data-sp-media-max-height', '160');
  expect(root().style.getPropertyValue('--sp-media-width')).toBe('100%');
  expect(model.width).toBe('320px');
  rerender(<ViewportLayoutFrame config={{ viewportLayout: { desktop: config.viewportLayout.desktop } }} surveyModel={model}><Survey model={model} /></ViewportLayoutFrame>);
  expect(model.width).toBe(originalWidth);
  expect(root()).not.toHaveAttribute('data-sp-layout-question');
  expect(root()).not.toHaveAttribute('data-sp-media-max-height');
  unmount(); model.dispose();
});

test('participant typography switches devices and removes overrides when reset', async () => {
  const model = new Model({ pages: [{ name: 'p', elements: [{ type: 'text', name: 'q' }, { type: 'text', name: 'other' }] }] });
  const config = { viewportLayout: { mobile: { typography: { questionTitleSize: 18, descriptionSize: 15, answerSize: 17, lineHeight: 1.8 }, questions: { q: { typography: { questionTitleSize: 20 } } } } } };
  const { rerender, unmount } = render(<ViewportLayoutFrame config={config} surveyModel={model}><Survey model={model} /></ViewportLayoutFrame>);
  const root = (name = 'q') => model.getQuestionByName(name).react.rootRef.current;
  expect(root().style.getPropertyValue('--sjs-font-questiontitle-size')).toBe('');
  act(() => { window.innerWidth = 390; window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(root().style.getPropertyValue('--sjs-font-questiontitle-size')).toBe('20px'));
  expect(root('other').style.getPropertyValue('--sjs-font-questiontitle-size')).toBe('18px');
  expect(root().style.getPropertyValue('--sjs-font-editorfont-size')).toBe('17px');
  expect(root()).toHaveAttribute('data-sp-text-line-height');
  expect(root()).toHaveAttribute('data-sp-text-description-size');
  act(() => { window.innerWidth = 1280; window.dispatchEvent(new Event('resize')); });
  expect(root().style.getPropertyValue('--sjs-font-questiontitle-size')).toBe('');
  expect(root()).not.toHaveAttribute('data-sp-text-line-height');
  expect(root()).not.toHaveAttribute('data-sp-text-description-size');
  act(() => { window.innerWidth = 390; window.dispatchEvent(new Event('resize')); });
  rerender(<ViewportLayoutFrame config={{}} surveyModel={model}><Survey model={model} /></ViewportLayoutFrame>);
  expect(root().style.getPropertyValue('--sjs-font-editorfont-size')).toBe('');
  unmount(); model.dispose();
});
