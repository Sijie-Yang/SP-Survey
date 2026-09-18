import { mediaSelectionCandidates, mediaKeywordCandidates } from './mediaLibrarySelection';

const file = (id, folder, name = 'scene.jpg', type = 'image') => ({ media_id: id, key: `u/p/${id}`, name, logicalFolder: folder, type });
const pool = [file('a', 'one'), file('b', 'two'), file('c', 'one/nested'), file('d', 'one-other'), file('e', ''), file('v', 'two', 'scene.mp4', 'video')];
const ids = (options) => mediaSelectionCandidates(pool, options).map((f) => f.media_id).sort();

test('multiple checked folders include descendants and exclude unrelated current folder', () => {
  expect(ids({ folders: new Set(['one', 'two']), currentFolder: 'one-other' })).toEqual(['a', 'b', 'c', 'v']);
});
test('overlapping parent and child selections do not duplicate media or confuse path prefixes', () => {
  expect(ids({ folders: new Set(['one', 'one/nested']) })).toEqual(['a', 'c']);
});
test('multi-folder selection respects both search and media type', () => {
  expect(ids({ folders: new Set(['one', 'two']), search: 'SCENE', type: 'image' })).toEqual(['a', 'b', 'c']);
  expect(ids({ folders: new Set(['one', 'two']), search: 'nested' })).toEqual(['c']);
  expect(ids({ folders: new Set(['one', 'two']), search: 'missing' })).toEqual([]);
});
test('without checked folders, selection uses only direct files of the current folder or root', () => {
  expect(ids({ currentFolder: 'one' })).toEqual(['a']);
  expect(ids({})).toEqual(['e']);
});

const keywordPool = [
  file('street', 'one', 'STREET_公园.jpg'),
  file('phrase', 'one/nested', 'night scene.jpg'),
  file('literal', 'two', '[Park].png'),
  file('video', 'one', 'street.mp4', 'video'),
  file('folder-only', 'street', 'other.jpg'),
];
test('keyword selection matches literal filename terms and phrases across checked folders, only images', () => {
  expect(mediaKeywordCandidates(keywordPool, { folders: new Set(['one', 'two']), keywords: ' street，night scene\n[Park] ; STREET ' }).map((m) => m.media_id).sort())
    .toEqual(['literal', 'phrase', 'street']);
  expect(mediaKeywordCandidates(keywordPool, { allFolders: true, keywords: 'street; 公园', match: 'all' }).map((m) => m.media_id)).toEqual(['street']);
});
test('keyword scope separates the current folder, descendants and entire library', () => {
  expect(mediaKeywordCandidates(keywordPool, { currentFolder: 'one', keywords: 'scene' })).toEqual([]);
  expect(mediaKeywordCandidates(keywordPool, { folders: new Set(['one']), keywords: 'scene' })).toHaveLength(1);
  expect(mediaKeywordCandidates(keywordPool, { folders: new Set(['one']), allFolders: true, keywords: '[park]' })).toHaveLength(1);
  expect(mediaKeywordCandidates(keywordPool, { allFolders: true, keywords: 'street' }).map((m) => m.media_id)).toEqual(['street']);
});
test('empty keyword input never selects the entire library', () => {
  for (const keywords of ['', '  ', ',；\n;']) {
    expect(mediaKeywordCandidates(keywordPool, { allFolders: true, keywords, match: 'all' })).toEqual([]);
  }
});
