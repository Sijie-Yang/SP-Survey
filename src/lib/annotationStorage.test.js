const originalR2Base = process.env.REACT_APP_R2_PUBLIC_URL;
process.env.REACT_APP_R2_PUBLIC_URL = 'https://r2.test';
afterAll(() => { if (originalR2Base == null) delete process.env.REACT_APP_R2_PUBLIC_URL; else process.env.REACT_APP_R2_PUBLIC_URL = originalR2Base; });
jest.mock('./r2', () => ({
  uploadImageToR2: jest.fn(), listImagesFromR2: jest.fn(), isR2Configured: () => true,
  getR2ServerUrl: () => 'https://api.test', isR2ProxyUnreachable: () => false, noteR2ProxyFailure: () => false,
}));
const { uploadImageToR2, listImagesFromR2 } = require('./r2');
const { savePreannotation, loadPreannotation, loadFeatureCsv, SAM_PREANNOT_MODEL, preannotationKey } = require('./imageFeaturesR2');
const originalFetch = global.fetch;
const box = { tool: 'bbox', label: 'tree', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }] };
beforeEach(() => { uploadImageToR2.mockReset().mockResolvedValue({ success: true, key: 'stored' }); listImagesFromR2.mockReset(); });
afterEach(() => { global.fetch = originalFetch; });

test('saving different images writes independent source files, never shared CSV', async () => {
  await Promise.all(['a', 'b'].map((id) => savePreannotation('u/p/', { media_id: id, name: 'same.jpg', url: id }, { shapes: [box], labels: ['tree'], review_status: 'accepted' })));
  expect(uploadImageToR2).toHaveBeenCalledTimes(2);
  const paths = uploadImageToR2.mock.calls.map((c) => c[1]);
  expect(new Set(paths).size).toBe(2);
  expect(paths.every((path) => path.includes('/by-id/') && path.endsWith('.json'))).toBe(true);
  expect(listImagesFromR2).not.toHaveBeenCalled();
});

test('R2 list 503 does not pause feature load; SAM overlay is empty', async () => {
  listImagesFromR2.mockResolvedValue({
    success: false,
    error: 'R2 list failed (HTTP 503): Cloudflare R2 is not configured on the server.',
  });
  global.fetch = jest.fn().mockResolvedValue({ status: 404, ok: false });
  await expect(loadFeatureCsv('u/p/', SAM_PREANNOT_MODEL)).resolves.toEqual([]);
});

test('network and corrupt document errors remain errors, not empty annotations', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(loadPreannotation('u/fail/', { media_id: 'x', url: 'x' })).rejects.toThrow('offline');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => 'not JSON' });
  await expect(loadPreannotation('u/broken/', { media_id: 'x', url: 'x' })).rejects.toThrow('Invalid annotation');
});

test('stable document wins over old path; original labels and union features are rebuilt', async () => {
  const prefix = 'u/rebuild/';
  const oldKey = `${prefix}preannotations/a.jpg.json`;
  const newKey = preannotationKey(prefix, { media_id: 'a' });
  const docs = {
    [oldKey]: { media_id: 'a', name: 'a.jpg', shapes: [box], labels: ['tree'], updated_at: '2099-01-01' },
    [newKey]: { media_id: 'a', name: 'a.jpg', shapes: [box, box], labels: ['tree', '建筑'], review_status: 'accepted', updated_at: '2026-09-10' },
  };
  listImagesFromR2.mockResolvedValue({ success: true, images: Object.keys(docs).map((key) => ({ key, url: `https://r2.test/${key}` })) });
  global.fetch = jest.fn(async (url) => {
    const key = Object.keys(docs).find((candidate) => String(url).endsWith(candidate));
    return key ? { ok: true, text: async () => JSON.stringify(docs[key]) } : { ok: false, status: 404 };
  });
  const rows = await loadFeatureCsv(prefix, SAM_PREANNOT_MODEL);
  expect(rows).toHaveLength(1);
  expect(rows[0].features.sam_count_tree).toBe(2);
  expect(rows[0].features.sam_ratio_tree).toBeCloseTo(0.25);
  expect(rows[0].review_status).toBe('accepted');
  expect(Object.values(rows[0].label_dictionary)).toContain('建筑');
});

test('missing legacy document can be recovered by source ID after a folder move', async () => {
  const prefix = 'u/moved/';
  const doc = { media_id: 'source/a', name: 'a.jpg', image: 'https://r2.test/source/a', shapes: [box], updated_at: '2026-09-10' };
  const oldUrl = 'https://r2.test/old-folder-document.json';
  listImagesFromR2.mockResolvedValue({ success: true, images: [{ key: `${prefix}preannotations/old__a.jpg.json`, url: oldUrl }] });
  global.fetch = jest.fn(async (url) => url === oldUrl ? { ok: true, text: async () => JSON.stringify(doc) } : { ok: false, status: 404 });
  const loaded = await loadPreannotation(prefix, { media_id: 'source/a', name: 'a.jpg', folder: 'new', url: doc.image });
  expect(loaded.shapes).toEqual([box]);
});
