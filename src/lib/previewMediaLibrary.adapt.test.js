import { adaptQuestionForPreviewLibrary, adaptSurveyForPreviewLibrary } from './previewMediaLibrary';

const pool = [{ url: 'a.mp4', folder: 'videos/street' }, { url: 'b.jpg', folder: 'photos' }];

test('folder scopes missing from the preview library are dropped and repeats allowed', () => {
  const q = adaptQuestionForPreviewLibrary({ type: 'mediamatrix', name: 'q', mediaFolders: ['clips'], trialCount: 48 }, pool);
  expect(q.mediaFolders).toBeUndefined();
  expect(q.excludePreviouslyUsedImages).toBe(false);
  expect(adaptQuestionForPreviewLibrary({ type: 'imagepicker', mediaFolders: ['videos', 'clips'] }, pool).mediaFolders).toEqual(['videos']);
  expect(adaptQuestionForPreviewLibrary({ type: 'imagepicker', mediaAssignmentMode: 'set', mediaFolders: ['car-1'] }, pool).mediaFolders).toEqual(['car-1']);
});

test('whole survey is adapted, including nested panels', () => {
  const cfg = adaptSurveyForPreviewLibrary({ pages: [{ elements: [{ type: 'panel', name: 'p', elements: [{ type: 'imageannotation', name: 'm', mediaFolders: ['map'] }] }] }] }, pool);
  expect(cfg.pages[0].elements[0].elements[0].mediaFolders).toBeUndefined();
});
