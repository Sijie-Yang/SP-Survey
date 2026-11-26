import { annotationScopeFolder, listAnnotationImages } from './annotationScope';

const pool = [
  { name: 'root.jpg', url: 'https://example.test/root.jpg', folder: '' },
  { name: 'street.jpg', url: 'https://example.test/street.jpg', folder: 'street' },
  { name: 'day.jpg', url: 'https://example.test/day.jpg', folder: 'street/day' },
  { name: 'clip.mp4', url: 'https://example.test/clip.mp4', folder: 'street', type: 'video' },
];

const names = (items) => items.map((item) => item.name);

test('folder scope is that folder only, and checked folders include subfolders', () => {
  expect(names(listAnnotationImages(pool, 'all'))).toEqual(['day.jpg', 'root.jpg', 'street.jpg']);
  expect(names(listAnnotationImages(pool, annotationScopeFolder('')))).toEqual(['root.jpg']);
  expect(names(listAnnotationImages(pool, annotationScopeFolder('street')))).toEqual(['street.jpg']);
  expect(names(listAnnotationImages(pool, 'checked', { checkedFolders: ['street'] }))).toEqual(['day.jpg', 'street.jpg']);
  expect(names(listAnnotationImages(pool, 'selected', { selectedIds: ['day.jpg'] }))).toEqual(['day.jpg']);
});
