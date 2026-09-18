import { downloadMediaEntriesZip, downloadPreannotatePackageZip } from './mediaLibraryDownload';
import { downloadZip } from './zipDownload';
jest.mock('./zipDownload', () => ({ downloadZip: jest.fn() }));

test('logical moves cannot overwrite colliding file names in the downloaded ZIP', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (url) => ({ ok: true, arrayBuffer: async () => Uint8Array.of(url.includes('/a/') ? 1 : 2).buffer }));
  try {
    const result = await downloadMediaEntriesZip(['a', 'b'].map((folder) => ({
      key: `u/p/${folder}/same.jpg`, url: `https://media.test/${folder}/same.jpg`, logicalFolder: 'together',
    })), { projectPrefix: 'u/p/' });
    expect(result).toMatchObject({ succeeded: 2, failed: 0 });
    const files = downloadZip.mock.calls[0][1];
    expect(files.map((f) => f.path)).toEqual(['together/same.jpg', 'together/same__2.jpg']);
    expect(files.map((f) => [...f.content])).toEqual([[1], [2]]);
  } finally { global.fetch = originalFetch; }
});

test('annotation package preserves same-name items and reviewed zero-shape records with only selected feature rows', async () => {
  const prior = process.env.REACT_APP_R2_PUBLIC_URL;
  process.env.REACT_APP_R2_PUBLIC_URL = 'https://media.test';
  downloadZip.mockClear();
  const items = ['first', 'second'].map((id, index) => ({
    mediaEntry: { media_id: id, name: 'same.jpg', url: `https://media.test/${id}/same.jpg`, logicalFolder: 'together' },
    annotation: { media_id: id, name: 'same.jpg', image: `https://media.test/${id}/same.jpg`,
      labels: ['tree'], review_status: 'accepted', shapes: index ? [] : [
        { tool: 'bbox', label: 'tree', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }] },
      ] },
  }));
  try {
    await downloadPreannotatePackageZip({ r2Prefix: 'u/p/', items, includeImages: false, includeOverlays: false });
    const files = downloadZip.mock.calls[0][1];
    const docs = files.filter((file) => file.path.startsWith('preannotations/'));
    expect(new Set(docs.map((file) => file.path)).size).toBe(2);
    expect(docs.map((file) => JSON.parse(file.content).shapes.length)).toEqual([1, 0]);
    const csv = files.find((file) => file.path.startsWith('features/')).content;
    expect(csv.trim().split('\n')).toHaveLength(3);
    expect(csv).toContain('first');
    expect(csv).toContain('second');
    const manifest = JSON.parse(files.find((file) => file.path === 'manifest.json').content);
    expect(manifest).toMatchObject({ annotated_count: 2, feature_version: '2', failures: [] });
    expect(new Set(manifest.items.map((item) => item.json_path)).size).toBe(2);
    expect(manifest.items.map((item) => item.shape_count)).toEqual([1, 0]);
  } finally {
    if (prior === undefined) delete process.env.REACT_APP_R2_PUBLIC_URL;
    else process.env.REACT_APP_R2_PUBLIC_URL = prior;
  }
});
