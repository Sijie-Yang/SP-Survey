import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import VariantContrastCard from './VariantContrastCard';
import { syntheticResponses, syntheticSurveyConfig } from '../../lib/__fixtures__/syntheticResults';
import { flattenQuestions } from '../../lib/quality';

jest.mock('../../lib/zipDownload', () => ({ downloadZip: jest.fn() }));

const urls = ['s1', 's2', 's3', 's4'].flatMap((s) => ['base', 'trees'].map((v) => `https://m.example.org/x/${s}__${v}.jpg`));
const q = { name: 'q', title: 'Comfort', type: 'imagerating', rateMin: 1, rateMax: 7, selectedImageUrls: urls };
const rows = Array.from({ length: 12 }, (_, i) => ({
  id: `r${i}`, participant_id: `p${i}`, created_at: '2026-10-01T00:00:00Z', survey_metadata: {},
  responses: { q: { trials: urls.map((u, t) => ({ trial_index: t, value: (u.includes('trees') ? 5 : 3) + (i % 2), shown_images: [u] })) } },
}));

test('shows per-version contrasts and lets the researcher change the baseline', () => {
  render(<VariantContrastCard questions={[q]} responses={rows} language="en" numberByName={new Map([['q', 3]])} />);
  const block = screen.getByTestId('variant-block-q');
  expect(within(block).getByText(/Q3/)).toBeInTheDocument();
  const cell = (b, text) => within(b).getByText((_, el) => el.tagName === 'TD' && el.textContent.startsWith(text));
  expect(cell(block, '+2.00')).toBeInTheDocument();
  fireEvent.mouseDown(within(block).getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: 'trees' }));
  expect(cell(screen.getByTestId('variant-block-q'), '-2.00')).toBeInTheDocument();
});

test('renders nothing for ordinary image sets', () => {
  const config = syntheticSurveyConfig({ images: 8 });
  const { container } = render(<VariantContrastCard questions={flattenQuestions(config)} responses={syntheticResponses(20, { config })} language="en" />);
  expect(container).toBeEmptyDOMElement();
});
