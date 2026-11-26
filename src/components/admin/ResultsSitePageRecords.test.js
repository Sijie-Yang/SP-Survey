import React from 'react';
import { render, screen } from '@testing-library/react';
import { SitePageRecords } from './ResultsAnalysis';

test('a participant record shows what the page saved and sent', () => {
  const row = { responses: {
    __sp_page_state: { 'streetscape-survey-v1': { profile: { age: 33 }, done: true }, 'sp-media:PHOTO_URLS': [{ name: 'a1.jpg', url: 'https://m/a1.jpg' }] },
    __sp_requests: [{ at: 't', kind: 'download', method: 'FILE', url: 'pairwise.csv', data: 'a,b' }],
  } };
  render(<SitePageRecords row={row} zh />);
  const box = screen.getByTestId('results-site-records');
  expect(box.textContent).toContain('streetscape-survey-v1');
  expect(box.textContent).toContain('"age": 33');
  expect(box.textContent).toContain('媒体库图片（PHOTO_URLS）');
  expect(box.textContent).toContain('页面发出的请求（1 条）');
});

test('nothing is shown for a normal response', () => {
  const { container } = render(<SitePageRecords row={{ responses: { q1: 2 } }} />);
  expect(container.textContent).toBe('');
});
