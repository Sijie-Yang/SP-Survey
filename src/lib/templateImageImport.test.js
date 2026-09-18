import {
  mergeTemplateMediaFoldersIntoProject,
  buildTemplateCopyTodo,
  mergeCopiedIntoProjectImages,
} from './templateImageImport';
import { sanitizeMediaFolderConfig } from './mediaUtils';
import { filterDeletableR2Keys, isTemplateR2Key } from './r2';

describe('template media folder round-trip', () => {
  test('mergeTemplateMediaFoldersIntoProject merges tags and keeps project-local fields', () => {
    const merged = mergeTemplateMediaFoldersIntoProject(
      {
        mediaFolderTags: { keep: 'set' },
        mediaFolders: ['keep'],
        huggingFaceToken: 'secret',
      },
      {
        mediaFolderTags: { 'sets/s1': 'set', keep: 'category' },
        mediaFolders: ['sets/s1'],
        templateImportHistory: { t1: {} },
      },
    );
    expect(merged.mediaFolderTags).toEqual({ keep: 'category', 'sets/s1': 'set' });
    expect(merged.mediaFolders).toEqual(['keep', 'sets/s1']);
    expect(merged.huggingFaceToken).toBe('secret');
    expect(sanitizeMediaFolderConfig(merged)).toEqual({
      mediaFolderTags: { keep: 'category', 'sets/s1': 'set' },
      mediaFolders: ['keep', 'sets/s1'],
    });
  });

  test('buildTemplateCopyTodo skips already copied relative paths', () => {
    const templateImages = [
      { key: 'templates/t1/sets/s1/a.jpg', name: 'a.jpg', folder: 'sets/s1' },
      { key: 'templates/t1/sets/s1/b.jpg', name: 'b.jpg', folder: 'sets/s1' },
    ];
    const existing = new Set(['sets/s1/a.jpg']);
    const todo = buildTemplateCopyTodo(templateImages, existing, 'user/proj/', 'templates/t1/');
    expect(todo).toEqual([
      { from: 'templates/t1/sets/s1/b.jpg', to: 'user/proj/sets/s1/b.jpg' },
    ]);
  });

  test('mergeCopiedIntoProjectImages dedupes by relative path and preserves folder', () => {
    const merged = mergeCopiedIntoProjectImages(
      [{ name: 'a.jpg', key: 'user/proj/sets/s1/a.jpg', folder: 'sets/s1', url: 'https://r2.test/user/proj/sets/s1/a.jpg' }],
      [
        { to: 'user/proj/sets/s1/a.jpg', url: 'https://r2.test/user/proj/sets/s1/a.jpg' },
        { to: 'user/proj/sets/s1/b.jpg', url: 'https://r2.test/user/proj/sets/s1/b.jpg' },
      ],
      'https://r2.test',
      'user/proj/',
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.name === 'b.jpg').folder).toBe('sets/s1');
    expect(merged.find((m) => m.name === 'a.jpg').key).toBe('user/proj/sets/s1/a.jpg');
  });
});

describe('R2 delete guards', () => {
  test('blocks templates/ unless allowTemplateKeys', () => {
    expect(isTemplateR2Key('templates/t1/a.jpg')).toBe(true);
    const blocked = filterDeletableR2Keys(
      ['templates/t1/a.jpg', 'user/proj/a.jpg'],
      { allowedPrefix: 'user/proj/' },
    );
    expect(blocked.keys).toEqual(['user/proj/a.jpg']);
    expect(blocked.skipped).toEqual(['templates/t1/a.jpg']);

    const allowed = filterDeletableR2Keys(
      ['templates/t1/a.jpg'],
      { allowTemplateKeys: true, allowedPrefix: 'templates/t1/' },
    );
    expect(allowed.keys).toEqual(['templates/t1/a.jpg']);
  });

  test('blocks keys outside allowedPrefix', () => {
    const result = filterDeletableR2Keys(
      ['user/proj/a.jpg', 'user/other/b.jpg'],
      { allowedPrefix: 'user/proj/' },
    );
    expect(result.keys).toEqual(['user/proj/a.jpg']);
    expect(result.skipped).toEqual(['user/other/b.jpg']);
  });
});
