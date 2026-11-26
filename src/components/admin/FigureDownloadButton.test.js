import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FigureDownloadButton from './FigureDownloadButton';
import { syntheticResponses, syntheticSurveyConfig } from '../../lib/__fixtures__/syntheticResults';
import { flattenQuestions } from '../../lib/quality';

const config = syntheticSurveyConfig({ images: 6 });
const questions = flattenQuestions(config);
const responses = syntheticResponses(20, { config });

test('a single figure downloads as an SVG named after the question', async () => {
  const blobs = [];
  global.URL.createObjectURL = jest.fn((b) => { blobs.push(b); return 'blob:x'; });
  global.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { blobs.name = this.download; });
  render(<FigureDownloadButton question={questions.find((q) => q.name === 'safe')} responses={responses} questionNumber={2} language="en" />);
  fireEvent.click(screen.getByRole('button', { name: 'Figure' }));
  fireEvent.click(screen.getByText('SVG (vector, for the manuscript)'));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(blobs.name).toBe('safe__trueskill.svg');
  expect(blobs[0].type).toBe('image/svg+xml');
  click.mockRestore();
});

test('a question without a figure reports it instead of failing silently', async () => {
  const onError = jest.fn();
  render(<FigureDownloadButton question={questions.find((q) => q.name === 'comment')} responses={responses} language="zh" onError={onError} />);
  fireEvent.click(screen.getByRole('button', { name: '论文图' }));
  fireEvent.click(screen.getByText('SVG（矢量，放论文用）'));
  await waitFor(() => expect(onError).toHaveBeenCalledWith('这道题没有可以导出的图。'));
});
