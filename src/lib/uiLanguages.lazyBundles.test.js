import { interfaceDictionary, loadLocaleBundle, lookupPhrase } from './uiLanguages';

const PHRASE = 'No selected category has enough matching files for a complete trial. Reduce the count or add media.';

test('extra-language strings load on demand and fall back to English until then', async () => {
  const before = interfaceDictionary('ja');
  expect(before.siliconPageTitle).toBe(interfaceDictionary('en').siliconPageTitle);
  expect(lookupPhrase('ja', PHRASE)).toBeUndefined();

  await loadLocaleBundle('ja');

  expect(interfaceDictionary('ja').siliconPageTitle).toBe('シリコンプレテスト');
  expect(lookupPhrase('ja', PHRASE)).toMatch(/^選択したカテゴリ/);
});

test('dictionaries are built once per language', () => {
  expect(interfaceDictionary('en')).toBe(interfaceDictionary('en'));
  expect(interfaceDictionary('zh')).toBe(interfaceDictionary('zh-CN'));
});

test('English and Simplified Chinese need no bundle', async () => {
  await expect(loadLocaleBundle('en')).resolves.toBeUndefined();
  await expect(loadLocaleBundle('zh')).resolves.toBeUndefined();
});
