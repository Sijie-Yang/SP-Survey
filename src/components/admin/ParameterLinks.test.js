import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ParameterLinks, { buildParameterLinks, splitValues } from './ParameterLinks';
import { RegionProvider } from '../../contexts/RegionContext';

afterEach(() => localStorage.clear());

test('one link per value, combinations across parameters', () => {
  expect(splitValues('S01\nS02, S02\n\n')).toEqual(['S01', 'S02']);
  const base = 'https://x.org/survey?project=p1';
  expect(buildParameterLinks(base, { site: [] })).toEqual([]);
  expect(buildParameterLinks(base, { site: ['S01', 'S02'] }).map((l) => l.url))
    .toEqual(['https://x.org/survey?project=p1&site=S01', 'https://x.org/survey?project=p1&site=S02']);
  expect(buildParameterLinks(base, { site: ['A', 'B'], pid: ['1', '2'] })).toHaveLength(4);
});

test('share card lists the recorded parameters and generates links', () => {
  render(<RegionProvider><ParameterLinks surveyUrl="https://x.org/survey?project=p1" surveyConfig={{ captureUrlParams: ['site'] }} projectId="p1" /></RegionProvider>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'S01\nS02' } });
  expect(screen.getByText('https://x.org/survey?project=p1&site=S02')).toBeInTheDocument();
});

test('hidden when the survey records no parameters and has no conditions', () => {
  const { container } = render(<RegionProvider><ParameterLinks surveyUrl="https://x.org/s" surveyConfig={{}} projectId="p1" /></RegionProvider>);
  expect(container).toBeEmptyDOMElement();
});
