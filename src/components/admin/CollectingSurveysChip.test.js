import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { RegionProvider } from '../../contexts/RegionContext';
import { adminI18n } from '../../contexts/adminI18n';
import CollectingSurveysChip from './CollectingSurveysChip';

function renderChip(count) {
  return render(
    <RegionProvider>
      <CollectingSurveysChip count={count} />
    </RegionProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('sp-survey-language', 'en');
});

test('English chip matches the running-tasks label pattern', () => {
  renderChip(2);
  const chip = screen.getByTestId('collecting-surveys-chip');
  expect(chip).toHaveTextContent('Surveys · 2 collecting');
  expect(adminI18n.en.collectingSurveysBadge).toBe('Surveys · {count} collecting');
  expect(adminI18n.zh.collectingSurveysBadge).toBe('问卷 · {count} 收集中');
});

test('Chinese chip says how many surveys are collecting', () => {
  localStorage.setItem('sp-survey-language', 'zh');
  renderChip(0);
  expect(screen.getByTestId('collecting-surveys-chip')).toHaveTextContent('问卷 · 0 收集中');
  expect(adminI18n.zh.collectingSurveysTitle).toContain('已发布');
  expect(adminI18n.zh.collectingSurveysTitle).toContain('他人');
});
