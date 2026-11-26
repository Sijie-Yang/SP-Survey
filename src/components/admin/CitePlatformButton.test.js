import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CitePlatformButton from './CitePlatformButton';

test('opens the cite dialog, switches formats and copies', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CitePlatformButton language="en" />);
  fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
  expect(screen.getByTestId('citation-text')).toHaveTextContent('@software{spsurvey_software');
  fireEvent.click(screen.getByRole('tab', { name: 'APA' }));
  expect(screen.getByTestId('citation-text')).toHaveTextContent(/^Urban Analytics Lab/);
  fireEvent.click(screen.getByRole('button', { name: 'Copy APA' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Urban Analytics Lab/)));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'SP-Report' })).toHaveAttribute('href', '/docs/sp-report');
});

test('Chinese labels', () => {
  render(<CitePlatformButton language="zh" />);
  fireEvent.click(screen.getByRole('button', { name: '引用' }));
  expect(screen.getByRole('tab', { name: '方法段落' })).toBeInTheDocument();
});

test('drafts a Methods section in a journal style from the survey', () => {
  const { syntheticResponses, syntheticSurveyConfig } = require('../../lib/__fixtures__/syntheticResults');
  const { methodsFacts } = require('../../lib/journalMethods');
  const config = syntheticSurveyConfig({ images: 8 });
  const getMethodsFacts = jest.fn(() => methodsFacts({ surveyConfig: config, responses: syntheticResponses(10, { config }) }));
  render(<CitePlatformButton language="en" getMethodsFacts={getMethodsFacts} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
  expect(getMethodsFacts).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: 'Methods for a journal' }));
  expect(screen.getByTestId('citation-text')).toHaveTextContent(/with SP-Survey \(2026\)/);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: /Landscape and Urban Planning/ }));
  expect(screen.getByTestId('citation-text')).toHaveTextContent(/2\.4\. Ethics/);
});
