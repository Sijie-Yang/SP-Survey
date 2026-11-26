import { applySiteAnswer, buildSiteQuestions, siteMatchLevel, siteMediaFolders } from './spSite';

const site = (elements, spSite = {}) => ({ pages: [{ name: 'p', elements }], spSite: { html: '<html></html>', ...spSite } });

test('match level tells how much the platform can analyse', () => {
  expect(siteMatchLevel(site([{ type: 'imagerating', name: 'a' }, { type: 'text', name: 'b' }])).level).toBe('full');
  expect(siteMatchLevel(site([{ type: 'imagerating', name: 'a' }, { type: 'custom', name: 'b' }]))).toMatchObject({ level: 'partial', native: 1, custom: 1 });
  expect(siteMatchLevel(site([{ type: 'custom', name: 'b' }])).level).toBe('custom');
  expect(siteMatchLevel(site([{ type: 'html', name: 'intro', html: 'x' }])).level).toBe('none');
  expect(siteMatchLevel(site([])).level).toBe('none');
});

test('media folders for the page: only the folders the survey names, recursively', () => {
  const pool = [
    { url: 'https://m/a/1.jpg', name: '1.jpg', folder: 'sp/a', logicalFolder: 'sp/a' },
    { url: 'https://m/a/sub/2.jpg', name: '2.jpg', folder: 'sp/a/sub', logicalFolder: 'sp/a/sub' },
    { url: 'https://m/b/3.jpg', name: '3.jpg', folder: 'sp/b', logicalFolder: 'sp/b' },
    { url: 'https://m/c/4.jpg', name: '4.jpg', folder: 'sp/c', logicalFolder: 'sp/c' },
  ];
  const config = site([{ type: 'imagerating', name: 'q', mediaFolders: ['sp/b'] }], { mediaFolders: ['sp/a'] });
  const media = siteMediaFolders(pool, config);
  expect(Object.keys(media).sort()).toEqual(['sp/a', 'sp/b']);
  expect(media['sp/a'].map((m) => m.name)).toEqual(['1.jpg', '2.jpg']);
  expect(media['sp/b'][0]).toEqual({ url: 'https://m/b/3.jpg', name: '3.jpg', type: 'image', folder: 'sp/b' });
});

describe('answers recorded by a page that draws media itself', () => {
  const [rating, custom] = buildSiteQuestions(site([
    { type: 'imagerating', name: 'state', rateMin: 0, rateMax: 2, rateLabels: ['a', 'b', 'c'] },
    { type: 'custom', name: 'trace' },
  ]));
  const media = { 'sp/a': [{ url: 'https://m/a/IMG1.jpg', name: 'IMG1.jpg', type: 'image' }] };

  test('one record per key, replaced when the key repeats; shown names resolve to the library file', () => {
    const first = applySiteAnswer(rating, undefined, 1, { key: 'IMG1', shown: ['IMG1.jpg'] }, media);
    expect(first.ok).toBe(true);
    expect(first.stored.trials).toEqual([{ value: 1, shown_images: ['https://m/a/IMG1.jpg'], shown_media_ids: ['IMG1.jpg'], key: 'IMG1' }]);
    const second = applySiteAnswer(rating, first.stored, 2, { key: 'IMG1', shown: ['IMG1.jpg'] }, media);
    expect(second.stored.trials).toHaveLength(1);
    expect(second.stored.trials[0].value).toBe(2);
    const third = applySiteAnswer(rating, second.stored, 0, { key: 'IMG9', shown: ['IMG9.jpg'] }, media);
    expect(third.stored.trials).toHaveLength(2);
    expect(third.stored.trials[1].shown_images).toEqual(['IMG9.jpg']);
  });

  test('values still follow the question type', () => {
    expect(applySiteAnswer(rating, undefined, 7, { key: 'x' }).ok).toBe(false);
  });

  test('a custom question takes any JSON, as is, and rejects huge values', () => {
    const plain = applySiteAnswer(custom, undefined, { path: [[1, 2], [3, 4]], ms: 120 });
    expect(plain).toEqual({ ok: true, stored: { path: [[1, 2], [3, 4]], ms: 120 } });
    const rec = applySiteAnswer(custom, undefined, 'anything', { key: 'k1' });
    expect(rec.stored.trials[0]).toEqual({ value: 'anything', shown_images: [], shown_media_ids: [], key: 'k1' });
    expect(applySiteAnswer(custom, undefined, 'x'.repeat(40000)).ok).toBe(false);
    expect(applySiteAnswer(custom, undefined, () => 1).ok).toBe(false);
  });

  test('clearing a keyed record removes it', () => {
    const one = applySiteAnswer(custom, undefined, 1, { key: 'k1' }).stored;
    expect(applySiteAnswer(custom, one, null, { key: 'k1' }).stored).toBeNull();
  });
});
