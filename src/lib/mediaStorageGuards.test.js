import { filterDeletableR2Keys, isTemplateR2Key } from './r2';

describe('storage delete guards', () => {
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
