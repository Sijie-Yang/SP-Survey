jest.mock('./imageFeaturesR2', () => ({ savePreannotation: jest.fn() }));
const { savePreannotation } = require('./imageFeaturesR2');
const { queueAnnotationSave, flushAnnotationSaves, readPendingAnnotation, annotationSaveKey, retryAnnotationSave } = require('./annotationSaveQueue');
const entry = { media_id: 'a', url: 'https://r2.test/a.jpg' };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { resolve, promise }; };

beforeEach(() => { localStorage.clear(); savePreannotation.mockReset(); jest.useFakeTimers(); });
afterEach(async () => { savePreannotation.mockResolvedValue({}); await flushAnnotationSaves(); jest.useRealTimers(); });

test('flush saves captured image even after navigating to another image', async () => {
  savePreannotation.mockResolvedValue({});
  queueAnnotationSave('p/', entry, { shapes: [{ id: 1 }] });
  queueAnnotationSave('p/', { media_id: 'b', url: 'b' }, { shapes: [{ id: 2 }] });
  await flushAnnotationSaves({ strict: true });
  expect(savePreannotation.mock.calls.map((c) => [c[1].media_id, c[2].shapes[0].id])).toEqual([['a', 1], ['b', 2]]);
});

test('same-image writes serialize and retain newer pending edit until acknowledged', async () => {
  const first = deferred();
  savePreannotation.mockImplementationOnce(() => first.promise).mockResolvedValue({});
  queueAnnotationSave('p/', entry, { shapes: [{ id: 1 }] });
  const flushing = flushAnnotationSaves();
  queueAnnotationSave('p/', entry, { shapes: [{ id: 2 }] });
  expect(savePreannotation).toHaveBeenCalledTimes(1);
  first.resolve({}); await flushing;
  expect(savePreannotation).toHaveBeenCalledTimes(2);
  expect(savePreannotation.mock.calls[1][2].shapes[0].id).toBe(2);
  expect(readPendingAnnotation(annotationSaveKey('p/', entry))).toBeNull();
});

test('failed save preserves recovery data and explicit retry clears it only on success', async () => {
  savePreannotation.mockRejectedValue(new Error('offline'));
  const key = queueAnnotationSave('p/', entry, { shapes: [{ id: 3 }] });
  await expect(flushAnnotationSaves({ strict: true })).rejects.toThrow('Save annotations');
  expect(readPendingAnnotation(key).annotation.shapes[0].id).toBe(3);
  expect(localStorage.getItem(`sp_annotation_pending_v1:${key}`)).toContain('3');
  savePreannotation.mockResolvedValue({}); retryAnnotationSave(key);
  await flushAnnotationSaves({ strict: true });
  expect(readPendingAnnotation(key)).toBeNull();
});
