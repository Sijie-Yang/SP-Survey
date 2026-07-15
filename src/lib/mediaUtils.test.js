import {
  normalizeFolderPath,
  normalizeMediaFolderTags,
  setMediaFolderTag,
  sanitizeMediaFolderConfig,
  mergeMediaFolderConfigs,
  remapMediaFolderTags,
  remapMediaFolderList,
  removeMediaFolders,
  getDirectChildMedia,
  getEligibleFolderSets,
  getEligibleMediaSets,
  buildMediaByFolderCategory,
  normalizeMediaAssignmentMode,
  isFolderOrDescendant,
} from './mediaUtils';
import { FIXTURE_POOL, FIXTURE_TAGS, makePool } from './__fixtures__/mediaPool';

describe('mediaUtils folder/set/category contracts', () => {
  test('normalizeFolderPath strips slashes and empties', () => {
    expect(normalizeFolderPath('/a/b/')).toBe('a/b');
    expect(normalizeFolderPath('')).toBe('');
    expect(normalizeFolderPath('\\\\a\\\\b')).toBe('a/b');
  });

  test('normalizeMediaFolderTags keeps only set/category and drops root', () => {
    expect(normalizeMediaFolderTags({
      '': 'set',
      '/sets/s1/': 'set',
      'cats/park': 'category',
      'bad': 'other',
    })).toEqual({
      'sets/s1': 'set',
      'cats/park': 'category',
    });
  });

  test('setMediaFolderTag rejects root and clears invalid tags', () => {
    expect(setMediaFolderTag({}, '', 'set')).toEqual({});
    expect(setMediaFolderTag({ 'sets/s1': 'set' }, 'sets/s1', null)).toEqual({});
    expect(setMediaFolderTag({}, 'sets/s1', 'set')).toEqual({ 'sets/s1': 'set' });
  });

  test('sanitizeMediaFolderConfig strips secrets and keeps folders/tags', () => {
    expect(sanitizeMediaFolderConfig({
      mediaFolderTags: { 'sets/s1': 'set', bad: 'x' },
      mediaFolders: ['sets/s1', '', 'cats/park'],
      huggingFaceToken: 'secret',
      templateImportHistory: { t1: { lastImportAt: 'x' } },
      hfImportDataset: 'user/ds',
    })).toEqual({
      mediaFolderTags: { 'sets/s1': 'set' },
      mediaFolders: ['cats/park', 'sets/s1'],
    });
  });

  test('mergeMediaFolderConfigs unions folders and lets incoming tags win', () => {
    expect(mergeMediaFolderConfigs(
      { mediaFolderTags: { a: 'set', b: 'category' }, mediaFolders: ['a'] },
      { mediaFolderTags: { b: 'set', c: 'category' }, mediaFolders: ['b', 'c'] },
    )).toEqual({
      mediaFolderTags: { a: 'set', b: 'set', c: 'category' },
      mediaFolders: ['a', 'b', 'c'],
    });
  });

  test('remap and remove cascade to descendant folders', () => {
    const tags = { 'old/s1': 'set', 'old/s1/nested': 'category', keep: 'set' };
    const folders = ['old/s1', 'old/s1/nested', 'keep'];
    expect(remapMediaFolderTags(tags, 'old', 'new')).toEqual({
      'new/s1': 'set',
      'new/s1/nested': 'category',
      keep: 'set',
    });
    expect(remapMediaFolderList(folders, 'old', 'new')).toEqual([
      'keep',
      'new/s1',
      'new/s1/nested',
    ]);
    expect(removeMediaFolders(tags, folders, ['old'])).toEqual({
      mediaFolderTags: { keep: 'set' },
      mediaFolders: ['keep'],
    });
    expect(isFolderOrDescendant('old/s1/nested', 'old')).toBe(true);
  });

  test('set eligibility uses direct children only and exact size', () => {
    const pool = makePool([
      { name: 'a.jpg', folder: 'sets/s1' },
      { name: 'b.jpg', folder: 'sets/s1' },
      { name: 'nested.jpg', folder: 'sets/s1/sub' },
    ]);
    const tags = { 'sets/s1': 'set' };
    expect(getDirectChildMedia(pool, 'sets/s1')).toHaveLength(2);
    const all = getEligibleFolderSets(pool, 2, tags);
    expect(all).toHaveLength(1);
    expect(all[0].eligible).toBe(true);
    expect(getEligibleMediaSets(pool, 3, tags)).toHaveLength(0);
  });

  test('getEligibleMediaSets respects scopeFolders', () => {
    const eligible = getEligibleMediaSets(FIXTURE_POOL, 2, FIXTURE_TAGS, {
      scopeFolders: ['sets/s1'],
    });
    expect(eligible.map((s) => s.setId)).toEqual(['sets/s1']);
  });

  test('buildMediaByFolderCategory uses deepest tagged prefix', () => {
    const byCat = buildMediaByFolderCategory(FIXTURE_POOL, FIXTURE_TAGS);
    expect([...byCat.keys()].sort()).toEqual(['cats', 'cats/park', 'cats/urban']);
    expect(byCat.get('cats/urban').map((m) => m.name).sort()).toEqual(['nested.jpg', 'u1.jpg', 'u2.jpg']);
    expect(byCat.get('cats')).toHaveLength(0);
    expect(byCat.get('cats/park').map((m) => m.name)).toEqual(['p1.jpg']);
  });

  test('normalizeMediaAssignmentMode maps legacy group to set', () => {
    expect(normalizeMediaAssignmentMode('group')).toBe('set');
    expect(normalizeMediaAssignmentMode('set')).toBe('set');
    expect(normalizeMediaAssignmentMode('category')).toBe('category');
    expect(normalizeMediaAssignmentMode('weird')).toBe('individual');
  });
});
