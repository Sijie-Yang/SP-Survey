/** Shared fixtures for media set/category pipeline tests. */

export function makePool(entries) {
  return (entries || []).map(({ name, folder = '', type = 'image', prefix = 'user/proj' }) => {
    const key = folder
      ? `${prefix}/${folder}/${name}`
      : `${prefix}/${name}`;
    return {
      name,
      folder,
      key,
      url: `https://r2.test/${key}`,
      type,
      media_id: key,
    };
  });
}

export const FIXTURE_TAGS = {
  'sets/s1': 'set',
  'sets/s2': 'set',
  'cats/urban': 'category',
  'cats/park': 'category',
  cats: 'category',
};

export const FIXTURE_POOL = makePool([
  { name: 'a.jpg', folder: 'sets/s1' },
  { name: 'b.jpg', folder: 'sets/s1' },
  { name: 'c.jpg', folder: 'sets/s2' },
  { name: 'd.jpg', folder: 'sets/s2' },
  { name: 'e.jpg', folder: 'sets/s2' },
  { name: 'u1.jpg', folder: 'cats/urban' },
  { name: 'u2.jpg', folder: 'cats/urban' },
  { name: 'p1.jpg', folder: 'cats/park' },
  { name: 'nested.jpg', folder: 'cats/urban/sub' },
]);

export function setQuestion(overrides = {}) {
  return {
    type: 'imagerating',
    name: 'q_set',
    mediaAssignmentMode: 'set',
    imageCount: 2,
    randomImageSelection: true,
    ...overrides,
  };
}

export function categoryQuestion(overrides = {}) {
  return {
    type: 'imagepicker',
    name: 'q_cat',
    mediaAssignmentMode: 'category',
    mediaPerCategory: 1,
    randomImageSelection: true,
    ...overrides,
  };
}
