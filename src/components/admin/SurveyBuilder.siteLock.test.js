import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SurveyBuilder from './SurveyBuilder';
import { RegionProvider } from '../../contexts/RegionContext';

jest.mock('./AiAssistantPanel', () => () => null);
jest.mock('./SpSchemePanel', () => () => null);
jest.mock('./FullSurveyPreview', () => () => null);
jest.mock('./SurveyPreview', () => () => null);

const base = { title: 'S', pages: [{ name: 'p1', elements: [{ type: 'text', name: 'a' }] }] };

function renderBuilder(config) {
  return render(
    <RegionProvider>
      <SurveyBuilder config={config} onChange={jest.fn()} hideAssistant currentProject={{ id: 'project-1' }} />
    </RegionProvider>,
  );
}

test('an uploaded page locks the pages and says how to unlock them', () => {
  const { container } = renderBuilder({ ...base, spSite: { html: '<html></html>' } });
  expect(screen.getByTestId('builder-site-locked')).toBeInTheDocument();
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
  expect(container.querySelector('[aria-disabled="true"]')).toBeTruthy();
});

test('a normal survey is not locked', () => {
  renderBuilder(base);
  expect(screen.queryByTestId('builder-site-locked')).not.toBeInTheDocument();
});
