import {
  computeGuideChecklist,
  countAnswerableQuestions,
  loadGuidePrefs,
  loadGuideProgress,
  markGuideProgress,
  resetGuidePrefs,
  saveGuidePrefs,
  GUIDE_PROGRESS_EVENT,
} from './adminGuide';

afterEach(() => localStorage.clear());

const config = {
  pages: [
    { elements: [{ type: 'html', name: 'intro' }, { type: 'rating', name: 'q1' }] },
    { elements: [{ type: 'imageranking', name: 'q2' }, { type: 'mediadisplay', name: 'm' }] },
  ],
};

test('counts only answerable questions', () => {
  expect(countAnswerableQuestions(config)).toBe(2);
  expect(countAnswerableQuestions(null)).toBe(0);
});

test('an empty project has nothing ticked', () => {
  const result = computeGuideChecklist({ project: { preloadedImages: [] }, surveyConfig: { pages: [] } });
  expect(result.doneCount).toBe(0);
  expect(result.isNewProject).toBe(true);
  expect(result.items.responses.unknown).toBe(true);
});

test('ticks from project state, local progress and responses', () => {
  const project = { preloadedImages: [{}, {}, {}], publishedVersion: 2 };
  const partial = computeGuideChecklist({ project, surveyConfig: config, progress: { preview: 1 }, responseCount: 0 });
  expect(partial.items.media).toMatchObject({ done: true, count: 3 });
  expect(partial.items.questions).toMatchObject({ done: true, count: 2 });
  expect(partial.items.preview.done).toBe(true);
  expect(partial.items.published).toMatchObject({ done: true, version: 2 });
  expect(partial.items.shared.done).toBe(false);
  expect(partial.items.responses).toMatchObject({ done: false, unknown: false });

  const legacyLive = computeGuideChecklist({ project: { publishedVersion: 0 }, surveyConfig: config, responseCount: 5 });
  expect(legacyLive.items.published.done).toBe(true);
  expect(legacyLive.items.shared.done).toBe(true);
  expect(legacyLive.items.responses).toMatchObject({ done: true, count: 5 });
});

test('prefs are stored per user and can be reset', () => {
  saveGuidePrefs('u1', { tourDone: true });
  saveGuidePrefs('u1', { checklistHidden: true });
  expect(loadGuidePrefs('u1')).toEqual({ tourDone: true, checklistHidden: true });
  expect(loadGuidePrefs('u2')).toEqual({});
  resetGuidePrefs('u1');
  expect(loadGuidePrefs('u1')).toEqual({});
});

test('progress marks are per project, first time only, and broadcast', () => {
  const listener = jest.fn();
  window.addEventListener(GUIDE_PROGRESS_EVENT, listener);
  markGuideProgress('p1', 'shared');
  markGuideProgress('p1', 'shared');
  markGuideProgress(null, 'shared');
  window.removeEventListener(GUIDE_PROGRESS_EVENT, listener);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(loadGuideProgress('p1').shared).toEqual(expect.any(Number));
  expect(loadGuideProgress('p2')).toEqual({});
});
