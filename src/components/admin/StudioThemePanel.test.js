import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import StudioThemePanel from './StudioThemePanel';
import SurveyBuilder from './SurveyBuilder';
import { RegionProvider } from '../../contexts/RegionContext';
import { SURVEY_THEME_OPTIONS, SURVEY_THEME_PRESETS } from '../../lib/surveyThemePresets';

jest.mock('./AiAssistantPanel', () => () => null);
jest.mock('../SurveyThemePreviewPanel', () => () => null);

const initial = {
  title: 'Theme study', pages: [],
  theme: Object.fromEntries(Object.keys(SURVEY_THEME_PRESETS.default).map(key => [key, '#123456'])),
  viewportLayout: { mobile: { contentWidth: 360 } },
};
let current;
function Studio() {
  const [config, setConfig] = useState(initial);
  current = config;
  return <StudioThemePanel config={config} onChange={setConfig} onStart={() => {}} onEnd={() => {}} />;
}

afterEach(() => localStorage.clear());

test('Header is directly visible and presets replace the entire palette without changing device layout', () => {
  render(<Studio />);
  expect(screen.getByLabelText('Header')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Research', exact: true }));
  expect(current.theme.headerBackground).toBe('#f3f3f3');
  expect(current.theme.textColor).toBe('#000000');
  expect(current.theme.focusBorder).toBe('#437fd9');
  expect(screen.getByRole('button', { name: 'Research', exact: true })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('Header'), { target: { value: '#abcdef' } });
  expect(current.theme.headerBackground).toBe('#abcdef');
  expect(screen.getByRole('button', { name: 'Research', exact: true })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Default', exact: true }));
  expect(screen.getByRole('button', { name: 'Default', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // These two palettes share a primary color, but only the full match is selected.
  expect(screen.getByRole('button', { name: 'Professional', exact: true })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Dark', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore default colors' }));
  expect(current.theme).toEqual(SURVEY_THEME_PRESETS.default);
  expect(current.viewportLayout).toEqual(initial.viewportLayout);
});

test('all nine Builder and Studio presets and their resets produce identical complete themes', () => {
  render(<Studio />);
  const studioThemes = {};
  for (const option of SURVEY_THEME_OPTIONS) {
    fireEvent.click(screen.getByRole('button', { name: option.name, exact: true }));
    studioThemes[option.id] = current.theme;
    expect(current.theme).toEqual(SURVEY_THEME_PRESETS[option.id]);
    expect(Object.values(current.theme)).not.toContain('#123456');
  }
  cleanup();
  localStorage.setItem('sp-survey-language', 'en');
  const change = jest.fn();
  render(<RegionProvider><SurveyBuilder config={initial} onChange={change} hideAssistant currentProject={{ id: 'qa' }} /></RegionProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Theme Customization', exact: true }));
  for (const option of SURVEY_THEME_OPTIONS) {
    fireEvent.click(screen.getByRole('button', { name: option.name, exact: true }));
    expect(change).toHaveBeenLastCalledWith({ ...initial, theme: studioThemes[option.id] });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }));
  expect(change).toHaveBeenLastCalledWith({ ...initial, theme: SURVEY_THEME_PRESETS.default });
});
