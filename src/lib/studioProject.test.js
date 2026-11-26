import {
  appendUploadedMedia,
  cleanFolderName,
  defaultUploadFolder,
  importedProjectName,
  libraryFolders,
  libraryThumbnails,
  linkUploadFolder,
  looseFileCount,
  missingPageFolders,
  pageFolders,
  pageForAiText,
  pageHtmlForAi,
  pageUsesFolders,
  projectKind,
  projectStatus,
  releaseHasChanges,
  sortProjectsNewestFirst,
  surveyImageNeed,
} from './studioProject';
import { buildExampleSite, buildExampleZip, readSpSchemeUpload } from './spScheme';
import { finalizeSpSchemeImport, prepareSpSchemeUpload } from './spSchemeImport';

const page = (html, extra = {}) => ({ pages: [], spSite: { html, id: 'site-1', ...extra } });

test('tells an AI page from a classic survey and an empty project', () => {
  expect(projectKind({ _surveyConfig: page('<p>x</p>') })).toBe('page');
  expect(projectKind({ _surveyConfig: { pages: [{ elements: [{ type: 'text', name: 'q' }] }] } })).toBe('classic');
  expect(projectKind({ _surveyConfig: { pages: [{ elements: [] }] } })).toBe('empty');
  expect(projectKind({})).toBe('empty');
  expect(projectKind(page('<p>x</p>'))).toBe('page');
});

test('a project that is not release-managed is live as soon as it has a page or questions', () => {
  expect(projectStatus({})).toEqual({ state: 'draft', version: 0 });
  expect(projectStatus({ releaseManaged: false, _surveyConfig: { pages: [] } })).toEqual({ state: 'draft', version: 0 });
  expect(projectStatus({ releaseManaged: false, publishedVersion: 2, _surveyConfig: page('<p>x</p>') })).toEqual({ state: 'live', version: 0 });
  expect(projectStatus({ _surveyConfig: { pages: [{ elements: [{ type: 'text', name: 'q' }] }] } })).toEqual({ state: 'live', version: 0 });
});

test('changes waiting compare the draft with the published version, never the clocks', () => {
  const config = page('<p>x</p>');
  const images = [{ url: 'https://m/a.jpg', key: 'u1/p1/a.jpg', name: 'a.jpg' }];
  const published = { config, media: { preloadedImages: images, imageDatasetConfig: { mediaFolderTags: {} } } };
  // The draft clock is behind the publish clock (a slow browser clock), and a rename moved it again: no changes.
  const project = {
    releaseManaged: true,
    publishedVersion: 3,
    publishedAt: '2026-01-02T10:00:00Z',
    draftUpdatedAt: '2026-01-01T10:00:00Z',
    preloadedImages: images,
    imageDatasetConfig: { mediaFolderTags: {}, huggingFaceToken: 'secret' },
    _surveyConfig: config,
  };
  expect(projectStatus(project, published)).toEqual({ state: 'published', version: 3 });
  expect(projectStatus({ ...project, draftUpdatedAt: '2026-03-01T10:00:00Z', name: 'Renamed' }, published).state).toBe('published');
  // A changed page, a new image or new media settings are changes participants do not see yet.
  expect(projectStatus({ ...project, _surveyConfig: page('<p>y</p>') }, published)).toEqual({ state: 'pending', version: 3 });
  expect(releaseHasChanges(published, { ...project, preloadedImages: [...images, { url: 'https://m/b.jpg', key: 'u1/p1/b.jpg' }] })).toBe(true);
  expect(releaseHasChanges(published, { ...project, imageDatasetConfig: { mediaFolderTags: { x: 'set' } } })).toBe(true);
  // Not known yet: counts as published.
  expect(projectStatus(project)).toEqual({ state: 'published', version: 3 });
});

test('projects are listed newest first', () => {
  const list = sortProjectsNewestFirst([
    { id: 'a', lastModified: '2026-01-01T00:00:00Z' },
    { id: 'b', lastModified: '2026-03-01T00:00:00Z' },
    { id: 'c' },
    { name: 'no id' },
  ]);
  expect(list.map((p) => p.id)).toEqual(['b', 'a', 'c']);
});

test('the folders a page reads, and which of them are still empty', () => {
  const config = page('<script>SPSite.getMedia("streets"); SPSite.getMedia(\'\')</script>', { mediaFolders: ['practice', '/'] });
  expect(pageFolders(config).sort()).toEqual(['practice', 'streets']);
  const project = {
    id: 'p1',
    userId: 'u1',
    preloadedImages: [
      { url: 'https://m/u1/p1/streets/a.jpg', name: 'a.jpg', key: 'u1/p1/streets/a.jpg', folder: 'streets', type: 'image' },
      { url: 'https://m/u1/p1/streets/b.jpg', name: 'b.jpg', key: 'u1/p1/streets/b.jpg', folder: 'streets', type: 'image' },
      { url: 'https://m/u1/p1/c.jpg', name: 'c.jpg', key: 'u1/p1/c.jpg', type: 'image' },
    ],
  };
  expect(missingPageFolders(project, config)).toEqual([
    { folder: 'streets', reason: 'unlinked' },
    { folder: 'practice', reason: 'empty' },
  ]);
  expect(libraryFolders(project)).toEqual([{ folder: 'streets', count: 2 }]);
  expect(looseFileCount(project)).toBe(1);
  expect(libraryThumbnails(project, 2).map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
  expect(defaultUploadFolder(config)).toBe('practice');
  expect(defaultUploadFolder({ pages: [] })).toBe('images');
});

test('typed folder names stay inside the project', () => {
  expect(cleanFolderName(' streets / set 1 ')).toBe('streets/set_1');
  expect(cleanFolderName('../../other-user/x')).toBe('other-user/x');
  expect(cleanFolderName('街景/图片')).toBe('街景/图片');
  expect(cleanFolderName('<script>')).toBe('script');
  expect(cleanFolderName('...')).toBe('');
});

test('a new project is named after the page title, else a useful file name', () => {
  expect(importedProjectName({ title: 'Street study', name: 'x.zip' }, 'New')).toBe('Street study');
  expect(importedProjectName({ title: '', name: 'walkability.zip' }, 'New')).toBe('walkability');
  expect(importedProjectName({ title: '', name: 'index.html + 2' }, 'New')).toBe('New');
  expect(importedProjectName({ title: '', name: 'index.html' }, 'New')).toBe('New');
  expect(importedProjectName({}, 'New')).toBe('New');
});

test('the text for an AI to edit holds the spec and the current page', () => {
  const text = pageForAiText('SPEC', '<html>page</html>');
  expect(text.startsWith('SPEC')).toBe(true);
  expect(text).toContain('```html\n<html>page</html>\n```');
});

test('missing folders follow what the participant page is actually given', () => {
  const streets = [{ url: 'https://m/u1/p1/streets/a.jpg', name: 'a.jpg', key: 'u1/p1/streets/a.jpg', folder: 'streets', type: 'image' }];
  const project = { id: 'p1', userId: 'u1', preloadedImages: streets };
  // getMedia("streets") with files in streets, but the folder is not linked: the page gets nothing.
  const reads = page('<script>SPSite.getMedia("streets")</script>');
  expect(missingPageFolders(project, reads)).toEqual([{ folder: 'streets', reason: 'unlinked' }]);
  expect(missingPageFolders({ ...project, preloadedImages: [] }, reads)).toEqual([{ folder: 'streets', reason: 'empty' }]);
  const linked = page('<script>SPSite.getMedia("streets")</script>', { mediaFolders: ['streets'] });
  expect(missingPageFolders(project, linked)).toEqual([]);
  // A page with an empty image list of its own and no folder linked is only given the library root.
  const slots = page('<script>const PHOTO_URLS = [];</script>');
  expect(missingPageFolders(project, slots)).toEqual([{ folder: '', reason: 'slots' }]);
  const root = [{ url: 'https://m/u1/p1/x.jpg', name: 'x.jpg', key: 'u1/p1/x.jpg', folder: '', logicalFolder: '', type: 'image' }];
  expect(missingPageFolders({ ...project, preloadedImages: root }, slots)).toEqual([]);
  expect(missingPageFolders(project, page('<script>const PHOTO_URLS = [];</script>', { mediaFolders: ['streets'] }))).toEqual([]);
  expect(missingPageFolders(project, { pages: [] })).toEqual([]);
});

test('uploading into a folder the page reads links it to the page', () => {
  const reads = page('<script>SPSite.getMedia("streets")</script>');
  expect(linkUploadFolder(reads, 'streets').spSite.mediaFolders).toEqual(['streets']);
  expect(linkUploadFolder(reads, 'other')).toBe(reads);
  const linked = page('<script>SPSite.getMedia("streets")</script>', { mediaFolders: ['streets'] });
  expect(linkUploadFolder(linked, 'streets')).toBe(linked);
  // Empty image list and no folder linked: the target folder fills it.
  const slots = page('<script>const PHOTO_URLS = [];</script>');
  expect(linkUploadFolder(slots, 'images').spSite.mediaFolders).toEqual(['images']);
  expect(linkUploadFolder(page('<script>const PHOTO_URLS = [];</script>', { mediaFolders: ['a'] }), 'images').spSite.mediaFolders).toEqual(['a']);
  const classic = { pages: [{ elements: [{ type: 'text', name: 'q' }] }] };
  expect(linkUploadFolder(classic, 'images')).toBe(classic);
});

test('the folder of an upload only matters when the page reads folders', () => {
  expect(pageUsesFolders(page('<script>SPSite.getMedia("streets")</script>'))).toBe(true);
  expect(pageUsesFolders(page('<script>SPSite.getMedia(name)</script>'))).toBe(true);
  expect(pageUsesFolders(page('<script>const PHOTO_URLS = [];</script>'))).toBe(true);
  expect(pageUsesFolders(page('<p>x</p>', { mediaFolders: ['a'] }))).toBe(true);
  expect(pageUsesFolders(page('<p>x</p>'))).toBe(false);
  expect(pageUsesFolders({ pages: [{ elements: [{ type: 'text', name: 'q' }] }] })).toBe(false);
});

test('uploaded entries are added once to the fresh media list', () => {
  const a = { url: 'https://m/a.jpg', key: 'k/a' };
  const b = { url: 'https://m/b.jpg', key: 'k/b' };
  expect(appendUploadedMedia([a], [a, b])).toEqual([a, b]);
  expect(appendUploadedMedia(undefined, [b])).toEqual([b]);
});

test('the example needs images the platform draws for it', () => {
  const read = readSpSchemeUpload(buildExampleZip());
  const prepared = prepareSpSchemeUpload(read, { name: 'example.zip' });
  const config = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
  expect(surveyImageNeed(config)).toBeGreaterThan(0);
  expect(surveyImageNeed({ pages: [{ elements: [{ type: 'text', name: 'q' }] }] })).toBe(0);
  expect(surveyImageNeed({ pages: [{ elements: [{ type: 'imagepicker', name: 'q', imageCount: 4, randomImageSelection: true, choices: [] }] }] })).toBe(4);
});

test('a page imported as it is goes back to the AI without the blocks the platform added', () => {
  const html = '<html><head>\n<script type="application/json" id="sp-scheme">\n{"format":"sp-scheme-package"}\n</script>\n<script type="application/json" id="sp-data">\n{}\n</script>\n<title>t</title></head><body>hi</body></html>';
  const asIs = pageHtmlForAi({ html, convertedFrom: 'index.html' });
  expect(asIs).not.toContain('sp-scheme');
  expect(asIs).not.toContain('sp-data');
  expect(asIs).toContain('<title>t</title>');
  expect(pageHtmlForAi({ html, convertedFrom: 'index.html', originalHtml: '<p>original</p>' })).toBe('<p>original</p>');
  // A page that follows SP-Scheme keeps its own declaration.
  expect(pageHtmlForAi({ html })).toBe(html);
  expect(pageHtmlForAi({ html: buildExampleSite() })).toContain('id="sp-scheme"');
});
