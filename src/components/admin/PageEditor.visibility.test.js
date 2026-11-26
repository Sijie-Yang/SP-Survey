import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import PageEditor from './PageEditor';
import { RegionProvider } from '../../contexts/RegionContext';

jest.mock('../../lib/skillManager', () => ({ listSkillsForBuilder: () => Promise.resolve([]) }));

beforeEach(() => localStorage.setItem('sp-survey-language', 'zh'));
afterEach(() => localStorage.clear());

test('page settings show the link-parameter display rule as a plain choice', () => {
  const page = { name: 'page_on_site', title: 'On-site validation', visibleIf: '{url_site} notempty', elements: [] };
  render(<RegionProvider><PageEditor page={page} pageIndex={2} surveyConfig={{ captureUrlParams: ['site'] }} onSave={jest.fn()} onCancel={jest.fn()} /></RegionProvider>);
  expect(screen.getByLabelText('何时显示这一页')).toBeInTheDocument();
  expect(screen.getByText('只在链接带 site 参数时显示')).toBeInTheDocument();
});
