import { listPreviewMedia, resolvePreviewMediaContext } from './previewMediaLibrary';
import { loadPreviewMediaLibrary } from './previewMediaLibraryStorage';
import { listImagesFromR2 } from './r2';
import { computePreviewMediaImportProgress, buildTemplateCopyTodo } from './templateImageImport';

jest.mock('./previewMediaLibraryStorage', () => ({ loadPreviewMediaLibrary: jest.fn() }));
jest.mock('./r2', () => ({ listImagesFromR2: jest.fn() }));
const entry = { key: 'skill-preview/a.jpg', name: 'a.jpg', url: 'https://media.test/a.jpg', logicalFolder: 'study/nested', folder: 'study/nested' };
beforeEach(() => {
  jest.resetAllMocks();
  loadPreviewMediaLibrary.mockResolvedValue({ revision: 2, preloadedImages: [entry], imageDatasetConfig: { mediaFolderTags: { study: 'category' }, mediaFolders: ['study/nested'] } });
});

test('empty projects load preview-library images together with category tags', async () => {
  const context = await resolvePreviewMediaContext({ preloadedImages: [], imageDatasetConfig: {} });
  expect(context.fromPreviewLibrary).toBe(true);
  expect(context.images[0].folder).toBe('study/nested');
  expect(context.imageDatasetConfig.mediaFolderTags).toEqual({ study: 'category' });
});

test('read-only previews use cloud organization and respect a deliberately empty library', async () => {
  expect((await listPreviewMedia())[0].folder).toBe('study/nested');
  expect(listImagesFromR2).not.toHaveBeenCalled();
  loadPreviewMediaLibrary.mockResolvedValue({ revision: 3, preloadedImages: [] });
  expect(await listPreviewMedia()).toEqual([]);
});

test('legacy previews remain usable before cloud initialization', async () => {
  loadPreviewMediaLibrary.mockRejectedValue(new Error('missing migration'));
  listImagesFromR2.mockResolvedValue({ success: true, images: [{ ...entry, logicalFolder: undefined, folder: '' }] });
  expect((await listPreviewMedia())[0].folder).toBe('');
});

test('project imports preserve logical subfolders and category tags', async () => {
  listImagesFromR2.mockImplementation(async (prefix) => ({ success: true,
    images: prefix === 'skill-preview/' ? [{ ...entry, logicalFolder: undefined, folder: '' }] : [],
  }));
  const progress = await computePreviewMediaImportProgress('u', 'p');
  expect(progress.error).toBeNull();
  expect(progress.mediaFolderConfig.mediaFolderTags).toEqual({ study: 'category' });
  expect(buildTemplateCopyTodo(progress.templateImages, progress.existingPaths, 'u/p/', progress.sourcePrefix))
    .toEqual([{ from: 'skill-preview/a.jpg', to: 'u/p/study/nested/a.jpg' }]);
});

test('imports stop when cloud metadata cannot be read instead of importing the original folders', async () => {
  listImagesFromR2.mockResolvedValue({ success: true, images: [entry] });
  loadPreviewMediaLibrary.mockRejectedValue(new Error('Network unavailable'));
  expect((await computePreviewMediaImportProgress('u', 'p')).error).toBe('Network unavailable');
});

test('legacy same-name files moved into one logical folder cannot overwrite each other on import', () => {
  const files = ['one', 'two'].map((folder) => ({ key: `skill-preview/${folder}/same.jpg`, name: 'same.jpg', logicalFolder: 'together' }));
  expect(() => buildTemplateCopyTodo(files, new Set(), 'u/p/', 'skill-preview/')).toThrow('Multiple source files');
});
