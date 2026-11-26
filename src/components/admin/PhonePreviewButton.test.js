import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { RegionProvider } from '../../contexts/RegionContext';
import PhonePreviewButton from './PhonePreviewButton';

jest.mock('./SurveyQrCode', () => ({ surveyUrl }) => <div data-testid="qr">{surveyUrl}</div>);

const renderIt = (project, language = 'en') => render(<RegionProvider><PhonePreviewButton project={project} language={language} /></RegionProvider>);

test('scanning opens the participant link, by custom slug when there is one', () => {
  renderIt({ id: 'p1', name: 'Study', publicSlug: 'street-safety' });
  fireEvent.click(screen.getByRole('button', { name: 'View on phone' }));
  expect(screen.getByTestId('qr').textContent).toMatch(/\/s\/street-safety$/);
  expect(screen.getByText(/count as real responses/)).toBeInTheDocument();
});

test('a released survey says the phone shows the published version', () => {
  renderIt({ id: 'p1', releaseManaged: true, publishedVersion: 3 }, 'zh');
  fireEvent.click(screen.getByRole('button', { name: '手机上看' }));
  expect(screen.getByText(/已发布的版本（v3）/)).toBeInTheDocument();
});

test('no project, no button', () => {
  const { container } = renderIt(null);
  expect(container).toBeEmptyDOMElement();
});
