import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import {
  resolveTemplateCover,
  describeTemplateCover,
  resolveTemplateCoverStatus,
  coverSourceDetail,
  COVER_SOURCE_LABELS,
  DEFAULT_TEMPLATE_COVER,
  TemplateCoverStatus,
} from './templateCover';

test('cover file wins over the media library and the preset library', () => {
  expect(resolveTemplateCover({
    id: 'study',
    thumbnail_url: 'https://chosen.example/thumb.jpg',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, {
    coverFile: 'study.jpg',
    presetUrls: ['/preset.jpg'],
  })).toBe('/project_templates/cover_images/study.jpg');
});

test('a chosen thumbnail is used before a random library image', () => {
  expect(resolveTemplateCover({
    id: 'study',
    thumbnail_url: 'https://chosen.example/thumb.jpg',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, { presetUrls: ['/preset.jpg'] })).toBe('https://chosen.example/thumb.jpg');
});

test('the template media library is used when no cover file is stored', () => {
  expect(resolveTemplateCover({
    id: 'study',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, {
    extraLibraryUrls: ['https://bundled.example/b.jpg'],
    presetUrls: ['/preset.jpg'],
  })).toBe('https://lib.example/a.jpg');
});

test('bundled library images are used when the template database has none', () => {
  expect(resolveTemplateCover({ id: 'study' }, {
    extraLibraryUrls: ['https://bundled.example/b.jpg'],
    presetUrls: ['/preset.jpg'],
  })).toBe('https://bundled.example/b.jpg');
});

test('the preset library is used only when the template library is empty', () => {
  expect(resolveTemplateCover({ id: 'study' }, { presetUrls: ['/preset.jpg'] })).toBe('/preset.jpg');
  expect(resolveTemplateCover({ id: 'study' })).toBe(DEFAULT_TEMPLATE_COVER);
});

test('a registered cover file is named as the landing source', () => {
  const status = describeTemplateCover({
    id: '1990-nasar-evaluative',
    thumbnail_url: 'https://chosen.example/thumb.jpg',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, {
    coverFile: '1990-nasar-evaluative.svg',
    presetUrls: ['/preset.jpg'],
  });
  expect(status.source).toBe('coverFile');
  expect(status.url).toBe('/project_templates/cover_images/1990-nasar-evaluative.svg');
  expect(status.candidates[0]).toBe(status.url);
  expect(coverSourceDetail(status)).toContain('1990-nasar-evaluative.svg');
});

test('fallback sources stay in order when no cover file is registered', () => {
  expect(describeTemplateCover({
    id: 'study',
    thumbnail_url: 'https://chosen.example/thumb.jpg',
  }).source).toBe('thumbnail');
  expect(describeTemplateCover({
    id: 'study',
    preloadedImages: [{ url: 'https://lib.example/a.jpg', type: 'image' }],
  }, { presetUrls: ['/preset.jpg'] }).source).toBe('library');
  expect(describeTemplateCover({ id: 'study' }, {
    extraLibraryUrls: ['https://bundled.example/b.jpg'],
    presetUrls: ['/preset.jpg'],
  }).source).toBe('bundled');
  expect(describeTemplateCover({ id: 'study' }, { presetUrls: ['/preset.jpg'] }).source).toBe('preset');
  expect(describeTemplateCover({ id: 'study' }).source).toBe('default');
});

test('a cover file skips the bundled library lookup', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) });
  const status = await resolveTemplateCoverStatus({
    id: 'cover-file-only',
    thumbnail_url: 'https://chosen.example/thumb.jpg',
  }, ['/preset.jpg'], { 'cover-file-only': 'study.jpg' });
  expect(status.source).toBe('coverFile');
  expect(status.url).toBe('/project_templates/cover_images/study.jpg');
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockRestore();
});

test('bundled template images are used when the database library is empty', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (String(url).endsWith('/images.json')) {
      return { ok: true, json: async () => ({ images: ['scene.jpg'] }) };
    }
    return { ok: false, json: async () => ({}) };
  });
  const status = await resolveTemplateCoverStatus({ id: 'bundled-cover-study' }, ['/preset.jpg'], {});
  expect(status.source).toBe('bundled');
  expect(status.url).toBe('/project_templates/bundled-cover-study/scene.jpg');
  fetchMock.mockRestore();
});

test('the admin cover mark shows a registered cover file', () => {
  render(
    <TemplateCoverStatus
      testId="template-cover-1990-nasar-evaluative"
      status={{
        source: 'coverFile',
        url: '/project_templates/cover_images/1990-nasar-evaluative.svg',
        candidates: ['/project_templates/cover_images/1990-nasar-evaluative.svg'],
        coverFile: '1990-nasar-evaluative.svg',
      }}
    />,
  );
  const mark = screen.getByTestId('template-cover-1990-nasar-evaluative');
  expect(mark).toHaveAttribute('data-cover-source', 'coverFile');
  expect(screen.getByRole('img')).toHaveAttribute('src', '/project_templates/cover_images/1990-nasar-evaluative.svg');
  expect(screen.getByText(COVER_SOURCE_LABELS.coverFile)).toBeInTheDocument();
});
