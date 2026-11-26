import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import QsfImportReport from './QsfImportReport';
import { qsfToSurveyConfig } from '../../lib/qsfImport';
import { QUALTRICS_SAMPLE } from '../../lib/__fixtures__/qualtricsSample';

test('lists skipped questions and things to check', () => {
  const { report } = qsfToSurveyConfig(QUALTRICS_SAMPLE);
  render(<QsfImportReport report={report} language="en" onClose={() => {}} />);
  expect(screen.getByText(/11 questions converted/)).toBeInTheDocument();
  expect(screen.getByText(/heat · Click where you feel unsafe/)).toBeInTheDocument();
  expect(screen.getByText(/Display logic was not converted/)).toBeInTheDocument();
  expect(screen.getByText(/Block randomizers were not converted/)).toBeInTheDocument();
});

test('renders nothing without a report', () => {
  const { container } = render(<QsfImportReport report={null} language="en" onClose={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});
