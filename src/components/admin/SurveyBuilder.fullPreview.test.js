/* eslint-disable testing-library/no-node-access -- Verify layout wrappers and SurveyJS-generated editing/width attributes. */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SurveyBuilder from './SurveyBuilder';
import { RegionProvider } from '../../contexts/RegionContext';

jest.mock('./AiAssistantPanel', () => () => null);
jest.mock('./FullSurveyPreview', () => ({ onConfigChange }) => <div data-testid="layout-studio">{onConfigChange ? 'Editable studio' : 'Missing editor'}</div>);
jest.mock('./SurveyPreview', () => ({ interactive, onConfigChange }) => <div data-testid="survey-preview">{!interactive && !onConfigChange ? 'Original preview' : 'Editable preview'}</div>);

const config = {
  title: 'Study',
  pages: [{ name: 'page1', title: 'Page 1', elements: [] }],
};

function renderBuilder(language, onOpenLayoutStudio, onOpenPreview) {
  localStorage.setItem('sp-survey-language', language);
  return render(
    <RegionProvider>
      <SurveyBuilder
        config={config}
        onChange={jest.fn()}
        onNextStep={jest.fn()}
        onOpenLayoutStudio={onOpenLayoutStudio}
        onOpenPreview={onOpenPreview}
        hideAssistant
        currentProject={{ id: 'project-1' }}
      />
    </RegionProvider>,
  );
}

afterEach(() => localStorage.clear());

test('Layout Studio is the primary action and Add New Page sits with Next', () => {
  const open = jest.fn();
  const preview = jest.fn();
  renderBuilder('en', open, preview);
  const primary = document.querySelector('[data-admin-primary-action]');
  expect(within(primary).getByRole('button', { name: 'Layout Studio' })).toHaveClass('MuiButton-contained');
  expect(within(primary).queryByRole('button', { name: 'Add New Page' })).not.toBeInTheDocument();
  const row = document.querySelector('[data-builder-page-actions]');
  const addPage = within(row).getByRole('button', { name: 'Add New Page' });
  expect(addPage).toHaveClass('MuiButton-outlined');
  expect(within(row).getByRole('button', { name: /Next: Host/ })).toBeInTheDocument();
  fireEvent.click(within(primary).getByRole('button', { name: 'Layout Studio' }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(preview).not.toHaveBeenCalled();
  const previewButton = within(primary).getByRole('button', { name: 'Preview', exact: true });
  expect(previewButton).toHaveClass('MuiButton-outlined');
  fireEvent.click(previewButton);
  expect(preview).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});

test('Chinese builder uses the same button placement', () => {
  renderBuilder('zh');
  const primary = document.querySelector('[data-admin-primary-action]');
  expect(within(primary).getByRole('button', { name: '版式工作台' })).toBeInTheDocument();
  expect(within(primary).getByRole('button', { name: '预览', exact: true })).toBeInTheDocument();
  const row = document.querySelector('[data-builder-page-actions]');
  expect(within(row).getByRole('button', { name: '添加新页面' })).toHaveClass('MuiButton-outlined');
  expect(within(row).getByRole('button', { name: /下一步：部署/ })).toBeInTheDocument();
});

test.each([
  ['Layout Studio', 'layout-studio', 'Editable studio', 'survey-preview'],
  ['Preview', 'survey-preview', 'Original preview', 'layout-studio'],
])('%s opens the matching local dialog when no parent callback is provided', async (button, target, text, other) => {
  renderBuilder('en');
  fireEvent.click(screen.getByRole('button', { name: button, exact: true }));
  expect(await screen.findByTestId(target)).toHaveTextContent(text);
  expect(screen.queryByTestId(other)).not.toBeInTheDocument();
});
