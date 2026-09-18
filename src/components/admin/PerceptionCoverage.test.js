import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PerceptionCoverage, { coverageGroups } from './PerceptionCoverage';
import { RegionProvider } from '../../contexts/RegionContext';

const rows = [
  { media_id: 'a', name: 'same.jpg', media_matched: true, sam_status: 'ready', sam_review_status: 'accepted', n_ratings: 2, mean_score: 0, light: 0 },
  { media_id: 'b', name: 'same.jpg', media_matched: true, sam_status: 'missing', n_ratings: 1, mean_score: 4 },
  { media_id: 'c', name: 'review.jpg', media_matched: true, sam_status: 'ready', sam_review_status: 'needs_review', n_ratings: 0 },
  { media_id: 'old', name: 'historical.jpg', media_matched: false, n_ratings: 2, mean_score: 1 },
];
beforeEach(() => localStorage.clear());
test('diagnostics distinguish measured zero, missing features, missing scores and unmatched history', () => {
  const groups = coverageGroups(rows, [rows[0]], ['light']);
  expect(groups.usable.map((r) => r.media_id)).toEqual(['a']);
  expect(groups.missing_features.map((r) => r.media_id)).toEqual(['b']);
  expect(groups.missing_score.map((r) => r.media_id)).toEqual(['c']);
  expect(groups.unmatched.map((r) => r.media_id)).toEqual(['old']);
});
test('clicking a diagnosis locates the exact media ID, not a same-name file', () => {
  const open = jest.fn();
  localStorage.setItem('sp-survey-language', 'zh');
  render(<RegionProvider><PerceptionCoverage rows={rows} filteredRows={rows} featureCols={['light']} selectionReady onOpenMedia={open} /></RegionProvider>);
  fireEvent.click(screen.getByRole('button', { name: '缺标注 · 1' }));
  expect(screen.getByText('ID: b')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '定位并标注' }));
  expect(open).toHaveBeenCalledWith('b');
});
test('unmatched historical rows offer inspection without an incorrect annotation jump', () => {
  render(<RegionProvider><PerceptionCoverage rows={rows} filteredRows={rows} featureCols={['light']} selectionReady onOpenMedia={jest.fn()} /></RegionProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Unmatched · 1' }));
  expect(screen.getByText('ID: old')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Locate & annotate' })).toBeNull();
});
