import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SurveyPreview, { previewSourceKey } from './SurveyPreview';

jest.mock('../../lib/previewMediaLibrary', () => ({
  resolveMediaPoolForPreview: async () => [],
  resolvePreviewMediaContext: async () => ({ images: [], imageDatasetConfig: {}, fromPreviewLibrary: false }),
}));

const twoPageConfig = {
  title: 'Preview stability',
  pages: [
    { name: 'page_intro', title: 'Page 1', elements: [{ type: 'html', name: 'h1', html: '<p>First page body</p>' }] },
    { name: 'page_perception', title: 'Page 2', elements: [{ type: 'html', name: 'h2', html: '<p>Second page body</p>' }] },
  ],
};

beforeEach(() => {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

test('parent rerender does not snap preview back to page 1', async () => {
  const project = { preloadedImages: [] };
  const { rerender } = render(<SurveyPreview config={twoPageConfig} currentProject={project} />);
  expect(await screen.findByText('First page body')).toBeInTheDocument();

  const next = screen.getByRole('button', { name: /next/i });
  await act(async () => {
    fireEvent.click(next);
  });
  expect(await screen.findByText('Second page body')).toBeInTheDocument();

  rerender(<SurveyPreview config={{ ...twoPageConfig }} currentProject={{ ...project, preloadedImages: [] }} />);
  expect(screen.getByText('Second page body')).toBeInTheDocument();
  expect(screen.queryByText('First page body')).not.toBeInTheDocument();
});

test('preview refresh key includes category tags and logical folders, not unrelated UI fields', () => {
  const config = { pages: [{ name: 'p', elements: [{ name: 'q' }] }] };
  const base = {
    name: 'Study',
    preloadedImages: [{ key: 'a', url: '/a.jpg', logicalFolder: 'park' }],
    imageDatasetConfig: { mediaFolderTags: { park: 'category' }, mediaFolders: ['park'] },
  };
  expect(previewSourceKey(config, { ...base, uiOnly: 1 }))
    .toBe(previewSourceKey(config, { ...base, uiOnly: 2 }));
  expect(previewSourceKey(config, {
    ...base,
    imageDatasetConfig: { ...base.imageDatasetConfig, mediaFolderTags: { park: 'set' } },
  })).not.toBe(previewSourceKey(config, base));
});
