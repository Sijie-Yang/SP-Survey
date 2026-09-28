import { mergeMediaLibraryListing, serializeMediaLibraryEntry } from './mediaLibrarySync';
import { buildMediaByFolderCategory, getDirectChildMedia } from './mediaUtils';

const prefix = 'u/p/';
const file = (key) => ({ key: `${prefix}${key}`, name: key.split('/').pop(), url: `https://media.test/${key}` });

test('refresh and JSON save/reload retain nested moves, explicit root moves, IDs and annotations', () => {
  const listed = [file('a.jpg'), file('old/b.jpg')];
  const saved = listed.map((entry, i) => ({ ...entry, media_id: `stable-${i}`,
    folder: i ? '' : 'study/category/nested', logicalFolder: i ? '' : 'study/category/nested',
    metadata: { label: `annotation-${i}` },
  }));
  const reloaded = JSON.parse(JSON.stringify(saved.map((entry) => serializeMediaLibraryEntry(entry, prefix))));
  const refreshed = mergeMediaLibraryListing(listed, reloaded, prefix);
  expect(refreshed).toEqual(reloaded);
  expect(getDirectChildMedia(refreshed, '', prefix).map((entry) => entry.media_id)).toEqual(['stable-1']);
  expect(buildMediaByFolderCategory(refreshed, { 'study/category': 'category' }, { projectPrefix: prefix })
    .get('study/category').map((entry) => entry.media_id)).toEqual(['stable-0']);
});

test('legacy saved folders survive refresh and same basenames never share metadata', () => {
  const listed = [file('old/same.jpg'), file('new/same.jpg')];
  const saved = [{ ...listed[0], folder: 'moved/deep', media_id: 'original', metadata: { label: 'A' } }];
  const result = mergeMediaLibraryListing(listed, saved, prefix);
  expect(result[0]).toMatchObject({ folder: 'moved/deep', media_id: 'original', metadata: { label: 'A' } });
  expect(result[1]).toMatchObject({ folder: 'new', media_id: 'u/p/new/same.jpg' });
  expect(result[1].metadata).toBeUndefined();
});

test('listing updates file presence and URL without resetting library metadata', () => {
  const original = file('a.jpg');
  const saved = [{ ...original, logicalFolder: 'moved', media_id: 'stable' }, file('deleted.jpg')];
  const result = mergeMediaLibraryListing([{ ...original, url: 'https://new.test/a.jpg' }, file('new/b.jpg')], saved, prefix);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ url: 'https://new.test/a.jpg', media_id: 'stable', folder: 'moved' });
  expect(result[1].folder).toBe('new');
});

test('legacy URL-only entries match exact URLs while unnamed files do not cross-match', () => {
  const listed = [file('old/a.jpg'), file('new/a.jpg')];
  const result = mergeMediaLibraryListing(listed, [{ url: listed[0].url, folder: 'saved/nested', media_id: 'original' }], prefix);
  expect(result.map((entry) => entry.folder)).toEqual(['saved/nested', 'new']);
  expect(result[0].media_id).toBe('original');
});
