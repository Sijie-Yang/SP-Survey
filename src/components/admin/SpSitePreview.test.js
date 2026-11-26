import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SpSitePreview from './SpSitePreview';

jest.mock('../SpSiteFrame', () => ({ __esModule: true, default: () => <div data-testid="sp-site-frame" /> }));
jest.mock('../SpSiteSurvey', () => ({ applyPageState: (s) => s, captureRecord: () => null, pageSaysFinished: () => false }));

const config = { pages: [], spSite: { html: '<p>page</p>', id: 's1' } };

test('the classic editor keeps the notice about how the page was imported', () => {
  render(<SpSitePreview config={config} previewLibrary />);
  expect(screen.getByTestId('sp-site-match')).toBeInTheDocument();
  expect(screen.queryByTestId('sp-site-sample-images')).toBeNull();
});

test('Studio drops that notice and says in one line when sample images are shown', () => {
  const { rerender } = render(<SpSitePreview config={config} previewLibrary hideImportNotice />);
  expect(screen.queryByTestId('sp-site-match')).toBeNull();
  expect(screen.getByTestId('sp-site-sample-images')).toHaveTextContent("The preview uses the platform's sample images. Upload your own images.");
  rerender(<SpSitePreview config={config} hideImportNotice />);
  expect(screen.queryByTestId('sp-site-sample-images')).toBeNull();
  expect(screen.queryByTestId('sp-site-match')).toBeNull();
});
