const {
  pickMediaForSilicon,
  pickTrialMediaForSilicon,
  preflightMediaForQuestions,
  questionNeedsShownMedia,
  seededShuffle,
  assignMediaForSurvey,
} = require('./siliconMediaAssign');

describe('silicon media assignment', () => {
  test('is deterministic for the same seed', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(pool, 7)).toEqual(seededShuffle(pool, 7));
    expect(seededShuffle(pool, 7)).not.toEqual(seededShuffle(pool, 8));
  });

  test('picks a stable subset per question', () => {
    const pool = [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }, { url: 'https://x/3.jpg' }];
    const a = pickMediaForSilicon({ pool, question: { name: 'q1', imageCount: 2 }, seed: 42 });
    const b = pickMediaForSilicon({ pool, question: { name: 'q1', imageCount: 2 }, seed: 42 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
  });

  test('does not always take the first four images from the pool', () => {
    const pool = Array.from({ length: 8 }, (_, i) => ({ url: `https://x/${i + 1}.jpg` }));
    const picked = pickMediaForSilicon({
      pool,
      question: { name: 'q1', imageCount: 4 },
      seed: 99,
    });
    expect(picked).toHaveLength(4);
    expect(picked).not.toEqual(['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg', 'https://x/4.jpg']);
  });

  test('does not pick images outside the allowed folder or replace fixed urls', () => {
    const pool = [
      { url: 'https://x/allowed-1.jpg', folder: 'allowed' },
      { url: 'https://x/nested.jpg', folder: 'allowed/nested' },
      { url: 'https://x/other-1.jpg', folder: 'other' },
    ];
    const folderPick = pickMediaForSilicon({
      pool,
      question: { name: 'q1', imageCount: 2, mediaFolders: ['allowed'] },
      seed: 1,
    });
    expect([...folderPick].sort()).toEqual(['https://x/allowed-1.jpg', 'https://x/nested.jpg']);
    const emptyFolders = pickMediaForSilicon({
      pool,
      question: { name: 'q1', imageCount: 2, mediaFolders: [] },
      seed: 1,
    });
    expect(emptyFolders).toHaveLength(2);
    const missingFolder = pickMediaForSilicon({
      pool,
      question: { name: 'q1', imageCount: 2, mediaFolders: ['missing'] },
      seed: 1,
    });
    expect(missingFolder).toEqual([]);
    const fixed = pickMediaForSilicon({
      pool,
      question: {
        name: 'q2',
        imageSelectionMode: 'huggingface_manual',
        selectedImageUrls: ['https://x/outside.jpg'],
      },
      seed: 99,
    });
    expect(fixed).toEqual(['https://x/outside.jpg']);
  });

  test('filters by category tag when no folder scope is set', () => {
    const pool = [
      { url: 'https://x/park-1.jpg', folder: 'park' },
      { url: 'https://x/street-1.jpg', folder: 'street' },
    ];
    const picked = pickMediaForSilicon({
      pool,
      question: { name: 'qcat', imageCount: 2, mediaCategory: 'green' },
      seed: 1,
      dataset: { folderTags: { park: { category: 'green' }, street: { category: 'paved' } } },
    });
    expect(picked).toEqual(['https://x/park-1.jpg']);
  });

  test('preflights missing media sources without inventing a successful run', () => {
    const survey = {
      pages: [{ elements: [{ type: 'imagerating', name: 'q1', imageCount: 1, mediaFolders: [] }] }],
    };
    const empty = preflightMediaForQuestions({
      surveyConfig: survey,
      questionNames: ['q1'],
      pool: [],
    });
    expect(empty.ok).toBe(false);
    expect(empty.errors[0].code).toBe('no_media_source');
    const folder = preflightMediaForQuestions({
      surveyConfig: {
        pages: [{ elements: [{ type: 'imagerating', name: 'q1', imageCount: 1, mediaFolders: ['missing'] }] }],
      },
      questionNames: ['q1'],
      pool: [{ url: 'https://x/1.jpg', folder: 'street' }],
    });
    expect(folder.ok).toBe(false);
    expect(folder.errors[0].code).toBe('folder_empty');
    const preview = preflightMediaForQuestions({
      surveyConfig: survey,
      questionNames: ['q1'],
      pool: [{ url: 'https://preview/1.jpg' }],
    });
    expect(preview.ok).toBe(true);
  });

  test('flags image questions that must have media before the model is called', () => {
    expect(questionNeedsShownMedia({ type: 'imagerating' })).toBe(true);
    expect(questionNeedsShownMedia({ type: 'imageslidergroup' })).toBe(true);
    expect(questionNeedsShownMedia({ type: 'rating' })).toBe(false);
    expect(questionNeedsShownMedia({ type: 'rating', imageCount: 2 })).toBe(true);
  });

  test('picks one set and distinct trials when asked', () => {
    const pool = [
      { url: 'https://x/sun-1.jpg', folder: 'sun' },
      { url: 'https://x/sun-2.jpg', folder: 'sun' },
      { url: 'https://x/shade-1.jpg', folder: 'shade' },
      { url: 'https://x/shade-2.jpg', folder: 'shade' },
    ];
    const setPick = pickMediaForSilicon({
      pool,
      question: { name: 'qset', imageCount: 2, mediaAssignmentMode: 'set' },
      seed: 3,
      dataset: { folderTags: { sun: { set: 'sun' }, shade: { set: 'shade' } } },
    });
    expect(setPick).toHaveLength(2);
    expect(new Set(setPick.map((url) => (url.includes('/sun-') ? 'sun' : 'shade'))).size).toBe(1);
    const trials = pickTrialMediaForSilicon({
      pool,
      question: { name: 'qtrial', imageCount: 1, trialCount: 2 },
      seed: 9,
    });
    expect(trials).toHaveLength(2);
    expect(trials[0]).toHaveLength(1);
    expect(trials[0]).not.toEqual(trials[1]);
  });

  test('assignMediaForSurvey records trial arrays when trialCount > 1', () => {
    const pool = [
      { url: 'https://x/1.jpg' },
      { url: 'https://x/2.jpg' },
      { url: 'https://x/3.jpg' },
    ];
    const assigned = assignMediaForSurvey({
      surveyConfig: {
        pages: [{
          elements: [
            { type: 'imagerating', name: 'comfort', imageCount: 1, trialCount: 2 },
            { type: 'rating', name: 'safety' },
          ],
        }],
      },
      pool,
      seed: 'run:p1:1',
    });
    expect(Array.isArray(assigned.comfort[0])).toBe(true);
    expect(assigned.comfort).toHaveLength(2);
    expect(assigned.safety).toBeUndefined();
  });
});
