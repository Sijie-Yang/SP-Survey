import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TrueSkillTable } from './trueSkillAnalysisUi';

test('ranking labels use readable filenames while same-name sources remain distinct', () => {
  const urls = ['https://media.test/a/%E8%A1%97%E6%99%AF.jpg?token=first', 'https://media.test/b/%E8%A1%97%E6%99%AF.jpg?token=second'];
  const rankings = urls.map((imageKey, index) => ({ imageKey, displayUrl: imageKey, mu: 25 - index, games: index + 1 }));
  render(<TrueSkillTable rankings={rankings} />);
  expect(screen.getAllByText('街景.jpg')).toHaveLength(2);
  expect(screen.getAllByRole('img').map((img) => img.getAttribute('src'))).toEqual(urls);
  expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual(['街景.jpg', '街景.jpg']);
  expect(screen.getByRole('table').textContent).not.toContain('https://');
  expect(screen.getAllByRole('row')).toHaveLength(3);
  expect(rankings.map((row) => row.imageKey)).toEqual(urls);
});

test('Image sorting follows filenames rather than host or folder names', () => {
  render(<TrueSkillTable rankings={[
    { imageKey: 'https://a.test/first/image10.jpg', mu: 30 },
    { imageKey: 'https://z.test/last/image2.jpg', mu: 20 },
  ]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Image' }));
  expect(within(screen.getAllByRole('row')[1]).getByText('image2.jpg')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Image' }));
  expect(within(screen.getAllByRole('row')[1]).getByText('image10.jpg')).toBeTruthy();
});
