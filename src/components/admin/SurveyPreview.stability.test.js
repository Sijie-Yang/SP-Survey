import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import SurveyPreview, { previewSourceKey } from './SurveyPreview';

jest.mock('../../lib/previewMediaLibrary', () => ({
  resolveMediaPoolForPreview: async () => [],
  surveyUsesSampledMedia: () => false,
  adaptSurveyForPreviewLibrary: (config) => config,
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
  fireEvent.click(next);
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

test('reordering preserves a prepared media draw while media-source changes invalidate it', () => {
  const { previewPreparationKey, reorderPreparedPreview } = require('./SurveyPreview');
  const first = { pages: [{ name: 'p1', elements: [{ name: 'a', type: 'image', title: 'A' }, { name: 'b', type: 'text' }] }, { name: 'p2', elements: [] }] };
  const reordered = { pages: [{ name: 'p2', elements: [{ name: 'b', type: 'text' }] }, { name: 'p1', elements: [{ name: 'a', type: 'image', title: 'Renamed A' }] }] };
  const prepared = { ...first, pages: [{ name: 'p1', elements: [{ ...first.pages[0].elements[0], imageLink: '/fixed-draw.png' }, first.pages[0].elements[1]] }, first.pages[1]] };
  expect(previewPreparationKey(first, {})).toBe(previewPreparationKey(reordered, {}));
  const next = reorderPreparedPreview(prepared, reordered);
  expect(next.pages.map((p) => p.name)).toEqual(['p2', 'p1']);
  expect(next.pages[1].elements[0]).toMatchObject({ name: 'a', title: 'Renamed A', imageLink: '/fixed-draw.png' });
  expect(previewPreparationKey(first, { preloadedImages: [{ url: '/new.png' }] })).not.toBe(previewPreparationKey(first, {}));
  const emptied = reorderPreparedPreview(prepared, { pages: [{ name: 'p1', elements: [] }, { name: 'p2', elements: first.pages[0].elements }] });
  expect(emptied.pages[0].elements.every((q) => !['a', 'b'].includes(q.name))).toBe(true);
  expect(emptied.pages[1].elements.map((q) => q.name)).toEqual(['a', 'b']);
});

test('restoring a cross-page move also restores the visible page, not the old progress cursor', async () => {
  const initial = { pages: [{ name: 'first', elements: [{ name: 'a', type: 'text', title: 'Question A' }, { name: 'b', type: 'text', title: 'Question B' }] }, { name: 'second', elements: [{ name: 'c', type: 'text', title: 'Question C' }] }] };
  const moved = { pages: [{ ...initial.pages[0], elements: [initial.pages[0].elements[0]] }, { ...initial.pages[1], elements: [...initial.pages[1].elements, initial.pages[0].elements[1]] }] };
  const props = { interactive: true, currentProject: { preloadedImages: [] }, onConfigChange: jest.fn() };
  const studio = (pageName) => ({ selection: { kind: 'question', name: 'b', pageName }, onSelect: jest.fn(), guides: true });
  const { rerender } = render(<SurveyPreview {...props} config={initial} studio={studio('first')} />);
  await screen.findByText('Question A');
  rerender(<SurveyPreview {...props} config={moved} studio={studio('second')} />);
  await screen.findByText('Question C');
  rerender(<SurveyPreview {...props} config={initial} studio={studio('first')} />);
  await screen.findByText('Question A');
  expect(screen.getByText('Question B')).toBeInTheDocument();
  expect(screen.queryByText('Question C')).not.toBeInTheDocument();
});

test('theme and image placement edits preserve the preparation key and current page', async () => {
  const project = { preloadedImages: [] };
  const changed = { ...twoPageConfig, theme: { primaryColor: '#884422' }, viewportLayout: { desktop: { questions: { h1: { mediaLayout: { mode: 'grid', columns: 2 } } } } } };
  expect(previewSourceKey(changed, project)).toBe(previewSourceKey(twoPageConfig, project));
  const { rerender } = render(<SurveyPreview config={twoPageConfig} currentProject={project} />);
  await screen.findByText('First page body');
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  await screen.findByText('Second page body');
  rerender(<SurveyPreview config={changed} currentProject={project} />);
  expect(screen.getByText('Second page body')).toBeInTheDocument();
  expect(screen.queryByText('First page body')).not.toBeInTheDocument();
});
