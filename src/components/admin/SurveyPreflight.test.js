import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SurveyPreflight from './SurveyPreflight';
import { RegionProvider } from '../../contexts/RegionContext';
jest.mock('../../lib/skillManager', () => ({ getSkillById: jest.fn() }));
test('runs in the share page without submitting responses and clears stale reports after edits', async () => {
  const project = { id: 'local-test', preloadedImages: [] };
  const config = { pages: [{ name: 'p', elements: [{ name: 'n', type: 'number', min: 0 }] }] };
  const { rerender } = render(<RegionProvider><SurveyPreflight surveyConfig={config} currentProject={project} /></RegionProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  expect(await screen.findByText(/Assignment and example-export checks passed/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download test report with simulated answers' })).toBeTruthy();
  rerender(<RegionProvider><SurveyPreflight surveyConfig={{ ...config, title: 'Changed' }} currentProject={project} /></RegionProvider>);
  expect(screen.queryByText(/Assignment and example-export checks passed/)).toBeNull();
});
