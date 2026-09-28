import {
  getMediaPoolStatus,
  pickRandomMediaForQuestion,
  expectedCategoryImageCount,
  describeMediaAssignmentFailure,
  buildMediaAssignmentLogEntry,
  trackMediaAssignment,
  getMediaPerCategory,
  usesSetMediaAssignment,
  usesCategoryMediaAssignment,
  syncInjectedMediaOntoSurveyModel,
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

  test('single-category trials choose one complete eligible category and preserve its metadata', () => {
    const pool = makePool([
      { name: 'a1.jpg', folder: 'a' }, { name: 'a2.jpg', folder: 'a' },
      { name: 'b1.jpg', folder: 'b' }, { name: 'b2.jpg', folder: 'b' },
      { name: 'short.jpg', folder: 'short' }, { name: 'outside.jpg', folder: 'outside' },
    ]);
    const tags = { a: 'category', b: 'category', short: 'category', outside: 'category' };
    const question = categoryQuestion({ mediaCategoryMode: 'single', mediaPerCategory: 2, mediaFolders: ['a', 'b', 'short'] });
    expect(expectedCategoryImageCount(pool, question, tags)).toBe(2);
    expect(getMediaPoolStatus(pool, question, tags).expectedCategoryTotal).toBe(2);
    expect(getMediaPoolStatus(pool, question, tags).eligibleSingleCategoryCount).toBe(2);
    const used = new Set();
    const first = pickRandomMediaForQuestion(pool, question, used, new Set(), null, tags);
    expect(first.images).toHaveLength(2);
    expect(first.categories).toEqual(['a']);
    first.images.forEach((img) => used.add(img.media_id));
    const second = pickRandomMediaForQuestion(pool, question, used, new Set(), null, tags);
    expect(second.categories).toEqual(['b']);
    second.images.forEach((img) => used.add(img.media_id));
    expect(pickRandomMediaForQuestion(pool, question, used, new Set(), null, tags).images).toEqual([]);
    const repeat = pickRandomMediaForQuestion(pool, { ...question, excludePreviouslyUsedImages: false }, used, new Set(), null, tags);
    expect(repeat.images).toHaveLength(2);
    expect(new Set(repeat.images.map((img) => img.folder)).size).toBe(1);
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

  test('folder counts and random draws agree across overlapping scopes without leaking outside them', () => {
    const pool = makePool([
      { name: 'a.jpg', folder: 'chosen' },
      { name: 'b.jpg', folder: 'chosen/nested' },
      { name: 'c.jpg', folder: 'another' },
      { name: 'outside.jpg', folder: 'chosen-other' },
    ]);
    const question = { type: 'imagepicker', imageCount: 3, mediaFolders: ['chosen', 'chosen/nested', 'another'] };
    expect(getMediaPoolStatus(pool, question).matchingFileCount).toBe(3);
    const draw = pickRandomMediaForQuestion(pool, question, new Set(), new Set());
    expect(draw.images.map((m) => m.name).sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(getMediaPoolStatus(pool, { ...question, mediaFolders: ['missing'] }).matchingFileCount).toBe(0);
    expect(pickRandomMediaForQuestion(pool, { ...question, mediaFolders: ['missing'] }, new Set(), new Set()).images).toEqual([]);
    expect(getMediaPoolStatus(pool, { ...question, mediaFolders: [] }).matchingFileCount).toBe(4);
  });

  test('a fixed category scope only draws from that category over repeated trials', () => {
    const question = categoryQuestion({ mediaFolders: ['cats/urban'], mediaPerCategory: 1 });
    for (let trial = 0; trial < 3; trial++) {
      const result = pickRandomMediaForQuestion(FIXTURE_POOL, question, new Set(), new Set(), null, FIXTURE_TAGS);
      expect(result.images).toHaveLength(1);
      expect(result.images.every((image) => image.folder === 'cats/urban' || image.folder.startsWith('cats/urban/'))).toBe(true);
    }
    expect(getMediaPoolStatus(FIXTURE_POOL, question, FIXTURE_TAGS).matchingCategoryLabels).toEqual(['cats/urban']);
  });

  test('copies hydrated Skill contract and HTML onto the live SurveyJS question', () => {
    const assigned = {};
    const liveQuestion = {
      name: 'custom_skill',
      setPropertyValue: (key, value) => { assigned[key] = value; },
    };
    syncInjectedMediaOntoSurveyModel(
      { getAllQuestions: () => [liveQuestion] },
      {
        pages: [{
          elements: [{
            type: 'skillquestion',
            name: 'custom_skill',
            skillId: 'skill-1',
            skillHtml: '<!doctype html><html></html>',
            skillRevision: 3,
            skillContractVersion: 1,
            skillResultSchema: [{ key: 'score', type: 'number' }],
          }],
        }],
      },
    );

    expect(assigned).toMatchObject({
      skillId: 'skill-1',
      skillHtml: '<!doctype html><html></html>',
      skillRevision: 3,
      skillContractVersion: 1,
      skillResultSchema: [{ key: 'score', type: 'number' }],
    });
  });

  test('describeMediaAssignmentFailure names the question and missing category', () => {
    const message = describeMediaAssignmentFailure(
      categoryQuestion({ name: 'q_street', title: 'Street scenes', mediaFolders: ['missing_cat'], mediaPerCategory: 2 }),
      FIXTURE_POOL,
      FIXTURE_TAGS,
      { images: [] },
    );
    expect(message).toMatch(/q_street/);
    expect(message).toMatch(/missing_cat/);
    expect(message).not.toMatch(/random|demo/i);
  });
});
