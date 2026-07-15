import {
  getMediaPoolStatus,
  pickRandomMediaForQuestion,
  expectedCategoryImageCount,
  buildMediaAssignmentLogEntry,
  trackMediaAssignment,
  getMediaPerCategory,
  usesSetMediaAssignment,
  usesCategoryMediaAssignment,
} from './surveyMediaInjection';
import {
  FIXTURE_POOL,
  FIXTURE_TAGS,
  setQuestion,
  categoryQuestion,
  makePool,
} from './__fixtures__/mediaPool';

describe('surveyMediaInjection set/category picking', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getMediaPoolStatus reports eligible sets and category totals', () => {
    const setStatus = getMediaPoolStatus(FIXTURE_POOL, setQuestion({ imageCount: 2 }), FIXTURE_TAGS);
    expect(setStatus.eligibleSetCount).toBe(1);
    expect(setStatus.filesPerSet).toBe(2);

    const catQ = categoryQuestion({ mediaPerCategory: 2 });
    const catStatus = getMediaPoolStatus(FIXTURE_POOL, catQ, FIXTURE_TAGS);
    expect(catStatus.matchingCategoryCount).toBe(3);
    expect(catStatus.expectedCategoryTotal).toBe(6);
    expect(expectedCategoryImageCount(FIXTURE_POOL, catQ, FIXTURE_TAGS)).toBe(6);
  });

  test('pickRandomMediaForQuestion set mode returns full eligible folder set', () => {
    const assignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      setQuestion({ imageCount: 2 }),
      new Set(),
      new Set(),
      null,
      FIXTURE_TAGS,
    );
    expect(assignment.images).toHaveLength(2);
    expect(assignment.setId).toBe('sets/s1');
    expect(assignment.setKey).toBe('folder:sets/s1');
    expect(assignment.groupId).toBe('sets/s1');
    expect(assignment.images.every((img) => img.folder === 'sets/s1')).toBe(true);
  });

  test('pickRandomMediaForQuestion set mode returns empty when no eligible sets', () => {
    const assignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      setQuestion({ imageCount: 4 }),
      new Set(),
      new Set(),
      null,
      FIXTURE_TAGS,
    );
    expect(assignment.images).toEqual([]);
    expect(assignment.setId).toBeNull();
  });

  test('pickRandomMediaForQuestion set mode excludes used sets', () => {
    const used = new Set(['folder:sets/s1']);
    const assignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      setQuestion({ imageCount: 2 }),
      new Set(),
      used,
      null,
      FIXTURE_TAGS,
    );
    expect(assignment.images).toEqual([]);
  });

  test('pickRandomMediaForQuestion category mode draws per category', () => {
    const assignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      categoryQuestion({ mediaPerCategory: 1, mediaFolders: ['cats/urban', 'cats/park'] }),
      new Set(),
      new Set(),
      null,
      FIXTURE_TAGS,
    );
    expect(assignment.categories).toEqual(['cats/park', 'cats/urban']);
    expect(assignment.images).toHaveLength(2);
    expect(assignment.setId).toBeNull();
  });

  test('pickRandomMediaForQuestion category mode skips exhausted categories', () => {
    const used = new Set(['user/proj/cats/park/p1.jpg']);
    const assignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      categoryQuestion({ mediaPerCategory: 1, mediaFolders: ['cats/urban', 'cats/park'] }),
      used,
      new Set(),
      null,
      FIXTURE_TAGS,
    );
    expect(assignment.categories).toEqual(['cats/urban']);
    expect(assignment.images).toHaveLength(1);
  });

  test('trackMediaAssignment and buildMediaAssignmentLogEntry keep set/category metadata', () => {
    const q = setQuestion();
    const assignment = pickRandomMediaForQuestion(
      FIXTURE_POOL,
      q,
      new Set(),
      new Set(),
      null,
      FIXTURE_TAGS,
    );
    const usedImages = new Set();
    const usedSets = new Set();
    trackMediaAssignment(assignment, q, usedImages, usedSets);
    expect(usedSets.has('folder:sets/s1')).toBe(true);
    expect(usedImages.size).toBe(2);

    const log = buildMediaAssignmentLogEntry(q, assignment.images, assignment.setId, null);
    expect(log.mode).toBe('set');
    expect(log.setId).toBe('sets/s1');
    expect(log.fileNames).toHaveLength(2);
  });

  test('legacy group mode and mediaPerCategory defaults', () => {
    expect(usesSetMediaAssignment({ mediaAssignmentMode: 'group' })).toBe(true);
    expect(usesCategoryMediaAssignment({ mediaAssignmentMode: 'category' })).toBe(true);
    expect(getMediaPerCategory({})).toBe(1);
    expect(getMediaPerCategory({ mediaPerCategory: 3 })).toBe(3);
  });

  test('individual mode can scope to folders', () => {
    const pool = makePool([
      { name: 'root.jpg', folder: '' },
      { name: 'a.jpg', folder: 'sets/s1' },
      { name: 'b.jpg', folder: 'sets/s1' },
    ]);
    const assignment = pickRandomMediaForQuestion(
      pool,
      {
        type: 'imagerating',
        name: 'q_ind',
        mediaAssignmentMode: 'individual',
        imageCount: 2,
        mediaFolders: ['sets/s1'],
        randomImageSelection: true,
      },
      new Set(),
      new Set(),
      null,
      FIXTURE_TAGS,
    );
    expect(assignment.images).toHaveLength(2);
    expect(assignment.images.every((img) => img.folder === 'sets/s1')).toBe(true);
  });
});
