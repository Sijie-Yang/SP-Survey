import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { RegionProvider } from '../../contexts/RegionContext';
import { adminI18n } from '../../contexts/adminI18n';
import OpenProjectHeader, { ProjectHeaderTitle } from './ProjectSurveyAge';

jest.mock('../../lib/surveyAge', () => {
  const actual = jest.requireActual('../../lib/surveyAge');
  return {
    ...actual,
    countStoredProjectResponses: jest.fn(),
  };
});

const { countStoredProjectResponses } = require('../../lib/surveyAge');

const NOW = Date.parse('2026-10-08T12:00:00.000Z');
const project = {
  id: 'proj-a',
  name: 'Street Comfort',
  publishedAt: new Date(NOW - 12 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString(),
};

function renderHeader(node) {
  return render(<RegionProvider>{node}</RegionProvider>);
}

beforeEach(() => {
  localStorage.setItem('sp-survey-language', 'en');
});

test('places the age and answer count under the project name', () => {
  renderHeader(
    <ProjectHeaderTitle project={project} responseCount={4} now={NOW} />,
  );
  const header = screen.getByTestId('project-header');
  expect(header).toHaveTextContent('Street Comfort');
  expect(header).toHaveTextContent('Published 12 days ago · 4 answers');
  const status = screen.getByTestId('survey-age');
  expect(header.firstChild.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('reads the stored response count for the open project', async () => {
  countStoredProjectResponses.mockResolvedValue(4);
  renderHeader(<OpenProjectHeader project={project} />);
  await waitFor(() => {
    expect(screen.getByTestId('survey-age')).toHaveTextContent(/4 answers$/);
  });
  expect(countStoredProjectResponses).toHaveBeenCalledWith('proj-a');
});

test('Chinese header says created when the survey has no publish time', () => {
  localStorage.setItem('sp-survey-language', 'zh');
  renderHeader(
    <ProjectHeaderTitle project={{ ...project, publishedAt: null, createdAt: new Date(NOW - 12 * 24 * 60 * 60 * 1000).toISOString() }} responseCount={4} now={NOW} />,
  );
  expect(screen.getByTestId('survey-age')).toHaveTextContent('创建于 12 天前 · 4 份回答');
  expect(adminI18n.zh.surveyAgeCreated).toContain('创建于');
});
