import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PaperMethodsPanel, { PairwiseAnalysis } from './PaperMethodsPanel';
import { RegionProvider } from '../../contexts/RegionContext';

const pick = (participant, a, b, answer, meta = {}) => ({
  participant_id: participant,
  responses: { q: { answer, shown_images: [a, b] } },
  survey_metadata: meta,
});
const responses = [
  pick('p1', 'A.jpg', 'B.jpg', 'A.jpg', { condition: 'x' }), pick('p1', 'A.jpg', 'C.jpg', 'A.jpg', { condition: 'x' }),
  pick('p2', 'B.jpg', 'C.jpg', 'B.jpg', { condition: 'y' }), pick('p2', 'A.jpg', 'C.jpg', 'C.jpg', { condition: 'y' }),
];
const question = { name: 'q', type: 'imagepicker', title: 'Which looks safer?' };

beforeEach(() => localStorage.clear());

test('imagepicker scoring stays on the TrueSkill chart until the score changes', () => {
  const { container } = render(<RegionProvider><PaperMethodsPanel question={{ name: 't', type: 'text' }} allResponses={responses} surveyConfig={{}} /></RegionProvider>);
  expect(container.textContent).toBe('');
  render(<RegionProvider><PairwiseAnalysis question={question} responses={responses} surveyConfig={{ pages: [{ elements: [question] }] }} /></RegionProvider>);
  expect(screen.queryByText('Paper methods (optional)')).toBeNull();
  expect(screen.getByText('TrueSkill (pairwise from selections vs non-selected shown images)')).toBeTruthy();
  expect(screen.getAllByRole('combobox')[0].textContent).toBe('TrueSkill');
  expect(screen.getByText('Coverage and reliability')).toBeTruthy();
  expect(screen.queryByText('Group comparison')).toBeNull();
  expect(screen.getByText('Export scores CSV')).toBeTruthy();
});

test('template recommendation is a hint and Q-score uses the same ranking table', () => {
  const surveyConfig = {
    pages: [{ elements: [question] }],
    conditions: [{ id: 'x' }, { id: 'y' }],
    spAnalysisRecommendation: { questions: ['q'], method: 'qscore_pairwise', minPerImage: 1 },
  };
  render(<RegionProvider><PairwiseAnalysis question={question} responses={responses} surveyConfig={surveyConfig} /></RegionProvider>);
  expect(screen.getByText('Template recommends Q-score')).toBeTruthy();
  expect(screen.getByText('TrueSkill image rankings')).toBeTruthy();
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(screen.getByRole('option', { name: 'Q-score (Salesses 2013)' }));
  expect(screen.getByText('Q-score image rankings')).toBeTruthy();
  const table = screen.getByRole('table');
  expect(within(table).getByText('A.jpg')).toBeTruthy();
  expect(screen.getByText('Group comparison')).toBeTruthy();
});

test('one category per trial keeps a ranking per category for every score', () => {
  const categorized = {
    name: 'q',
    type: 'imagepicker',
    title: 'Which looks safer?',
    mediaAssignmentMode: 'category',
    mediaCategoryMode: 'single',
  };
  const trial = (answer, shown, category) => ({ answer, shown_images: shown, shown_media_categories: [category] });
  const rows = [{
    participant_id: 'p1',
    responses: {
      q: {
        trials: [
          trial('park-a.jpg', ['park-a.jpg', 'park-b.jpg'], 'park'),
          trial('park-a.jpg', ['park-a.jpg', 'park-b.jpg'], 'park'),
          trial('urban-c.jpg', ['urban-c.jpg', 'urban-d.jpg'], 'urban'),
          trial('urban-c.jpg', ['urban-c.jpg', 'urban-d.jpg'], 'urban'),
        ],
      },
    },
  }];
  render(<RegionProvider><PairwiseAnalysis question={categorized} responses={rows} surveyConfig={{ pages: [{ elements: [categorized] }] }} /></RegionProvider>);
  expect(screen.getByRole('tab', { name: 'park' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'urban' })).toBeTruthy();
  expect(screen.getByText('TrueSkill — park')).toBeTruthy();
  expect(screen.queryByText('urban-c.jpg')).toBeNull();
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(screen.getByRole('option', { name: 'Q-score (Salesses 2013)' }));
  expect(screen.getByRole('tab', { name: 'urban' })).toBeTruthy();
  expect(screen.getByText('Q-score — park')).toBeTruthy();
  expect(screen.getByText('Relative (0–5)')).toBeTruthy();
  expect(screen.queryByText('urban-c.jpg')).toBeNull();
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(screen.getByRole('option', { name: '0–10' }));
  const table = screen.getByRole('table');
  expect(within(table).getByText('0–10')).toBeTruthy();
  expect(within(table).queryByText('Relative (0–5)')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'urban' }));
  expect(screen.getByText('Q-score — urban')).toBeTruthy();
  expect(screen.getByText('urban-c.jpg')).toBeTruthy();
});

test('rating questions show per-stimulus stats in the analysis', () => {
  const rq = { name: 'r', type: 'imagerating', rateMin: 1, rateMax: 5 };
  const rows = [1, 2, 3].map((v, i) => ({ participant_id: `p${i}`, responses: { r: { answer: v, shown_images: ['A.jpg'] } } }));
  render(<RegionProvider><PaperMethodsPanel question={rq} allResponses={rows} surveyConfig={{ pages: [{ elements: [rq] }] }} /></RegionProvider>);
  expect(screen.queryByText('Paper methods (optional)')).toBeNull();
  expect(screen.getByText('Export per-stimulus CSV')).toBeTruthy();
  expect(screen.getByText('Rater agreement')).toBeTruthy();
});
