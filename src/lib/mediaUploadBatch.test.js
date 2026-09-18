import { uploadMediaBatch, uploadObjectKey, pickUploadMedia } from './mediaUploadBatch';
const file = (name = 'scene.jpg') => ({ name, size: 12 });
function setup(overrides = {}) {
  let id = 0;
  return { files: [file(), file()], prefix: 'owner/project/', folder: 'set1',
    prepare: async (raw) => raw, makeId: () => String(++id),
    upload: jest.fn(async (_file, key) => ({ success: true, url: `https://media.test/${key}` })),
    persist: jest.fn(async () => {}), ...overrides };
}
test('same names and names with sanitized collisions always have distinct immutable keys', async () => {
  const options = setup({ files: [file('a b.jpg'), file('a_b.jpg'), file('a b.jpg')] });
  const result = await uploadMediaBatch(options);
  expect(new Set(result.uploaded.map((m) => m.key)).size).toBe(3);
  expect(result.uploaded.map((m) => m.name)).toEqual(['a b.jpg', 'a_b.jpg', 'a b.jpg']);
  expect(uploadObjectKey('p/', 'set/a', '中文.jpg', 'id')).toBe('p/set/a/____id.jpg');
});
test('failed files remain retryable and other files continue after a thrown network error', async () => {
  const options = setup({ upload: jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ success: true, url: '/ok.jpg' }) });
  const result = await uploadMediaBatch(options);
  expect(result.failures[0]).toMatchObject({ file: options.files[0], error: 'Offline' });
  expect(result.uploaded).toHaveLength(1);
  expect(result.pending).toHaveLength(0);
  expect(options.persist).toHaveBeenCalledWith(result.uploaded);
});
test('checkpoint failure preserves uploaded entries and stops before unsaved work grows', async () => {
  const options = setup({ files: Array.from({ length: 12 }, () => file()), persist: jest.fn().mockRejectedValue(new Error('Save denied')) });
  const result = await uploadMediaBatch(options);
  expect(result.uploaded).toHaveLength(10);
  expect(result.pending).toHaveLength(2);
  expect(result.saveError).toBe('Save denied');
  expect(options.upload).toHaveBeenCalledTimes(10);
});
test('reject empty, unsupported and oversized files before upload; record transformations', async () => {
  const options = setup({ files: [{ name: 'a.jpg', size: 0 }, file('a.exe'), { name: 'big.mp4', size: 41 * 1024 * 1024 }, file('ok.png')], prepare: async () => ({ name: 'ok.jpg', size: 6 }) });
  const result = await uploadMediaBatch(options);
  expect(result.failures).toHaveLength(3);
  expect(options.upload).toHaveBeenCalledTimes(1);
  expect(result.uploaded[0]).toMatchObject({ name: 'ok.png', original_bytes: 12, uploaded_bytes: 6, image_compressed: true });
});
test('leaving a project stops new uploads but saves the completed files', async () => {
  let stop = false;
  const options = setup({ shouldStop: () => stop, onProgress: () => { stop = true; } });
  const result = await uploadMediaBatch(options);
  expect(result.uploaded).toHaveLength(1);
  expect(result.pending).toEqual([options.files[1]]);
  expect(options.persist).toHaveBeenCalledWith(result.uploaded);
});

test('directory uploads preserve their root and nested folders before image conversion', async () => {
  const options = setup({ folder: 'archive', files: [
    { ...file('scene.png'), webkitRelativePath: '实验素材/街道/scene.png' },
    { ...file('scene.png'), webkitRelativePath: '实验素材/公园/scene.png' },
  ], prepare: async () => ({ name: 'scene.jpg', size: 6 }) });
  const result = await uploadMediaBatch(options);
  expect(result.uploaded.map((m) => m.folder)).toEqual(['archive/实验素材/街道', 'archive/实验素材/公园']);
  expect(result.uploaded[0]).toMatchObject({ name: 'scene.png', logicalFolder: 'archive/实验素材/街道', image_compressed: true });
  expect(result.uploaded[0].key).toBe('owner/project/archive/实验素材/街道/scene__1.jpg');
  expect(options.persist).toHaveBeenCalledWith(result.uploaded);
});
test('directory retries preserve the original relative path without uploading successful files twice', async () => {
  const raw = { ...file(), webkitRelativePath: 'Study/group/a/scene.jpg' };
  const first = await uploadMediaBatch(setup({ files: [raw, file('ok.jpg')], upload: jest.fn()
    .mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ success: true, url: '/ok.jpg' }) }));
  expect(first.failures[0].name).toBe('Study/group/a/scene.jpg');
  const retry = setup({ files: first.failures.map((f) => f.file), folder: '' });
  const result = await uploadMediaBatch(retry);
  expect(retry.upload).toHaveBeenCalledTimes(1);
  expect(result.uploaded[0].folder).toBe('Study/group/a');
});
test('invalid relative directories are rejected before upload', async () => {
  const options = setup({ files: [{ ...file(), webkitRelativePath: 'study/../scene.jpg' }] });
  const result = await uploadMediaBatch(options);
  expect(options.upload).not.toHaveBeenCalled();
  expect(result.failures[0].error).toBe('Invalid relative file path');
});

test('directory selection skips unsupported and system files while retaining original File references', () => {
  const image = { ...file(), webkitRelativePath: 'Study/street/scene.jpg' };
  expect(pickUploadMedia([image, file('readme.txt'), file('.DS_Store'), file('._scene.jpg')])).toEqual({ files: [image], skipped: 3 });
});
