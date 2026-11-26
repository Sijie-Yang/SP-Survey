import { buildExampleZip, readSpSchemeUpload } from './spScheme';
import { finalizeSpSchemeImport, prepareSpSchemeUpload } from './spSchemeImport';
import { studioPublishProblems } from './studioPublish';

test('an empty project cannot be published', async () => {
  expect(await studioPublishProblems({ id: 'p1' }, { pages: [{ name: 'p', elements: [] }] })).toEqual([{ code: 'empty' }]);
});

test('a page whose image folder is empty or not linked cannot be published', async () => {
  const config = { pages: [], spSite: { html: '<script>SPSite.getMedia("streets")</script>', id: 's' } };
  expect(await studioPublishProblems({ id: 'p1', preloadedImages: [] }, config)).toEqual([{ code: 'folder-empty', folder: 'streets' }]);
  const withImages = { id: 'p1', preloadedImages: [{ url: 'https://m/a.jpg', name: 'a.jpg', folder: 'streets' }] };
  // The files are there, but the page is not given the folder until it is linked.
  expect(await studioPublishProblems(withImages, config)).toEqual([{ code: 'folder-unlinked', folder: 'streets' }]);
  const linked = { ...config, spSite: { ...config.spSite, mediaFolders: ['streets'] } };
  expect(await studioPublishProblems(withImages, linked)).toEqual([]);
});

test('a page with an empty image list of its own needs images', async () => {
  const config = { pages: [], spSite: { html: '<script>const PHOTO_URLS = [];</script>', id: 's' } };
  expect(await studioPublishProblems({ id: 'p1', preloadedImages: [] }, config)).toEqual([{ code: 'slots-empty', folder: '' }]);
});

test('the example page cannot be published with an empty image library', async () => {
  const read = readSpSchemeUpload(buildExampleZip());
  const prepared = prepareSpSchemeUpload(read, { name: 'example.zip' });
  const config = finalizeSpSchemeImport(prepared.report, prepared.upload, {});
  expect(config.spSite.html).toBeTruthy();
  const problems = await studioPublishProblems({ id: 'p1', preloadedImages: [] }, config);
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.every((p) => p.code === 'media')).toBe(true);
  const images = Array.from({ length: 12 }, (_, i) => ({ url: `https://m/u1/p1/images/${i}.jpg`, name: `${i}.jpg`, key: `u1/p1/images/${i}.jpg`, folder: 'images', type: 'image' }));
  expect(await studioPublishProblems({ id: 'p1', userId: 'u1', preloadedImages: images }, config)).toEqual([]);
});

test('a classic survey runs the participant check', async () => {
  const config = { pages: [{ name: 'p', elements: [{ type: 'imagepicker', name: 'q1', title: 'Pick one', choices: [], imageCount: 2 }] }] };
  const problems = await studioPublishProblems({ id: 'p1', preloadedImages: [] }, config);
  expect(problems.some((p) => p.code === 'media' && p.question === 'Pick one')).toBe(true);
  const fine = await studioPublishProblems({ id: 'p1' }, { pages: [{ name: 'p', elements: [{ type: 'text', name: 'q1', title: 'Name' }] }] });
  expect(fine).toEqual([]);
});
