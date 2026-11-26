import { planMediaUpload } from './spSchemeConvert';
import { uploadPlannedMedia } from './spSchemeMediaImport';

test('planned stimuli are uploaded per folder and saved into the project media list', async () => {
  const media = ['images/a.jpg', 'images/b.jpg', 'images/c.jpg'].map((path) => ({ path, bytes: new Uint8Array([1, 2]), size: 2 }));
  const plan = planMediaUpload(media, [{ folder: 'task_one', files: ['images/a.jpg', 'b.jpg'] }], 'sp-scheme/study');
  expect(plan.problems).toEqual([]);
  expect([...plan.folders.entries()].map(([rel, f]) => [rel, f.full, f.count])).toEqual([
    ['task_one', 'sp-scheme/study/task_one', 2],
    ['images', 'sp-scheme/study/images', 1],
  ]);
  const upload = jest.fn(async (file, key) => ({ success: true, url: `https://media.example/${key}` }));
  const onProjectUpdate = jest.fn(async () => {});
  const result = await uploadPlannedMedia({ plan, project: { id: 'p1', preloadedImages: [{ url: 'old' }] }, userId: 'u1', upload, onProjectUpdate });
  expect(result.failures).toEqual([]);
  expect(upload).toHaveBeenCalledTimes(3);
  expect(upload.mock.calls[0][1]).toMatch(/^u1\/p1\/sp-scheme\/study\/task_one\/a__/);
  const saved = onProjectUpdate.mock.calls.at(-1)[0];
  expect(saved.preloadedImages.map((m) => m.folder || m.url)).toEqual(['old', 'sp-scheme/study/task_one', 'sp-scheme/study/task_one', 'sp-scheme/study/images']);
});
