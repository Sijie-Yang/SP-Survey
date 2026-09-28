import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TrueSkillTable, TRUESKILL_PAGE_SIZE } from './trueSkillAnalysisUi';
import { ForcedChoicePreferenceAnalysis, MaxDiffAnalysis } from './skillAnalysis';

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

test('one category per trial shows each ranking as a tab under the question', () => {
  const question = {
    name: 'fc',
    mediaAssignmentMode: 'category',
    mediaCategoryMode: 'single',
  };
  const answers = [
    { answer: { choice: 'A', chosenIndex: 0 }, shown_images: ['park-a.jpg', 'park-b.jpg'], shown_media_categories: ['park'] },
    { answer: { choice: 'A', chosenIndex: 0 }, shown_images: ['park-a.jpg', 'park-b.jpg'], shown_media_categories: ['park'] },
    { answer: { choice: 'B', chosenIndex: 1 }, shown_images: ['urban-c.jpg', 'urban-d.jpg'], shown_media_categories: ['urban'] },
  ];
  render(<ForcedChoicePreferenceAnalysis answers={answers} question={question} />);
  expect(screen.getByRole('tab', { name: 'park' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'urban' })).toBeTruthy();
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.getByRole('table').textContent).toContain('park-a.jpg');
  expect(screen.getByRole('table').textContent).not.toContain('urban-c.jpg');
  fireEvent.click(screen.getByRole('tab', { name: 'urban' }));
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.getByRole('table').textContent).toContain('urban-c.jpg');
  expect(screen.getByRole('table').textContent).not.toContain('park-a.jpg');
});

test('other sampling modes keep one ranking without category tabs', () => {
  const question = { name: 'fc', mediaAssignmentMode: 'category', mediaCategoryMode: 'all' };
  const answers = [
    { answer: { choice: 'A', chosenIndex: 0 }, shown_images: ['park-a.jpg', 'park-b.jpg'], shown_media_categories: ['park'] },
    { answer: { choice: 'B', chosenIndex: 1 }, shown_images: ['urban-c.jpg', 'urban-d.jpg'], shown_media_categories: ['urban'] },
  ];
  render(<ForcedChoicePreferenceAnalysis answers={answers} question={question} />);
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.getByRole('table').textContent).toContain('park-a.jpg');
  expect(screen.getByRole('table').textContent).toContain('urban-c.jpg');
});

test('MaxDiff one-category trials use one board per category', () => {
  const question = {
    name: 'bw',
    mediaAssignmentMode: 'category',
    mediaCategoryMode: 'single',
    skillConfig: { mediaCount: 3 },
  };
  const answers = [
    { answer: { bestIndex: 0, worstIndex: 2 }, shown_images: ['park-a.jpg', 'park-b.jpg', 'park-c.jpg'], shown_media_categories: ['park'] },
    { answer: { bestIndex: 1, worstIndex: 0 }, shown_images: ['urban-c.jpg', 'urban-d.jpg', 'urban-e.jpg'], shown_media_categories: ['urban'] },
  ];
  render(<MaxDiffAnalysis answers={answers} question={question} />);
  expect(screen.getByRole('tab', { name: 'park' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'urban' })).toBeTruthy();
  expect(screen.getAllByRole('table')).toHaveLength(1);
  expect(screen.getByRole('table').textContent).toContain('park-a.jpg');
  expect(screen.getByRole('table').textContent).not.toContain('urban-d.jpg');
  fireEvent.click(screen.getByRole('tab', { name: 'urban' }));
  expect(screen.getByRole('table').textContent).toContain('urban-d.jpg');
  expect(screen.getByRole('table').textContent).not.toContain('park-a.jpg');
});

test('a long ranking paginates instead of listing every image', () => {
  const rankings = Array.from({ length: TRUESKILL_PAGE_SIZE + 2 }, (_, index) => ({
    imageKey: `image-${String(index + 1).padStart(2, '0')}.jpg`,
    mu: 40 - index,
  }));
  render(<TrueSkillTable rankings={rankings} />);
  const table = screen.getByRole('table');
  expect(table.textContent).toContain('image-01.jpg');
  expect(table.textContent).not.toContain('image-12.jpg');
  expect(within(screen.getAllByRole('row')[1]).getByText('1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
  expect(screen.getByRole('table').textContent).toContain('image-11.jpg');
  expect(screen.getByRole('table').textContent).toContain('image-12.jpg');
  expect(screen.getByRole('table').textContent).not.toContain('image-01.jpg');
  expect(within(screen.getAllByRole('row')[1]).getByText('11')).toBeTruthy();
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
