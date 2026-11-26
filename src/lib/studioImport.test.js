import { strToU8, zipSync } from 'fflate';
import { buildExampleSite, buildExampleZip, readSpSchemeUpload } from './spScheme';
import { prepareSpSchemeUpload } from './spSchemeImport';
import { importIntoStudio, sortPlannedMedia } from './studioImport';
import { createStudioProject, loadStudioProject, loadStudioRelease, removeStudioProject, saveStudioProject } from './studioData';
import { deleteImagesFromR2, uploadImageToR2 } from './r2';

// CRA resets mock implementations before each test; they are set in beforeEach.
jest.mock('./studioData', () => ({
  createStudioProject: jest.fn(),
  loadStudioProject: jest.fn(),
  loadStudioRelease: jest.fn(),
  removeStudioProject: jest.fn(),
  saveStudioProject: jest.fn(),
}));
jest.mock('./r2', () => ({
  uploadImageToR2: jest.fn(),
  deleteImagesFromR2: jest.fn(),
  projectR2Prefix: (userId, projectId) => (userId && projectId ? `${userId}/${projectId}/` : ''),
  r2KeyFromUrl: () => null,
}));

const prepare = (bytes, name) => prepareSpSchemeUpload(readSpSchemeUpload(bytes), { name });

function zipWithImages() {
  return zipSync({
    'study/index.html': strToU8(buildExampleSite()),
    'study/images/a.jpg': new Uint8Array([1, 2, 3]),
    'study/images/b.jpg': new Uint8Array([4, 5, 6]),
  });
}

beforeEach(() => {
  removeStudioProject.mockResolvedValue({ success: true });
  loadStudioRelease.mockResolvedValue(undefined);
  saveStudioProject.mockResolvedValue({ success: true });
  deleteImagesFromR2.mockResolvedValue({ success: true });
  createStudioProject.mockResolvedValue({ success: true, project: { id: 'p1', name: 'Street perception study' }, surveyConfig: { title: 'x', pages: [] } });
  loadStudioProject.mockResolvedValue({ id: 'p1', name: 'Street perception study', preloadedImages: [], _surveyConfig: { title: 'x', pages: [], theme: { primaryColor: '#123456' } } });
  uploadImageToR2.mockImplementation((file, key) => Promise.resolve({ success: true, url: `https://media.test/${key}`, key }));
});

test('the example becomes a new project named after the page, saved once', async () => {
  const result = await importIntoStudio({ prepared: prepare(buildExampleZip(), 'example.zip'), userId: 'u1', fallbackName: 'New study' });
  expect(result).toMatchObject({ projectId: 'p1', created: true });
  expect(createStudioProject).toHaveBeenCalledWith('Street perception study');
  expect(saveStudioProject).toHaveBeenCalledTimes(1);
  const [project, config] = saveStudioProject.mock.calls[0];
  expect(project.id).toBe('p1');
  expect(config.spSite.html).toContain('SPSite.onReady');
  expect(config.theme.primaryColor).toBe('#123456');
  expect(uploadImageToR2).not.toHaveBeenCalled();
});

test('images in the zip are uploaded first, then config and media list are saved together', async () => {
  const prepared = prepare(zipWithImages(), 'study.zip');
  const progress = [];
  await importIntoStudio({ prepared, userId: 'u1', onProgress: (p) => progress.push(p) });
  expect(uploadImageToR2).toHaveBeenCalledTimes(2);
  expect(uploadImageToR2.mock.calls[0][1]).toMatch(/^u1\/p1\/images\/a__.+\.jpg$/);
  expect(saveStudioProject).toHaveBeenCalledTimes(1);
  const [project, config] = saveStudioProject.mock.calls[0];
  expect(project.preloadedImages.map((e) => e.folder)).toEqual(['images', 'images']);
  expect(project.preloadedSource).toBe('r2');
  expect(config.spSite.mediaFolders).toEqual(['images']);
  expect(progress[progress.length - 1]).toEqual({ done: 2, total: 2 });
});

test('a failed image imports nothing: uploaded files are removed and the new project deleted', async () => {
  uploadImageToR2
    .mockImplementationOnce((file, key) => Promise.resolve({ success: true, url: `https://media.test/${key}`, key }))
    .mockImplementationOnce(() => Promise.resolve({ success: false, error: 'network down' }));
  await expect(importIntoStudio({ prepared: prepare(zipWithImages(), 'study.zip'), userId: 'u1' }))
    .rejects.toMatchObject({ code: 'media', failures: [expect.objectContaining({ error: 'network down' })] });
  expect(saveStudioProject).not.toHaveBeenCalled();
  expect(deleteImagesFromR2).toHaveBeenCalledWith([expect.stringMatching(/^u1\/p1\/images\/a__/)], { allowedPrefix: 'u1/p1/' });
  expect(removeStudioProject).toHaveBeenCalledWith('p1');
});

test('replacing the page of an existing project works on what is stored now and keeps its settings', async () => {
  const stale = { id: 'p9', name: 'Old name', preloadedImages: [], _surveyConfig: { pages: [] } };
  loadStudioProject.mockResolvedValueOnce({ id: 'p9', name: 'Mine', preloadedImages: [{ url: 'https://x/old.jpg', name: 'old.jpg' }], _surveyConfig: { pages: [], responseQuota: 50 } });
  const result = await importIntoStudio({ prepared: prepare(buildExampleZip(), 'example.zip'), project: stale, userId: 'u1' });
  expect(result).toMatchObject({ projectId: 'p9', created: false, uploaded: 0, unchanged: 0, replaced: 0 });
  expect(loadStudioProject).toHaveBeenCalledWith('p9');
  expect(createStudioProject).not.toHaveBeenCalled();
  const [project, config] = saveStudioProject.mock.calls[0];
  expect(project.name).toBe('Mine');
  expect(project.preloadedImages).toHaveLength(1);
  expect(config.responseQuota).toBe(50);
});

test('a new index.html without folders keeps the folders the old page was linked to', async () => {
  loadStudioProject.mockResolvedValueOnce({
    id: 'p9',
    name: 'Mine',
    preloadedImages: [],
    _surveyConfig: { pages: [], spSite: { html: '<p>old</p>', id: 'old', mediaFolders: ['images'] } },
  });
  const html = '<!doctype html><html><head><title>t</title></head><body><script>const photos = SPSite.getMedia("images");</script></body></html>';
  await importIntoStudio({ prepared: prepare(strToU8(html), 'index.html'), project: { id: 'p9' }, userId: 'u1' });
  const [, config] = saveStudioProject.mock.calls[0];
  expect(config.spSite.html).toContain('SPSite.getMedia("images")');
  expect(config.spSite.mediaFolders).toEqual(['images']);
});

test('dropping the same zip again: same file skipped, changed file replaced in the same save', async () => {
  const library = [
    { url: 'https://media.test/u1/p9/images/a__1.jpg', name: 'a.jpg', key: 'u1/p9/images/a__1.jpg', folder: 'images', logicalFolder: 'images', original_bytes: 3 },
    { url: 'https://media.test/u1/p9/images/b__1.jpg', name: 'b.jpg', key: 'u1/p9/images/b__1.jpg', folder: 'images', logicalFolder: 'images', original_bytes: 99 },
    { url: 'https://media.test/u1/p9/other/b__2.jpg', name: 'b.jpg', key: 'u1/p9/other/b__2.jpg', folder: 'other', logicalFolder: 'other', original_bytes: 99 },
  ];
  loadStudioProject.mockResolvedValueOnce({ id: 'p9', name: 'Mine', preloadedImages: library, _surveyConfig: { pages: [] } });
  const calls = [];
  saveStudioProject.mockImplementationOnce(() => { calls.push('save'); return Promise.resolve({ success: true }); });
  deleteImagesFromR2.mockImplementationOnce((keys) => { calls.push(['delete', keys]); return Promise.resolve({ success: true }); });
  const result = await importIntoStudio({ prepared: prepare(zipWithImages(), 'study.zip'), project: { id: 'p9' }, userId: 'u1' });
  // a.jpg has the same folder, name and size; images/b.jpg has another size, so it replaces the old one.
  expect(result).toMatchObject({ uploaded: 0, unchanged: 1, replaced: 1 });
  expect(uploadImageToR2).toHaveBeenCalledTimes(1);
  expect(uploadImageToR2.mock.calls[0][1]).toMatch(/^u1\/p9\/images\/b__.+\.jpg$/);
  const [project, config] = saveStudioProject.mock.calls[0];
  expect(project.preloadedImages.map((e) => `${e.folder}/${e.name}`)).toEqual(['images/a.jpg', 'other/b.jpg', 'images/b.jpg']);
  expect(project.preloadedImages[2].key).not.toBe('u1/p9/images/b__1.jpg');
  expect(config.spSite.mediaFolders).toEqual(['images']);
  // The old file is deleted only after the save.
  expect(calls).toEqual(['save', ['delete', ['u1/p9/images/b__1.jpg']]]);
  expect(deleteImagesFromR2).toHaveBeenCalledWith(['u1/p9/images/b__1.jpg'], { allowedPrefix: 'u1/p9/' });
});

test('a replaced file the published version still uses is kept in storage', async () => {
  const old = { url: 'https://media.test/u1/p9/images/b__1.jpg', name: 'b.jpg', key: 'u1/p9/images/b__1.jpg', logicalFolder: 'images', original_bytes: 99 };
  loadStudioProject.mockResolvedValueOnce({ id: 'p9', name: 'Mine', releaseManaged: true, preloadedImages: [old], _surveyConfig: { pages: [] } });
  loadStudioRelease.mockResolvedValueOnce({ config: {}, media: { preloadedImages: [old] } });
  const result = await importIntoStudio({ prepared: prepare(zipWithImages(), 'study.zip'), project: { id: 'p9' }, userId: 'u1' });
  expect(result).toMatchObject({ uploaded: 1, unchanged: 0, replaced: 1 });
  expect(saveStudioProject.mock.calls[0][0].preloadedImages.map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
  expect(deleteImagesFromR2).not.toHaveBeenCalled();
});

test('a failed save keeps the old files and removes the new ones', async () => {
  const old = { url: 'https://media.test/u1/p9/images/b__1.jpg', name: 'b.jpg', key: 'u1/p9/images/b__1.jpg', logicalFolder: 'images', original_bytes: 99 };
  loadStudioProject.mockResolvedValueOnce({ id: 'p9', name: 'Mine', preloadedImages: [old], _surveyConfig: { pages: [] } });
  saveStudioProject.mockResolvedValueOnce({ success: false, error: 'offline' });
  await expect(importIntoStudio({ prepared: prepare(zipWithImages(), 'study.zip'), project: { id: 'p9' }, userId: 'u1' })).rejects.toMatchObject({ code: 'save' });
  expect(deleteImagesFromR2).toHaveBeenCalledTimes(1);
  const [keys] = deleteImagesFromR2.mock.calls[0];
  expect(keys).toHaveLength(2);
  expect(keys).not.toContain('u1/p9/images/b__1.jpg');
  expect(removeStudioProject).not.toHaveBeenCalled();
});

test('sortPlannedMedia: folder and file name are the identity, size tells if the file changed', () => {
  const file = (path, size) => ({ path, folder: path.split('/').slice(0, -1).join('/'), bytes: new Uint8Array(size) });
  const plan = { files: [file('images/a.jpg', 3), file('images/b.jpg', 4), file('images/c.jpg', 5), file('more/a.jpg', 3)] };
  const library = [
    { url: 'u1', name: 'a.jpg', logicalFolder: 'images', original_bytes: 3 },
    { url: 'u2', name: 'b.jpg', logicalFolder: 'images', original_bytes: 9 },
    { url: 'u3', name: 'C.jpg', logicalFolder: 'images', original_bytes: 5 },
  ];
  const sorted = sortPlannedMedia(plan, library);
  expect(sorted).toMatchObject({ uploaded: 2, unchanged: 1, replaced: 1 });
  expect(sorted.plan.files.map((f) => f.path)).toEqual(['images/b.jpg', 'images/c.jpg', 'more/a.jpg']);
  expect(sorted.oldEntries.map((e) => e.url)).toEqual(['u2']);
  // A library entry without a size cannot be proven equal, so the new file replaces it.
  expect(sortPlannedMedia({ files: [file('images/a.jpg', 3)] }, [{ url: 'u', name: 'a.jpg', logicalFolder: 'images' }])).toMatchObject({ replaced: 1, unchanged: 0 });
  expect(sortPlannedMedia(plan, [])).toMatchObject({ plan, uploaded: 4, unchanged: 0, replaced: 0 });
  expect(sortPlannedMedia(null, library)).toEqual({ plan: null, uploaded: 0, unchanged: 0, replaced: 0, oldEntries: [] });
});

test('a failed save deletes the project created for the import', async () => {
  saveStudioProject.mockResolvedValueOnce({ success: false, error: 'offline' });
  await expect(importIntoStudio({ prepared: prepare(buildExampleZip(), 'example.zip'), userId: 'u1' })).rejects.toMatchObject({ code: 'save' });
  expect(removeStudioProject).toHaveBeenCalledWith('p1');
});

test('an upload that cannot be imported writes nothing', async () => {
  const prepared = prepare(strToU8('{"format":"sp-scheme-package","spScheme":"2.0","survey":{}}'), 'bad.json');
  expect(prepared.report.ok).toBe(false);
  await expect(importIntoStudio({ prepared, userId: 'u1' })).rejects.toMatchObject({ code: 'invalid' });
  expect(createStudioProject).not.toHaveBeenCalled();
  expect(saveStudioProject).not.toHaveBeenCalled();
});
